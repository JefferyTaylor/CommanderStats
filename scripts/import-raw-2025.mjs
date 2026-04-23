import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RAW_FILE = path.join(ROOT, "raw_input2.txt");
const CONFIG_FILE = path.join(ROOT, "config.js");
const OUTPUT_DIR = path.join(ROOT, "data");

const CORE_PLAYERS = ["Jeff", "Chandler", "Tom", "Noah"];

function parseConfig(content) {
  const urlMatch = content.match(/supabaseUrl:\s*"([^"]*)"/);
  const keyMatch = content.match(/supabaseAnonKey:\s*"([^"]*)"/);
  const supabaseUrl = urlMatch?.[1] ?? "";
  const supabaseAnonKey = keyMatch?.[1] ?? "";
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing supabaseUrl or supabaseAnonKey in config.js");
  }
  return { supabaseUrl, supabaseAnonKey };
}

function cleanRaw(raw) {
  return raw
    .replace(/Reyav12-2-25/gi, "Reyav\n12-2-25")
    .replace(/\r/g, "");
}

function normalizeDate(token) {
  const m = token.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2})$/);
  if (!m) return "";
  const mm = String(Number(m[1])).padStart(2, "0");
  const dd = String(Number(m[2])).padStart(2, "0");
  const year = `20${m[3]}`;
  return `${year}-${mm}-${dd}`;
}

function dateFromLine(line) {
  const m = line.match(/^(\d{1,2}[-/]\d{1,2}[-/]\d{2})/);
  return m ? normalizeDate(m[1]) : "";
}

function canonPlayer(rawName) {
  const token = rawName
    .replace(/[.,]/g, "")
    .replace(/\bwon$/i, "")
    .trim()
    .toLowerCase();
  const map = {
    jeff: "Jeff",
    chandler: "Chandler",
    chanlder: "Chandler",
    tom: "Tom",
    noah: "Noah",
    yuta: "Guest (Yuta)",
    traral: "Guest (Tratal)",
    tratal: "Guest (Tratal)",
    peter: "Guest (Peter)",
  };
  return map[token] || rawName.trim();
}

function normalizeCommander(rawCommander) {
  if (!rawCommander) return "Unknown";
  const c = rawCommander.replace(/\s+/g, " ").replace(/[.,]+$/g, "").trim();
  const lc = c.toLowerCase();
  if (/adaline/.test(lc)) return "Adeline";
  if (/hasaton|hekaton/.test(lc)) return "Hashaton";
  if (/il[- ]?kor|elas il[- ]?kor|ill-as kor/.test(lc)) return "Elas il-Kor";
  if (/dog and goblin these nuts/.test(lc)) return "Three Dog";
  if (/david tentent/.test(lc)) return "Susan + The Fourteenth Doctor";
  if (/\bdonna\b/.test(lc) && /(2nd\s*(doc|dr|doctor)|second doctor)/.test(lc)) {
    return "Donna + The Second Doctor";
  }
  if (/\bsusan\b/.test(lc) && /(14th\s*(doc|dr|doctor)|fourteenth doctor)/.test(lc)) {
    return "Susan + The Fourteenth Doctor";
  }
  return c;
}

function parseTimeRange(text) {
  const m = text.match(/(\d{1,2}[:.]?\d{2})\s*(?:-|END|,)\s*(\d{1,2}[:.]?\d{2})/i);
  if (!m) return 0;
  const start = toMinutes(m[1]);
  const end = toMinutes(m[2]);
  if (start === null || end === null || end < start) return 0;
  return end - start;
}

function toMinutes(token) {
  const clean = token.replace(".", ":").trim();
  if (/^\d{1,2}:\d{2}$/.test(clean)) {
    const [h, m] = clean.split(":").map(Number);
    return h * 60 + m;
  }
  if (/^\d{3,4}$/.test(clean)) {
    const pad = clean.length === 3 ? `0${clean}` : clean;
    const h = Number(pad.slice(0, 2));
    const m = Number(pad.slice(2));
    return h * 60 + m;
  }
  return null;
}

function splitSections(rawText) {
  const deckStart = rawText.search(/Started tracking decks on/i);
  const notableStart = rawText.search(/Notable events;/i);
  const gameSection = deckStart > 0 ? rawText.slice(0, deckStart) : rawText;
  const summarySection = deckStart > 0 && notableStart > deckStart ? rawText.slice(deckStart, notableStart) : "";
  const notableSection = notableStart > 0 ? rawText.slice(notableStart) : "";
  return { gameSection, summarySection, notableSection };
}

function isStandaloneResultLine(line) {
  const trimmed = line.trim();
  if (!dateFromLine(trimmed)) return false;
  if (/\bwon\b/i.test(trimmed)) return true;
  if (/\bdraw\b|\bdrew\b/i.test(trimmed)) return true;
  if (/\bwith\b/i.test(trimmed)) return true;
  return false;
}

function parseInlineGame(line) {
  const date = dateFromLine(line);
  const body = line.replace(/^(\d{1,2}[-/]\d{1,2}[-/]\d{2})\s*/, "").trim();
  const lowered = body.toLowerCase();

  if (/\bwe all draw\b/.test(lowered) || /\bdrew\b/.test(lowered)) {
    return {
      date,
      gameLengthMinutes: parseTimeRange(line),
      gameEndTurn: 0,
      winner: "Draw",
      notableMoments: body,
      players: CORE_PLAYERS.map((name) => ({
        name,
        commander: "Unknown",
        knockoutTurn: null,
        knockoutMethod: "Survived",
        won: false,
      })),
    };
  }

  let winner = "";
  let commander = "";
  const wonWith = body.match(/^([A-Za-z' ]+)\s+won(?:\s+with)?\s+(.+)$/i);
  const withOnly = body.match(/^([A-Za-z' ]+)\s+with\s+(.+)$/i);
  if (wonWith) {
    winner = canonPlayer(wonWith[1]);
    commander = normalizeCommander(wonWith[2]);
  } else if (withOnly) {
    winner = canonPlayer(withOnly[1]);
    commander = normalizeCommander(withOnly[2]);
  } else {
    return null;
  }

  return {
    date,
    gameLengthMinutes: parseTimeRange(line),
    gameEndTurn: 0,
    winner,
    notableMoments: body,
    players: [
      {
        name: winner,
        commander,
        knockoutTurn: null,
        knockoutMethod: "Survived",
        won: true,
      },
    ],
  };
}

function parseBlock(header, lines) {
  const date = dateFromLine(header);
  const allLines = [header, ...lines];
  let winner = "Unknown";
  let winnerCommander = "Unknown";
  const players = new Map();
  let notable = [];

  for (const line of lines) {
    const wonPlayed = line.match(/^([A-Za-z' ]+)\s+played\s+(.+?),?\s*(he won|won)/i);
    if (wonPlayed) {
      winner = canonPlayer(wonPlayed[1]);
      winnerCommander = normalizeCommander(wonPlayed[2]);
    }

    const wonLine = line.match(/^WON[,.\- ]+\s*([A-Za-z' ]+)\s*,\s*(.+)$/i);
    if (wonLine) {
      winner = canonPlayer(wonLine[1]);
      winnerCommander = normalizeCommander(wonLine[2]);
    }

    const simpleWinner = line.match(/^([A-Za-z' ]+)\s+won\b/i);
    if (simpleWinner && winner === "Unknown") {
      winner = canonPlayer(simpleWinner[1]);
    }

    const played = line.match(/^([A-Za-z' ]+)\s+played\s+(.+)$/i);
    if (played) {
      players.set(canonPlayer(played[1]), normalizeCommander(played[2]));
    }

    const csv = line.match(/^([A-Za-z' ]+)\s*,\s*(.+)$/i);
    if (csv) {
      players.set(canonPlayer(csv[1]), normalizeCommander(csv[2]));
    }
  }

  if (winner !== "Unknown" && winnerCommander !== "Unknown" && !players.has(winner)) {
    players.set(winner, winnerCommander);
  }
  if (winner !== "Unknown" && winnerCommander !== "Unknown" && players.get(winner) === "Unknown") {
    players.set(winner, winnerCommander);
  }

  if (winner === "Unknown" && allLines.some((l) => /\bdraw|drew/i.test(l))) {
    winner = "Draw";
  }

  for (const line of allLines) {
    if (line.trim()) notable.push(line.trim());
  }

  const playerList = [...players.entries()].map(([name, commander]) => ({
    name,
    commander,
    knockoutTurn: null,
    knockoutMethod: winner === "Draw" ? "Survived" : (name === winner ? "Survived" : "Other"),
    won: winner !== "Draw" && name === winner,
  }));

  return {
    date,
    gameLengthMinutes: parseTimeRange(header),
    gameEndTurn: 0,
    winner,
    notableMoments: notable.join(" | "),
    players: playerList,
  };
}

function parseGameSection(gameSection) {
  const lines = gameSection.split("\n").map((l) => l.trim()).filter(Boolean);
  const games = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!dateFromLine(line)) continue;

    if (isStandaloneResultLine(line)) {
      const parsed = parseInlineGame(line);
      if (parsed) games.push(parsed);
      continue;
    }

    const blockLines = [];
    while (i + 1 < lines.length && !dateFromLine(lines[i + 1])) {
      blockLines.push(lines[i + 1]);
      i += 1;
    }
    const parsed = parseBlock(line, blockLines);
    if (parsed.date && parsed.winner !== "Unknown") {
      games.push(parsed);
    }
  }

  return games;
}

function parseDeckSummary(summarySection) {
  const lines = summarySection.split("\n").map((l) => l.trim()).filter(Boolean);
  const summary = { year: 2025, totals: {}, byPlayer: {}, guests: {} };
  let current = "";

  for (const line of lines) {
    if (/^Started tracking decks on/i.test(line)) continue;

    const totalMatch = line.match(/^([A-Za-z' ]+)\s+wins\s+(\d+)/i);
    if (totalMatch) {
      current = canonPlayer(totalMatch[1]);
      summary.totals[current] = Number(totalMatch[2]);
      summary.byPlayer[current] = summary.byPlayer[current] || {};
      continue;
    }

    const deckMatch = line.match(/^(.+?):\s*Wins\s*(\d*)\s*Losses\s*(\d*)/i);
    if (deckMatch && current) {
      const deck = normalizeCommander(deckMatch[1]);
      summary.byPlayer[current][deck] = {
        wins: deckMatch[2] ? Number(deckMatch[2]) : 0,
        losses: deckMatch[3] ? Number(deckMatch[3]) : 0,
      };
      continue;
    }

    const guestTotal = line.match(/^([A-Za-z' ]+)\s+wins\s+(\d+)/i);
    if (guestTotal && !CORE_PLAYERS.includes(canonPlayer(guestTotal[1]))) {
      summary.guests[canonPlayer(guestTotal[1])] = Number(guestTotal[2]);
    }
  }
  return summary;
}

function parseNotableSection(notableSection) {
  const lines = notableSection
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^Notable events;/i.test(l));
  const byDate = {};
  const unmatched = [];
  let lastDate = "";

  for (const line of lines) {
    const dm = line.match(/(\d{1,2}[-/]\d{1,2}[-/]\d{2})/);
    if (dm) {
      lastDate = normalizeDate(dm[1]);
      byDate[lastDate] = byDate[lastDate] || [];
      byDate[lastDate].push(line);
      continue;
    }
    if (/^same date/i.test(line) && lastDate) {
      byDate[lastDate] = byDate[lastDate] || [];
      byDate[lastDate].push(line);
      continue;
    }
    unmatched.push(line);
  }

  return { byDate, unmatched };
}

function mergeNotableEvents(games, notable) {
  for (const game of games) {
    const extra = notable.byDate[game.date] || [];
    if (extra.length) {
      game.notableMoments = game.notableMoments ? `${game.notableMoments} | ${extra.join(" | ")}` : extra.join(" | ");
    }
  }
}

function dedupeGames(games) {
  const seen = new Set();
  const deduped = [];
  for (const game of games) {
    const key = JSON.stringify(game);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(game);
  }
  return deduped;
}

async function supabaseFetch(url, key, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase error ${res.status}: ${text}`);
  }
  return res.json();
}

async function writeArtifacts(summary, unmatched) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, "yearly-summary-2025.json"), JSON.stringify(summary, null, 2));
  await writeFile(path.join(OUTPUT_DIR, "unmatched-notable-notes-2025.json"), JSON.stringify(unmatched, null, 2));
}

async function main() {
  const [rawTextOriginal, configText] = await Promise.all([readFile(RAW_FILE, "utf8"), readFile(CONFIG_FILE, "utf8")]);
  const rawText = cleanRaw(rawTextOriginal);
  const { gameSection, summarySection, notableSection } = splitSections(rawText);
  const summary = parseDeckSummary(summarySection);
  const notable = parseNotableSection(notableSection);

  let games = parseGameSection(gameSection);
  mergeNotableEvents(games, notable);
  games = dedupeGames(games).filter((g) => g.date.startsWith("2025-"));

  if (!games.length) {
    throw new Error("No 2025 games parsed from raw_input2.txt");
  }

  await writeArtifacts(summary, notable.unmatched);

  if (process.argv.includes("--dry-run")) {
    const winners = games.reduce((acc, g) => {
      acc[g.winner] = (acc[g.winner] || 0) + 1;
      return acc;
    }, {});
    console.log(`Parsed ${games.length} games.`);
    console.log(`Winner breakdown: ${JSON.stringify(winners)}`);
    console.log(`Saved artifacts in data/yearly-summary-2025.json and data/unmatched-notable-notes-2025.json`);
    console.log(JSON.stringify(games.slice(0, 3), null, 2));
    return;
  }

  const { supabaseUrl, supabaseAnonKey } = parseConfig(configText);
  const existing2025 = await supabaseFetch(
    `${supabaseUrl}/rest/v1/games?select=id&game_date=gte.2025-01-01&game_date=lte.2025-12-31&limit=1`,
    supabaseAnonKey,
    { method: "GET" },
  );
  if (existing2025.length > 0 && !process.argv.includes("--force")) {
    throw new Error("2025 games already exist. Re-run with --force to append duplicates.");
  }

  const inserts = games.map((payload) => ({
    game_date: payload.date,
    winner: payload.winner,
    game_length_minutes: payload.gameLengthMinutes,
    game_end_turn: payload.gameEndTurn,
    notable_moments: payload.notableMoments || null,
    payload,
  }));

  const inserted = await supabaseFetch(`${supabaseUrl}/rest/v1/games`, supabaseAnonKey, {
    method: "POST",
    body: JSON.stringify(inserts),
  });
  console.log(`Imported ${inserted.length} games from raw_input2.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

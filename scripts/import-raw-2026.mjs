import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const RAW_FILE = path.join(ROOT, "raw_input.txt");
const CONFIG_FILE = path.join(ROOT, "config.js");

const MONTHS = {
  jan: 1,
  feb: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

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

function isDateHeader(line) {
  return /^(Jan|Feb|March|April)\b/i.test(line.trim());
}

function splitHeaderBlocks(rawText) {
  const lines = rawText.split(/\r?\n/);
  const blocks = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (/^RIFTBOUND\b/i.test(line)) {
      break;
    }
    if (/^Note\s+\d+/i.test(line)) {
      continue;
    }
    if (isDateHeader(line)) {
      if (current) {
        blocks.push(current);
      }
      current = { header: line, lines: [] };
      continue;
    }
    if (!current) {
      continue;
    }
    current.lines.push(line);
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
}

function parseDate(header) {
  const match = header.match(/^(Jan|Feb|March|April)[.,]?\s*(\d{1,2})/i);
  if (!match) {
    throw new Error(`Could not parse date from header: ${header}`);
  }
  const monthKey = match[1].toLowerCase();
  const month = MONTHS[monthKey];
  const day = Number(match[2]);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `2026-${mm}-${dd}`;
}

function parseTimeRange(header) {
  const timeMatch = header.match(/(\d{3,4})\s*-\s*(\d{3,4})/);
  if (!timeMatch) {
    return null;
  }
  const start = timeMatch[1];
  const end = timeMatch[2];
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (endMinutes < startMinutes) {
    return null;
  }
  return endMinutes - startMinutes;
}

function toMinutes(timeToken) {
  const clean = String(timeToken).trim();
  if (clean.length === 3) {
    const hh = Number(clean.slice(0, 1));
    const mm = Number(clean.slice(1));
    return hh * 60 + mm;
  }
  if (clean.length === 4) {
    const hh = Number(clean.slice(0, 2));
    const mm = Number(clean.slice(2));
    return hh * 60 + mm;
  }
  return 0;
}

function canonPlayer(rawName) {
  const token = rawName.replace(/[.,]/g, "").trim().toLowerCase();
  if (!token) {
    return "";
  }
  if (token === "mario") {
    return "Guest (Mario)";
  }
  const map = {
    jeff: "Jeff",
    chandler: "Chandler",
    tom: "Tom",
    noah: "Noah",
    guest: "Guest",
  };
  return map[token] || rawName.trim();
}

function normalizeCommander(rawCommander) {
  if (!rawCommander) return "Unknown";
  const c = rawCommander.replace(/\s+/g, " ").replace(/[.,]+$/g, "").trim();
  const lc = c.toLowerCase();

  const hasDonna = /\bdonna\b/.test(lc);
  const hasSecondDoc = /(2nd\s*(doc|dr|doctor)|second doctor)/.test(lc);
  if (hasDonna && hasSecondDoc) {
    return "Donna + The Second Doctor";
  }
  if (hasSecondDoc) {
    return "The Second Doctor";
  }

  const hasSusan = /\bsusan\b/.test(lc);
  const hasFourteenth = /(14th\s*(doc|dr|doctor)|fourteenth doctor)/.test(lc);
  if (hasSusan && hasFourteenth) {
    return "Susan + The Fourteenth Doctor";
  }
  if (hasFourteenth) {
    return "The Fourteenth Doctor";
  }

  if (/arana|araña/.test(lc)) return "Araña";
  if (/adaline/.test(lc)) return "Adeline";

  return c;
}

function parseWinner(header, lines) {
  const winnerFromHeader = header.match(/\b(Jeff|Chandler|Tom|Noah)\s+won\b/i);
  if (winnerFromHeader) {
    return canonPlayer(winnerFromHeader[1]);
  }

  for (const line of lines) {
    if (/\bDRAW\b/i.test(line)) {
      return "Draw";
    }
    const wonAfterTurn = line.match(/\bWON\b\s*T\d{1,2}[.\- ]+\s*([A-Za-zñÑ' ]+)[.,]/i);
    if (wonAfterTurn) {
      return canonPlayer(wonAfterTurn[1]);
    }
    const wonMatch = line.match(/\bWON[.\- ]+\s*([A-Za-zñÑ' ]+)/i);
    if (wonMatch) {
      const chunk = wonMatch[1].trim();
      const nameToken = chunk.split(/[.,]/)[0];
      return canonPlayer(nameToken);
    }
  }
  return "Unknown";
}

function parseEndTurn(header, lines, koTurnMap) {
  const fromHeader = header.match(/\b(?:Won|Draw)\s*T(\d{1,2})\b/i);
  if (fromHeader) return Number(fromHeader[1]);

  for (const line of lines) {
    const wonTurn = line.match(/\bWON\b.*?\bT(\d{1,2})\b/i);
    if (wonTurn) return Number(wonTurn[1]);
    const comboTurn = line.match(/\bcombo\b.*?\b(?:turn|t)\s*(\d{1,2})\b/i);
    if (comboTurn) return Number(comboTurn[1]);
  }

  let maxTurn = 0;
  for (const value of Object.values(koTurnMap)) {
    if (value && value > maxTurn) {
      maxTurn = value;
    }
  }
  return maxTurn || 0;
}

function playerLineName(line) {
  const m = line.match(/^(WON[.\- ]+)?\s*([A-Za-zñÑ' ]+)[.,]/i);
  if (!m) return "";
  return canonPlayer(m[2]);
}

function extractCommanderFromLine(line, playerName) {
  if (!playerName) return "Unknown";
  const cleaned = line.replace(/^WON[.\- ]+\s*/i, "");
  const firstSep = cleaned.search(/[.,]/);
  if (firstSep === -1) return "Unknown";

  const afterName = cleaned.slice(firstSep + 1).trim();
  const cut = afterName.search(
    /\b(killed|won with|won|combo|conceded|scooped|decked|draw|length|players|note)\b/i,
  );
  const commanderRaw = (cut >= 0 ? afterName.slice(0, cut) : afterName).trim();
  const commander = commanderRaw.replace(/[.,]+$/g, "").trim();
  return normalizeCommander(commander || "Unknown");
}

function splitVictimNames(victimChunk) {
  return victimChunk
    .replace(/\./g, "")
    .split(/\band\b|,/i)
    .map((x) => canonPlayer(x.trim()))
    .filter(Boolean);
}

function detectMethod(line) {
  const lc = line.toLowerCase();
  if (lc.includes("commander damage")) return "Commander Damage";
  if (lc.includes("noncombat damage")) return "Noncombat";
  if (lc.includes("combo")) return "Combo";
  if (lc.includes("alternate win")) return "Other";
  if (lc.includes("conceded") || lc.includes("scooped")) return "Concede";
  if (lc.includes("decked")) return "Milled Out";
  if (lc.includes("killed himself")) return "Self-KO";
  return "Combat";
}

function collectKOs(lines) {
  const koTurn = {};
  const koMethod = {};

  for (const line of lines) {
    const method = detectMethod(line);

    const kills = [...line.matchAll(/\bkilled\s+(.+?)\s+T(\d{1,2})\b/gi)];
    for (const hit of kills) {
      const victims = splitVictimNames(hit[1]);
      const turn = Number(hit[2]);
      for (const victim of victims) {
        koTurn[victim] = turn;
        koMethod[victim] = method;
      }
    }

    const concede = line.match(/^([A-Za-zñÑ' ]+)[.,].*?\b(conceded|scooped)\s*T(\d{1,2})\b/i);
    if (concede) {
      const player = canonPlayer(concede[1]);
      koTurn[player] = Number(concede[3]);
      koMethod[player] = "Concede";
    }

    const selfKill = line.match(/^([A-Za-zñÑ' ]+)[.,].*?\bkilled himself\s*T(\d{1,2})\b/i);
    if (selfKill) {
      const player = canonPlayer(selfKill[1]);
      koTurn[player] = Number(selfKill[2]);
      koMethod[player] = "Self-KO";
    }

    const milled = line.match(/^([A-Za-zñÑ' ]+)[.,].*?\bdecked himself\b/i);
    if (milled) {
      const player = canonPlayer(milled[1]);
      const turnMatch = line.match(/\bT(\d{1,2})\b/i);
      koTurn[player] = turnMatch ? Number(turnMatch[1]) : 0;
      koMethod[player] = "Milled Out";
    }

    const everyoneScooped = line.match(/\bPlayers scooped T(\d{1,2})\b/i);
    if (everyoneScooped) {
      const turn = Number(everyoneScooped[1]);
      for (const p of CORE_PLAYERS) {
        if (!koTurn[p]) {
          koTurn[p] = turn;
          koMethod[p] = "Concede";
        }
      }
      if (!koTurn["Guest (Mario)"]) {
        koTurn["Guest (Mario)"] = turn;
        koMethod["Guest (Mario)"] = "Concede";
      }
    }

    const everyoneDied = line.match(/\beveryone died\b/i);
    if (everyoneDied) {
      const turnHint = line.match(/\b(?:turn|t)\s*(\d{1,2})\b/i);
      const turn = turnHint ? Number(turnHint[1]) : null;
      if (turn) {
        for (const p of CORE_PLAYERS) {
          if (!koTurn[p]) {
            koTurn[p] = turn;
            koMethod[p] = "Combo";
          }
        }
      }
    }
  }

  return { koTurn, koMethod };
}

function parsePlayers(lines, winner) {
  const playerMap = new Map();
  for (const line of lines) {
    const name = playerLineName(line);
    if (!name) continue;
    if (name === "Draw") continue;
    const commander = extractCommanderFromLine(line, name);
    playerMap.set(name, commander);
  }

  if (winner !== "Draw" && winner !== "Unknown" && !playerMap.has(winner)) {
    playerMap.set(winner, "Unknown");
  }

  return playerMap;
}

function parseNotable(lines, header) {
  const notable = [];
  const winnerInHeader = header.match(/\b(Jeff|Chandler|Tom|Noah)\s+won\b/i);
  if (winnerInHeader) {
    notable.push(header);
  }
  for (const line of lines) {
    if (line.toLowerCase().startsWith("note")) continue;
    notable.push(line);
  }
  return notable.join(" | ");
}

function parseBlock(block) {
  const date = parseDate(block.header);
  const winner = parseWinner(block.header, block.lines);
  const { koTurn, koMethod } = collectKOs(block.lines);
  const playerMap = parsePlayers(block.lines, winner);
  const endTurn = parseEndTurn(block.header, block.lines, koTurn);
  const length = parseTimeRange(block.header) ?? 0;
  const notableMoments = parseNotable(block.lines, block.header);

  const players = [...playerMap.entries()].map(([name, commander]) => {
    const isDraw = winner === "Draw";
    const won = !isDraw && name === winner;
    return {
      name,
      commander,
      knockoutTurn: won || isDraw ? null : (koTurn[name] ?? null),
      knockoutMethod: won || isDraw ? "Survived" : (koMethod[name] ?? "Other"),
      won,
    };
  });

  return {
    date,
    gameLengthMinutes: length,
    gameEndTurn: endTurn,
    winner,
    notableMoments,
    players,
  };
}

function buildMarch24SpecialGames() {
  const date = "2026-03-24";
  const basePlayers = [
    { name: "Jeff", commander: "Unknown" },
    { name: "Tom", commander: "Unknown" },
    { name: "Noah", commander: "Unknown" },
    { name: "Guest", commander: "Unknown" },
  ];

  const first = {
    date,
    gameLengthMinutes: 0,
    gameEndTurn: 0,
    winner: "Noah",
    notableMoments: "March 24th incomplete entry: Noah won with Torens.",
    players: basePlayers.map((p) => ({
      name: p.name,
      commander: p.name === "Noah" ? "Torens" : p.commander,
      knockoutTurn: p.name === "Noah" ? null : null,
      knockoutMethod: p.name === "Noah" ? "Survived" : "Other",
      won: p.name === "Noah",
    })),
  };

  const second = {
    date,
    gameLengthMinutes: 0,
    gameEndTurn: 0,
    winner: "Noah",
    notableMoments: "March 24th incomplete entry: Noah won with Donna + The Second Doctor.",
    players: basePlayers.map((p) => ({
      name: p.name,
      commander: p.name === "Noah" ? "Donna + The Second Doctor" : p.commander,
      knockoutTurn: p.name === "Noah" ? null : null,
      knockoutMethod: p.name === "Noah" ? "Survived" : "Other",
      won: p.name === "Noah",
    })),
  };

  return [first, second];
}

function withOverrides(game) {
  if (game.date === "2026-04-14" && /Draw T12/i.test(game.notableMoments)) {
    game.winner = "Draw";
    game.players = game.players.map((p) => ({
      ...p,
      won: false,
      knockoutTurn: p.name === "Noah" ? p.knockoutTurn : null,
      knockoutMethod: p.name === "Noah" ? p.knockoutMethod : "Survived",
    }));
    game.gameEndTurn = 12;
  }
  return game;
}

function buildPayloads(rawText) {
  const blocks = splitHeaderBlocks(rawText);
  const payloads = [];

  for (const block of blocks) {
    if (/^March 24th\./i.test(block.header)) {
      payloads.push(...buildMarch24SpecialGames());
      continue;
    }
    const parsed = withOverrides(parseBlock(block));
    payloads.push(parsed);
  }

  return payloads.filter((g) => g.winner !== "Unknown");
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

async function main() {
  const [rawText, configText] = await Promise.all([readFile(RAW_FILE, "utf8"), readFile(CONFIG_FILE, "utf8")]);
  const payloads = buildPayloads(rawText);
  if (!payloads.length) {
    throw new Error("No parsed payloads were produced.");
  }
  if (process.argv.includes("--dry-run")) {
    const winners = payloads.reduce((acc, p) => {
      acc[p.winner] = (acc[p.winner] || 0) + 1;
      return acc;
    }, {});
    const unknownCommanderGames = payloads.filter((p) => p.players.some((pl) => pl.commander === "Unknown")).length;
    console.log(`Parsed ${payloads.length} games.`);
    console.log(`Winner breakdown: ${JSON.stringify(winners)}`);
    console.log(`Games with at least one unknown commander: ${unknownCommanderGames}`);
    console.log(JSON.stringify(payloads.slice(0, 2), null, 2));
    return;
  }

  const { supabaseUrl, supabaseAnonKey } = parseConfig(configText);

  const existing = await supabaseFetch(
    `${supabaseUrl}/rest/v1/games?select=id&limit=1`,
    supabaseAnonKey,
    { method: "GET" },
  );
  if (existing.length > 0 && !process.argv.includes("--force")) {
    throw new Error("Table already has data. Re-run with --force if you want to append duplicates.");
  }

  const inserts = payloads.map((payload) => ({
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

  console.log(`Imported ${inserted.length} games.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

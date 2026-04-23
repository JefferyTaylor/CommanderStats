const PLAYERS = ["Jeff", "Chandler", "Tom", "Noah"];
const KO_METHODS = [
  "Survived",
  "Combat",
  "Commander Damage",
  "Noncombat",
  "Combo",
  "Concede",
  "Self-KO",
  "Milled Out",
  "Poison",
  "Other",
];
const LOCAL_STORAGE_KEY = "commander-stats-games-v1";

const appConfig = window.APP_CONFIG ?? {};
const useSupabase = Boolean(appConfig.supabaseUrl && appConfig.supabaseAnonKey);
const requirePin = Boolean(appConfig.recorderPin);

const dom = {
  gameForm: document.querySelector("#gameForm"),
  gameDate: document.querySelector("#gameDate"),
  gameLengthMinutes: document.querySelector("#gameLengthMinutes"),
  gameEndTurn: document.querySelector("#gameEndTurn"),
  winner: document.querySelector("#winner"),
  notableMoments: document.querySelector("#notableMoments"),
  playerFields: document.querySelector("#playerFields"),
  formMessage: document.querySelector("#formMessage"),
  gamesList: document.querySelector("#gamesList"),
  storageMode: document.querySelector("#storageMode"),
  refreshBtn: document.querySelector("#refreshBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  pinFieldWrap: document.querySelector("#pinFieldWrap"),
  recorderPin: document.querySelector("#recorderPin"),
  summaryContent: document.querySelector("#summaryContent"),
  summaryGameCount: document.querySelector("#summaryGameCount"),
  summaryError: document.querySelector("#summaryError"),
};

const today = new Date().toISOString().slice(0, 10);
dom.gameDate.value = today;

["Draw", ...PLAYERS].forEach((name) => {
  const winnerOption = document.createElement("option");
  winnerOption.value = name;
  winnerOption.textContent = name;
  dom.winner.append(winnerOption);
});

function buildPlayerFields() {
  PLAYERS.forEach((name) => {
    const card = document.createElement("article");
    card.className = "player-card";
    card.innerHTML = `
      <h3>${name}</h3>
      <label>
        Commander Name
        <input type="text" id="commander-${name}" placeholder="e.g. Muldrotha, the Gravetide" required />
      </label>
      <div class="grid two-col">
        <label>
          Knockout Turn
          <input type="number" id="koTurn-${name}" min="1" placeholder="blank if winner" />
        </label>
        <label>
          KO Method
          <select id="koMethod-${name}"></select>
        </label>
      </div>
    `;
    dom.playerFields.append(card);

    const methodSelect = card.querySelector(`#koMethod-${name}`);
    KO_METHODS.forEach((method) => {
      const option = document.createElement("option");
      option.value = method;
      option.textContent = method;
      methodSelect.append(option);
    });
  });
}

buildPlayerFields();

if (requirePin) {
  dom.pinFieldWrap.classList.remove("hidden");
}

dom.storageMode.textContent = useSupabase ? "Storage: Supabase" : "Storage: Local only";

let supabaseClient = null;
if (useSupabase) {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm");
  supabaseClient = createClient(appConfig.supabaseUrl, appConfig.supabaseAnonKey);
}

function setMessage(text, mode = "") {
  dom.formMessage.textContent = text;
  dom.formMessage.className = `message ${mode}`.trim();
}

function collectPayload() {
  const winner = dom.winner.value;
  const players = PLAYERS.map((name) => {
    const commander = document.querySelector(`#commander-${name}`).value.trim();
    const koTurnRaw = document.querySelector(`#koTurn-${name}`).value;
    const koMethod = document.querySelector(`#koMethod-${name}`).value;
    return {
      name,
      commander,
      knockoutTurn: koTurnRaw ? Number(koTurnRaw) : null,
      knockoutMethod: name === winner ? "Survived" : koMethod,
      won: name === winner,
    };
  });

  return {
    date: dom.gameDate.value,
    gameLengthMinutes: Number(dom.gameLengthMinutes.value),
    gameEndTurn: Number(dom.gameEndTurn.value),
    winner,
    notableMoments: dom.notableMoments.value.trim(),
    players,
  };
}

function validate(payload) {
  if (!payload.date || !payload.gameLengthMinutes || !payload.gameEndTurn || !payload.winner) {
    return "Date, length, end turn, and winner are required.";
  }

  const isDraw = payload.winner === "Draw";
  for (const player of payload.players) {
    if (!player.commander) {
      return `Commander name is required for ${player.name}.`;
    }
    if (!isDraw && !player.won && !player.knockoutTurn) {
      return `Knockout turn is required for ${player.name} unless they won.`;
    }
  }

  return "";
}

async function saveLocal(payload) {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  const entries = raw ? JSON.parse(raw) : [];
  entries.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    payload,
  });
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(entries));
}

async function saveSupabase(payload) {
  const { error } = await supabaseClient.from("games").insert({
    game_date: payload.date,
    winner: payload.winner,
    game_length_minutes: payload.gameLengthMinutes,
    game_end_turn: payload.gameEndTurn,
    notable_moments: payload.notableMoments || null,
    payload,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function getLocalGames() {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function mapSupabaseRow(row) {
  const payload = row.payload ?? {
    date: row.game_date,
    winner: row.winner,
    gameLengthMinutes: row.game_length_minutes,
    gameEndTurn: row.game_end_turn,
    notableMoments: row.notable_moments ?? "",
    players: [],
  };
  return {
    id: row.id,
    createdAt: row.created_at,
    gameDate: row.game_date,
    payload,
  };
}

async function getSupabaseGamesAll() {
  const { data, error } = await supabaseClient
    .from("games")
    .select("*")
    .order("game_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    throw new Error(error.message);
  }

  return data.map(mapSupabaseRow);
}

function winningCommander(payload) {
  if (!payload || payload.winner === "Draw") return null;
  const players = payload.players ?? [];
  const won = players.find((p) => p.won && p.name === payload.winner);
  if (won?.commander && won.commander !== "Unknown") return won.commander;
  const byName = players.find((p) => p.name === payload.winner);
  if (byName?.commander && byName.commander !== "Unknown") return byName.commander;
  return null;
}

function gameYear(entry) {
  const d = entry.payload?.date ?? entry.gameDate ?? "";
  return d.slice(0, 4) || "—";
}

function computeStats(entries) {
  const overallWins = Object.fromEntries(PLAYERS.map((p) => [p, 0]));
  const byYearWins = {};
  let draws = 0;
  const guestWins = {};

  const commanderOverall = {};
  const commanderByYear = {};

  for (const entry of entries) {
    const payload = entry.payload;
    if (!payload?.winner) continue;
    const year = gameYear(entry);

    if (payload.winner === "Draw") {
      draws += 1;
      continue;
    }

    if (PLAYERS.includes(payload.winner)) {
      overallWins[payload.winner] += 1;
      if (!byYearWins[year]) byYearWins[year] = Object.fromEntries(PLAYERS.map((p) => [p, 0]));
      byYearWins[year][payload.winner] += 1;
    } else {
      guestWins[payload.winner] = (guestWins[payload.winner] || 0) + 1;
    }

    const cmd = winningCommander(payload);
    if (cmd) {
      commanderOverall[cmd] = (commanderOverall[cmd] || 0) + 1;
      if (!commanderByYear[year]) commanderByYear[year] = {};
      commanderByYear[year][cmd] = (commanderByYear[year][cmd] || 0) + 1;
    }
  }

  const topCommanders = (map, n = 8) =>
    Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

  return {
    totalGames: entries.length,
    overallWins,
    byYearWins,
    draws,
    guestWins,
    topCommandersOverall: topCommanders(commanderOverall),
    topCommandersByYear: Object.fromEntries(
      Object.keys(commanderByYear)
        .sort()
        .map((y) => [y, topCommanders(commanderByYear[y])]),
    ),
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSummary(stats) {
  const years = Object.keys(stats.byYearWins).sort();
  const guestRows = Object.entries(stats.guestWins).sort((a, b) => b[1] - a[1]);

  let winsByYearTable = "";
  if (years.length) {
    const header = `<tr><th>Year</th>${PLAYERS.map((p) => `<th>${escapeHtml(p)}</th>`).join("")}</tr>`;
    const body = years
      .map((y) => {
        const row = stats.byYearWins[y];
        return `<tr><td>${escapeHtml(y)}</td>${PLAYERS.map((p) => `<td class="num">${row[p] ?? 0}</td>`).join("")}</tr>`;
      })
      .join("");
    winsByYearTable = `<div class="summary-block"><h3>Wins by year (pod)</h3><div class="summary-table-wrap"><table class="summary-table">${header}${body}</table></div></div>`;
  }

  const overallRows = PLAYERS.map(
    (p) => `<tr><td>${escapeHtml(p)}</td><td class="num">${stats.overallWins[p]}</td></tr>`,
  ).join("");
  const topOverall =
    stats.topCommandersOverall.length === 0
      ? "<p class=\"game-meta\">No commander wins parsed yet.</p>"
      : `<table class="summary-table"><tr><th>Commander</th><th class="num">Wins</th></tr>${stats.topCommandersOverall
          .map(([name, c]) => `<tr><td>${escapeHtml(name)}</td><td class="num">${c}</td></tr>`)
          .join("")}</table>`;

  const byYearCmd = Object.keys(stats.topCommandersByYear)
    .sort()
    .map((y) => {
      const rows = stats.topCommandersByYear[y];
      if (!rows.length) return "";
      const tbl = `<table class="summary-table"><tr><th>Commander</th><th class="num">Wins</th></tr>${rows
        .map(([name, c]) => `<tr><td>${escapeHtml(name)}</td><td class="num">${c}</td></tr>`)
        .join("")}</table>`;
      return `<div class="summary-block"><h3>Top commanders (${escapeHtml(y)})</h3>${tbl}</div>`;
    })
    .join("");

  const guestBlock =
    guestRows.length === 0
      ? ""
      : `<div class="summary-block"><h3>Guest / other winners</h3><div class="summary-table-wrap"><table class="summary-table"><tr><th>Name</th><th class="num">Wins</th></tr>${guestRows
          .map(([name, c]) => `<tr><td>${escapeHtml(name)}</td><td class="num">${c}</td></tr>`)
          .join("")}</table></div></div>`;

  dom.summaryContent.innerHTML = `
    <div class="summary-lists">
      <div class="summary-block">
        <h3>Wins overall (pod)</h3>
        <div class="summary-table-wrap">
          <table class="summary-table">
            <tr><th>Player</th><th class="num">Wins</th></tr>
            ${overallRows}
            <tr><td>Draws</td><td class="num">${stats.draws}</td></tr>
          </table>
        </div>
      </div>
      <div class="summary-block">
        <h3>Top commanders (overall)</h3>
        <div class="summary-table-wrap">${topOverall}</div>
      </div>
    </div>
    ${winsByYearTable}
    ${byYearCmd ? `<div class="summary-lists">${byYearCmd}</div>` : ""}
    ${guestBlock}
  `;
}

function renderGames(games) {
  if (!games.length) {
    dom.gamesList.innerHTML = '<p class="game-meta">No games logged yet.</p>';
    return;
  }

  dom.gamesList.innerHTML = games
    .map(({ payload }) => {
      const isDraw = payload.winner === "Draw";
      const winnerPlayer = payload.players.find((player) => player.won);
      const commander = winnerPlayer ? winnerPlayer.commander : "Unknown";
      return `
        <article class="game-row">
          <div><strong>${payload.date}</strong> - ${isDraw ? "<strong>Draw</strong>" : `Winner: <strong>${payload.winner}</strong> (${commander})`}</div>
          <div class="game-meta">Length ${payload.gameLengthMinutes} min | End turn ${payload.gameEndTurn}</div>
          <div class="game-meta">${payload.notableMoments || "No notable moments added."}</div>
        </article>
      `;
    })
    .join("");
}

async function loadGames() {
  dom.summaryError.classList.add("hidden");
  dom.summaryError.textContent = "";
  try {
    const all = useSupabase ? await getSupabaseGamesAll() : await getLocalGames();
    const recent = all.slice(0, 20);
    renderGames(recent);
    const stats = computeStats(all);
    dom.summaryGameCount.textContent = `${stats.totalGames} game${stats.totalGames === 1 ? "" : "s"} loaded`;
    renderSummary(stats);
  } catch (error) {
    renderGames([]);
    dom.summaryContent.innerHTML = "";
    dom.summaryGameCount.textContent = "";
    dom.summaryError.textContent = `Summary / list: ${error.message}`;
    dom.summaryError.classList.remove("hidden");
    setMessage(`Could not load games: ${error.message}`, "error");
  }
}

function clearForm() {
  dom.gameDate.value = today;
  dom.gameLengthMinutes.value = "";
  dom.gameEndTurn.value = "";
  dom.notableMoments.value = "";
  dom.winner.value = PLAYERS[0];
  PLAYERS.forEach((name) => {
    document.querySelector(`#commander-${name}`).value = "";
    document.querySelector(`#koTurn-${name}`).value = "";
    document.querySelector(`#koMethod-${name}`).value = "Survived";
  });
  if (requirePin) {
    dom.recorderPin.value = "";
  }
}

dom.gameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("Saving...");

  if (requirePin && dom.recorderPin.value !== appConfig.recorderPin) {
    setMessage("Recorder PIN was incorrect.", "error");
    return;
  }

  const payload = collectPayload();
  const validationError = validate(payload);
  if (validationError) {
    setMessage(validationError, "error");
    return;
  }

  try {
    if (useSupabase) {
      await saveSupabase(payload);
    } else {
      await saveLocal(payload);
    }
    setMessage("Game saved.", "success");
    clearForm();
    await loadGames();
  } catch (error) {
    setMessage(`Save failed: ${error.message}`, "error");
  }
});

dom.refreshBtn.addEventListener("click", async () => {
  setMessage("Refreshing...");
  await loadGames();
  setMessage("Loaded recent games.", "success");
});

dom.clearBtn.addEventListener("click", () => {
  clearForm();
  setMessage("Form cleared.");
});

await loadGames();

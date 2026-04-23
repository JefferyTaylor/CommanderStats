import { readFile } from "node:fs/promises";
import path from "node:path";

const configPath = path.join(process.cwd(), "config.js");
const text = await readFile(configPath, "utf8");
const supabaseUrl = text.match(/supabaseUrl:\s*"([^"]*)"/)?.[1] ?? "";
const supabaseAnonKey = text.match(/supabaseAnonKey:\s*"([^"]*)"/)?.[1] ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase config values");
}

const endpoint = `${supabaseUrl}/rest/v1/games?select=game_date`;
const res = await fetch(endpoint, {
  headers: {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
  },
});

if (!res.ok) {
  throw new Error(`Supabase error ${res.status}: ${await res.text()}`);
}

const rows = await res.json();
const byYear = rows.reduce((acc, row) => {
  const year = (row.game_date || "0000").slice(0, 4);
  acc[year] = (acc[year] || 0) + 1;
  return acc;
}, {});

console.log(`Total rows: ${rows.length}`);
console.log(`By year: ${JSON.stringify(byYear)}`);

# CommanderStats

Mobile-friendly MTG Commander game logger for Jeff, Chandler, Tom, and Noah.

## What This MVP Includes

- Fast entry form for weekly games
- Fixed player names for fewer taps
- Fields for date, game length, end turn, winner, commanders, KO turns, KO method, and notable moments
- Recent games list on the same page
- MTG-inspired dark/gold styling
- Works as static site on GitHub Pages

## Storage Modes

### 1) Local-only (default)
- No setup needed
- Saves only on the current phone/browser

### 2) Supabase (recommended)
- Shared data for your group from one link
- Still no login flow in the MVP

## Run Locally

Open `index.html` in a browser.

## Supabase Setup (No Login MVP)

1. Create a Supabase project.
2. In SQL Editor, run:

```sql
create table if not exists public.games (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  game_date date not null,
  winner text not null,
  game_length_minutes int not null,
  game_end_turn int not null,
  notable_moments text,
  payload jsonb not null
);

alter table public.games enable row level security;

drop policy if exists "public read games" on public.games;
drop policy if exists "public insert games" on public.games;

create policy "public read games"
on public.games for select
to anon
using (true);

create policy "public insert games"
on public.games for insert
to anon
with check (true);
```

3. In `config.js`, fill:
   - `supabaseUrl`
   - `supabaseAnonKey`
   - optional `recorderPin` (lightweight guard only)
4. Refresh the page. The badge should show `Storage: Supabase`.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. In repo settings, enable GitHub Pages from your main branch root.
3. Your app will be available at:
   - `https://<your-username>.github.io/<repo-name>/`

## Security Notes (Important)

No-login + shared link means anyone who gets the URL can read/write game data with this MVP policy.

For your friend group this is usually acceptable short-term, but it is not hardened.

Later hardening options:
- Add Supabase Auth (best long-term)
- Use an Edge Function with secret validation for writes
- Restrict reads/writes by authenticated users only

### Public GitHub repository

Keeping the repo public is fine for this setup if you follow the repo `.gitignore`:

- Do **not** commit `passwords.txt`, database passwords, or the **service role** key (only the publishable/anon key belongs in a browser app).
- `config.js` is gitignored so keys are not pushed by mistake. Anyone who opens your **live** GitHub Pages site can still see the anon key in the network tab (that is normal for Supabase client apps). The real protection is tightening Row Level Security later, not hiding the anon key in git.
- `raw_input*.txt` and `data/` are ignored so private notes and local import artifacts stay off GitHub.

For Pages, you still need `config.js` (or another inject step) **on the deployed branch**; easiest options are copy `config.example.js` → `config.js` locally and use a small GitHub Action to deploy with secrets, or add `config.js` only in a deploy workflow artifact (not committed to `main`).

## Importing Old Notes Later

This repo includes a one-time importer for the 2026 notes in `raw_input.txt`.

1. Ensure the `games` table and policies above are created in Supabase SQL Editor.
2. Ensure `config.js` has `supabaseUrl` and `supabaseAnonKey`.
3. Preview parsed data:
   - `node scripts/import-raw-2026.mjs --dry-run`
4. Import into Supabase:
   - `node scripts/import-raw-2026.mjs`

Notes:
- Importer skips the `RIFTBOUND` section.
- Mario is normalized to `Guest (Mario)`.
- Partner commanders are normalized:
  - `Donna + The Second Doctor`
  - `Susan + The Fourteenth Doctor`

This repo also includes a one-time importer for 2025 notes in `raw_input2.txt`.

1. Preview parsed data:
   - `node scripts/import-raw-2025.mjs --dry-run`
2. Import into Supabase:
   - `node scripts/import-raw-2025.mjs`

2025 import notes:
- Dedupes exact repeated blocks.
- Maps notable events by matching date when available.
- Writes local artifacts under `data/` (gitignored; re-run importers to regenerate):
  - `data/yearly-summary-2025.json`
  - `data/unmatched-notable-notes-2025.json`
- Normalizes `Traral` to `Guest (Tratal)` and `Dog and goblin these nuts` to `Three Dog`.

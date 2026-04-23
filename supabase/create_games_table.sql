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

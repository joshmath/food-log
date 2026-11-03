-- Food Log database schema.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.

create table if not exists public.entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day        date not null,
  meal       text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  name       text not null check (char_length(name) between 1 and 500),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists entries_user_day_idx on public.entries (user_id, day);

create table if not exists public.day_notes (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day        date not null,
  note       text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Row level security: each signed-in user can only see and change their own rows.
-- Requests without a valid login get nothing.
alter table public.entries   enable row level security;
alter table public.day_notes enable row level security;

drop policy if exists "own entries" on public.entries;
create policy "own entries" on public.entries
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own notes" on public.day_notes;
create policy "own notes" on public.day_notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

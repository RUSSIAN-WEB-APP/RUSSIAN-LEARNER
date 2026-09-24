-- Russian Learner 2.0 — Supabase schema upgrade
-- Run once in Supabase SQL Editor.
-- Safe to rerun. Keeps the original vocabulary/review tables and adds profiles + mistakes.

create extension if not exists pgcrypto;

create table if not exists public.vocabulary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  russian text not null check (char_length(trim(russian)) between 1 and 500),
  english text not null default '',
  category text not null default 'General',
  source_type text not null default 'word' check (source_type in ('word','phrase','sentence')),
  notes text not null default '',
  grammar text not null default '',
  example_sentence text not null default '',
  repetitions integer not null default 0,
  mastery integer not null default 0 check (mastery between 0 and 100),
  ease numeric(3,2) not null default 2.50,
  interval_days numeric(10,3) not null default 0,
  due_at timestamptz not null default now(),
  last_review_at timestamptz,
  lapses integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vocabulary add column if not exists grammar text not null default '';
alter table public.vocabulary add column if not exists example_sentence text not null default '';
alter table public.vocabulary add column if not exists source_type text not null default 'word';

alter table public.review_events add column if not exists xp integer not null default 0;
alter table public.vocabulary drop constraint if exists vocabulary_source_type_check;
alter table public.vocabulary add constraint vocabulary_source_type_check check (source_type in ('word','phrase','sentence'));

create unique index if not exists vocabulary_user_russian_english_idx
  on public.vocabulary (user_id, lower(trim(russian)), lower(trim(english)));
create index if not exists vocabulary_user_due_idx on public.vocabulary (user_id, due_at);
create index if not exists vocabulary_user_category_idx on public.vocabulary (user_id, category);

create table if not exists public.review_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vocabulary_id uuid not null references public.vocabulary(id) on delete cascade,
  correct boolean not null,
  grade text not null,
  exercise_type text not null default 'review',
  xp integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists review_events_user_created_idx on public.review_events (user_id, created_at desc);

create table if not exists public.user_mistakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vocabulary_id uuid references public.vocabulary(id) on delete cascade,
  error_type text not null default 'unknown',
  supplied_answer text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists user_mistakes_user_created_idx on public.user_mistakes (user_id, created_at desc);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Russian Learner',
  avatar text not null default 'RU',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vocabulary_set_updated_at on public.vocabulary;
create trigger vocabulary_set_updated_at before update on public.vocabulary
for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

-- Row Level Security
alter table public.vocabulary enable row level security;
alter table public.review_events enable row level security;
alter table public.user_mistakes enable row level security;
alter table public.profiles enable row level security;

-- Remove prior policies before recreation.
drop policy if exists "Users can read own vocabulary" on public.vocabulary;
drop policy if exists "Users can insert own vocabulary" on public.vocabulary;
drop policy if exists "Users can update own vocabulary" on public.vocabulary;
drop policy if exists "Users can delete own vocabulary" on public.vocabulary;
drop policy if exists "Users can read own review events" on public.review_events;
drop policy if exists "Users can insert own review events" on public.review_events;
drop policy if exists "Users can read own mistakes" on public.user_mistakes;
drop policy if exists "Users can insert own mistakes" on public.user_mistakes;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;

create policy "Users can read own vocabulary" on public.vocabulary for select using (auth.uid() = user_id);
create policy "Users can insert own vocabulary" on public.vocabulary for insert with check (auth.uid() = user_id);
create policy "Users can update own vocabulary" on public.vocabulary for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete own vocabulary" on public.vocabulary for delete using (auth.uid() = user_id);

create policy "Users can read own review events" on public.review_events for select using (auth.uid() = user_id);
create policy "Users can insert own review events" on public.review_events for insert with check (auth.uid() = user_id);

create policy "Users can read own mistakes" on public.user_mistakes for select using (auth.uid() = user_id);
create policy "Users can insert own mistakes" on public.user_mistakes for insert with check (auth.uid() = user_id);

create policy "Users can read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Optional starter profile trigger.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar)
  values (new.id, coalesce(split_part(new.email, '@', 1), 'Russian Learner'), 'RU')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Russian Learner: Supabase schema
-- Run this entire script in Supabase SQL Editor.
-- It creates your private vocabulary/review data and Row Level Security policies.

create extension if not exists pgcrypto;

create table if not exists public.vocabulary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  russian text not null check (char_length(trim(russian)) between 1 and 500),
  english text not null default '',
  category text not null default 'General',
  source_type text not null default 'word' check (source_type in ('word','phrase')),
  notes text not null default '',
  repetitions integer not null default 0,
  mastery integer not null default 0,
  ease numeric(3,2) not null default 2.50,
  interval_days numeric(10,3) not null default 0,
  due_at timestamptz not null default now(),
  last_review_at timestamptz,
  lapses integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vocabulary_user_russian_english_idx
  on public.vocabulary (user_id, lower(trim(russian)), lower(trim(english)));

create index if not exists vocabulary_user_due_idx
  on public.vocabulary (user_id, due_at);

create index if not exists vocabulary_user_category_idx
  on public.vocabulary (user_id, category);

create table if not exists public.review_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vocabulary_id uuid not null references public.vocabulary(id) on delete cascade,
  correct boolean not null,
  grade text not null,
  exercise_type text not null default 'flashcard',
  created_at timestamptz not null default now()
);

create index if not exists review_events_user_created_idx
  on public.review_events (user_id, created_at desc);

alter table public.vocabulary enable row level security;
alter table public.review_events enable row level security;

-- Make the schema script safe to rerun.
drop policy if exists "Users can read own vocabulary" on public.vocabulary;
drop policy if exists "Users can insert own vocabulary" on public.vocabulary;
drop policy if exists "Users can update own vocabulary" on public.vocabulary;
drop policy if exists "Users can delete own vocabulary" on public.vocabulary;
drop policy if exists "Users can read own review events" on public.review_events;
drop policy if exists "Users can insert own review events" on public.review_events;

-- Vocabulary policies
create policy "Users can read own vocabulary"
  on public.vocabulary for select
  using (auth.uid() = user_id);

create policy "Users can insert own vocabulary"
  on public.vocabulary for insert
  with check (auth.uid() = user_id);

create policy "Users can update own vocabulary"
  on public.vocabulary for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own vocabulary"
  on public.vocabulary for delete
  using (auth.uid() = user_id);

-- Review event policies
create policy "Users can read own review events"
  on public.review_events for select
  using (auth.uid() = user_id);

create policy "Users can insert own review events"
  on public.review_events for insert
  with check (auth.uid() = user_id);

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vocabulary_set_updated_at on public.vocabulary;
create trigger vocabulary_set_updated_at
before update on public.vocabulary
for each row execute function public.set_updated_at();

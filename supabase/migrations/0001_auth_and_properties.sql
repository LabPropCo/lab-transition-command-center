-- ============================================================================
-- M1 · Auth & property scoping
-- Tables: profiles, properties, property_members
-- Authorization: Row-Level Security is THE boundary. Deny-by-default.
-- Recursion-safety: RLS policies call SECURITY DEFINER helpers so a policy on
-- property_members never queries property_members through RLS (a classic loop).
-- ============================================================================

-- ---------- Roles ----------
do $$ begin
  create type public.member_role as enum
    ('admin','regional_manager','property_manager','accounting','transition_team','read_only');
exception when duplicate_object then null; end $$;

-- ---------- profiles (1:1 with auth.users) ----------
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  full_name         text,
  -- Director of Operations / backup: sees & manages every property.
  is_platform_admin boolean not null default false,
  created_at        timestamptz not null default now()
);

-- Auto-create a profile whenever an auth user is created (invite or seed).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- properties (one row per transition) ----------
create table if not exists public.properties (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  client          text,
  transition_date date,
  go_live         date,
  units           integer,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

-- ---------- property_members (user × property × role) ----------
create table if not exists public.property_members (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        public.member_role not null default 'transition_team',
  created_at  timestamptz not null default now(),
  primary key (property_id, user_id)
);
create index if not exists property_members_user_idx on public.property_members(user_id);

-- ---------- Authorization helpers (SECURITY DEFINER = bypass RLS internally) ----------
create or replace function public.is_platform_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.has_property_access(p_property_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_platform_admin()
      or exists (
           select 1 from public.property_members
           where property_id = p_property_id and user_id = auth.uid()
         );
$$;

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table public.profiles         enable row level security;
alter table public.properties       enable row level security;
alter table public.property_members enable row level security;

-- profiles: read own or (admin) all; update only own row.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (id = auth.uid() or public.is_platform_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
-- No client INSERT/DELETE: profiles are created by trigger; admin flag set server-side.

-- properties: members & admins read; only platform admins write from the client.
drop policy if exists properties_read on public.properties;
create policy properties_read on public.properties
  for select using (public.has_property_access(id));

drop policy if exists properties_admin_write on public.properties;
create policy properties_admin_write on public.properties
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- property_members: read own memberships or (admin) all; only admins write from client.
-- (The invite Edge Function uses the service-role key and bypasses RLS entirely.)
drop policy if exists members_read on public.property_members;
create policy members_read on public.property_members
  for select using (user_id = auth.uid() or public.is_platform_admin());

drop policy if exists members_admin_write on public.property_members;
create policy members_admin_write on public.property_members
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

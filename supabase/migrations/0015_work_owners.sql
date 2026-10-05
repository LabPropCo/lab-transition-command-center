-- ============================================================================
-- 0015 · v0.5.x — Master Work Owner roster (admin-editable, text-only design).
--
-- Replaces the hard-coded frontend OWNERS array with an admin-managed table.
-- Intentionally does NOT touch work_items.owner or work_item_templates.
-- default_owner: those remain plain, unconstrained text and stay the sole
-- source of truth for who is assigned. This table only supplies (a) what
-- options the two Owner dropdowns offer, and (b) who may edit that roster.
--
-- Explicitly deferred to a later phase (see docs/DEFAULT-OWNERSHIP.md /
-- ARCHITECTURE.md discussion): owner_id FK columns on work_items /
-- work_item_templates, identity/profile linking, notifications. None of that
-- is part of this migration. Renaming a roster entry here does NOT rewrite
-- any existing work_items.owner / work_item_templates.default_owner value —
-- those only change when a user edits that specific record by hand. Bulk
-- rename of historical data is intentionally out of scope for this phase.
--
-- Additive and idempotent: no existing table, column, constraint, or RPC
-- (instantiate_transition_work_items / instantiate_property_work_items /
-- Synchronize) is touched.
-- ============================================================================

create table if not exists public.work_owners (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  active       boolean not null default true,
  sort_order   integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Case-insensitive, whitespace-trimmed uniqueness among ACTIVE owners only
-- (an inactive/historical duplicate never blocks a new active entry — e.g. a
-- rehire). "Marcus Vidal", "marcus vidal", "Marcus Vidal ", and " Marcus
-- Vidal" all collide under this index.
create unique index if not exists work_owners_active_name_uq
  on public.work_owners (lower(trim(display_name)))
  where active;

-- ---------- updated_at bookkeeping (mirrors properties_touch, 0013) ----------
create or replace function public.work_owners_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_work_owners_touch on public.work_owners;
create trigger trg_work_owners_touch before update on public.work_owners
  for each row execute function public.work_owners_touch();

-- ---------- Audit: create / rename / activate-deactivate (mirrors properties_audit, 0013) ----------
-- Every roster change is written to the existing admin_audit_log with
-- entity_type = 'work_owner'. A create is one row (field='created'). A rename
-- is one row (field='display_name', old->new). An activate or a deactivate is
-- one row (field='active', old->new: 'true'->'false' or the reverse) — the
-- same old/new-value shape properties_audit already uses for its own
-- `active` column, so activate and deactivate are each individually
-- reconstructable from the log without needing separate field names.
create or replace function public.work_owners_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); actor_em text;
begin
  select email into actor_em from public.profiles where id = actor;
  if tg_op = 'INSERT' then
    insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
    values ('work_owner', new.id, actor, actor_em, 'created', null, new.display_name);
    return new;
  end if;
  if new.display_name is distinct from old.display_name then
    insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
    values ('work_owner', new.id, actor, actor_em, 'display_name', old.display_name, new.display_name);
  end if;
  if new.active is distinct from old.active then
    insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
    values ('work_owner', new.id, actor, actor_em, 'active', old.active::text, new.active::text);
  end if;
  return new;
end $$;
drop trigger if exists trg_work_owners_audit on public.work_owners;
create trigger trg_work_owners_audit after insert or update on public.work_owners
  for each row execute function public.work_owners_audit();

-- ============================================================================
-- Row-Level Security — any authenticated user reads; only platform admins
-- write (mirrors tpl_read / tpl_admin_write, 0002). Deactivation, not
-- deletion, is the supported lifecycle: no delete grant is issued below, so
-- the broader `for all` policy has no delete path to reach, exactly like
-- properties_admin_write (0001) vs. the properties grant (0013).
-- ============================================================================
alter table public.work_owners enable row level security;

drop policy if exists work_owners_read on public.work_owners;
create policy work_owners_read on public.work_owners
  for select using (auth.uid() is not null);

drop policy if exists work_owners_admin_write on public.work_owners;
create policy work_owners_admin_write on public.work_owners
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ---------- Explicit table grants (this app does not rely on Supabase default privileges — see 0008) ----------
grant select on public.work_owners to authenticated;
grant insert, update on public.work_owners to authenticated; -- gated by RLS to admins; no delete grant (deactivate, don't delete)
grant all on public.work_owners to service_role;

-- ---------- Seed the current roster so no manual DB edit is needed after deploy ----------
insert into public.work_owners (display_name, sort_order) values
  ('Dana Whitfield', 1),
  ('Marcus Vidal', 2),
  ('Priya Anand', 3),
  ('Theo Bianchi', 4),
  ('Rosa Marin', 5),
  ('IT Support', 6)
on conflict (lower(trim(display_name))) where active do nothing;

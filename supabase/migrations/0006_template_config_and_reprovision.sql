-- ============================================================================
-- 0006 · Make the methodology operationally configurable.
--
-- Principle: The Lab's methodology evolves through operational use. Business
-- rules are stored as configurable DATA (columns on work_item_templates), not
-- hard-coded logic. An admin can change a template's Scope / Phase / Workstream
-- / Priority / Gate / Dependencies at runtime (the future M6 Template Editor)
-- through the existing admin RLS policy (tpl_admin_write) — no migration or
-- developer needed.
--
-- Scope semantics:
--   * scope_type on a TEMPLATE is the default used at provisioning time.
--   * scope_type + property_id on a WORK ITEM is a snapshot fixed at creation.
--   * Changing a template's scope therefore affects FUTURE provisioning only.
--   * Existing transitions keep their existing work items (and audit history)
--     until an admin EXPLICITLY reprovisions.
-- ============================================================================

-- 1) Track template edits (audit-friendly; supports the M6 editor).
alter table public.work_item_templates add column if not exists updated_at timestamptz not null default now();
alter table public.work_item_templates add column if not exists updated_by uuid;

create or replace function public.work_item_templates_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_wit_touch on public.work_item_templates;
create trigger trg_wit_touch before update on public.work_item_templates
  for each row execute function public.work_item_templates_touch();

-- 2) Explicit, admin-only reprovision for an EXISTING transition.
-- Additive and NON-DESTRUCTIVE: creates only the work items that are missing
-- under the CURRENT template scope; never deletes, moves, or rewrites existing
-- items, so historical audit data is preserved. This is the only way a scope
-- change reaches an existing transition — and only when an admin chooses it.
create or replace function public.reprovision_transition(p_transition_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare added integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Only a platform admin may reprovision a transition';
  end if;
  select public.instantiate_transition_work_items(p_transition_id) into added;
  return added;
end $$;
revoke execute on function public.reprovision_transition(uuid) from public;
grant  execute on function public.reprovision_transition(uuid) to authenticated;

comment on column public.work_item_templates.scope_type is
  'Operational setting (default at provisioning). Editable by admins at runtime; changes affect future provisioning only. See docs/CONFIGURATION.md.';

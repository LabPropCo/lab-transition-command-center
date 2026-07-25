-- ============================================================================
-- 0013 · v0.4.3 acceptance fixes — Property administration + Community Director
-- as free text. Additive, idempotent, non-destructive: no work items are
-- created, duplicated, or deleted; transitions, memberships, audit, and RLS are
-- preserved. All 177 work items are untouched.
-- ============================================================================

-- 1) Property metadata (idempotent). Unit count reuses the existing `units`.
alter table public.properties add column if not exists address       text;
alter table public.properties add column if not exists city          text;
alter table public.properties add column if not exists state         text;
alter table public.properties add column if not exists zip           text;
alter table public.properties add column if not exists property_type text;
alter table public.properties add column if not exists notes         text;
alter table public.properties add column if not exists active        boolean not null default true;
alter table public.properties add column if not exists updated_at    timestamptz not null default now();

-- 2) Community Director free-text name is preserved (added in 0012; idempotent).
--    community_director_id remains nullable and untouched for a future release.
alter table public.transitions add column if not exists community_director_name text;

-- 3) Grants: admins edit properties from the browser. RLS (properties_admin_write:
--    is_platform_admin) already gates this; only the table grant was missing.
grant insert, update on public.properties to authenticated;   -- gated by RLS to admins

-- 4) Keep properties.updated_at fresh.
create or replace function public.properties_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_properties_touch on public.properties;
create trigger trg_properties_touch before update on public.properties
  for each row execute function public.properties_touch();

-- 5) Audit property creates and edits into admin_audit_log (entity_type 'property').
create or replace function public.properties_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); actor_em text; f text; oldv text; newv text;
  fields text[] := array['name','address','city','state','zip','units','property_type','notes','active','transition_id'];
begin
  select email into actor_em from public.profiles where id = actor;
  if tg_op = 'INSERT' then
    insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
    values ('property', new.id, actor, actor_em, 'created', null, new.name);
    return new;
  end if;
  foreach f in array fields loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into oldv, newv using old, new;
    if oldv is distinct from newv then
      insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
      values ('property', new.id, actor, actor_em, f, oldv, newv);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_properties_audit on public.properties;
create trigger trg_properties_audit after insert or update on public.properties
  for each row execute function public.properties_audit();

-- 6) Ensure Community Director *name* changes are audited (0012 tracked the id;
--    the UI now edits the name). Rebuild the transition audit field list to
--    include community_director_name.
create or replace function public.transitions_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); actor_em text; f text; oldv text; newv text;
  fields text[] := array['name','company_name','ownership_group','target_go_live_date','overall_status',
    'current_phase','community_director_id','community_director_name','transition_manager','regional_manager',
    'default_property_id','primary_color','secondary_color','logo_url','notes','active'];
begin
  select email into actor_em from public.profiles where id = actor;
  foreach f in array fields loop
    execute format('select ($1).%I::text, ($2).%I::text', f, f) into oldv, newv using old, new;
    if oldv is distinct from newv then
      insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
      values ('transition', new.id, actor, actor_em, f, oldv, newv);
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists trg_transitions_audit on public.transitions;
create trigger trg_transitions_audit after update on public.transitions
  for each row execute function public.transitions_audit();

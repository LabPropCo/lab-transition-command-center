-- ============================================================================
-- 0009 · Admin milestone, Phase 1 — transition metadata + admin audit.
-- Additive only. Requires 0007 + 0008 (grants) to be applied first.
-- ============================================================================

-- 1) Transition metadata fields (all nullable; name/target_go_live/overall_status exist).
alter table public.transitions add column if not exists company_name       text;
alter table public.transitions add column if not exists portfolio_manager  text;
alter table public.transitions add column if not exists transition_manager text;
alter table public.transitions add column if not exists regional_manager   text;
alter table public.transitions add column if not exists default_property_id uuid references public.properties(id) on delete set null;
alter table public.transitions add column if not exists primary_color      text;
alter table public.transitions add column if not exists secondary_color    text;
alter table public.transitions add column if not exists logo_url           text;
alter table public.transitions add column if not exists notes              text;

-- Company name has lived in ownership_group; backfill the dedicated column.
update public.transitions set company_name = ownership_group
  where company_name is null and ownership_group is not null;

-- Keep updated_at fresh on any transition change.
create or replace function public.transitions_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_transitions_touch on public.transitions;
create trigger trg_transitions_touch before update on public.transitions
  for each row execute function public.transitions_touch();

-- 2) General admin audit log (also serves the Phase 4 Audit Log UI).
create table if not exists public.admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,          -- 'transition' | 'property' | 'user' | 'template' | ...
  entity_id   uuid,
  actor_id    uuid,
  actor_email text,
  field       text not null,
  old_value   text,
  new_value   text,
  at          timestamptz not null default now()
);
create index if not exists admin_audit_entity_idx on public.admin_audit_log(entity_type, entity_id);
create index if not exists admin_audit_at_idx on public.admin_audit_log(at desc);

alter table public.admin_audit_log enable row level security;
drop policy if exists admin_audit_read on public.admin_audit_log;
create policy admin_audit_read on public.admin_audit_log
  for select using (public.is_platform_admin());
-- No client insert policy: rows are written only by SECURITY DEFINER triggers.

-- 3) Audit trigger for transition metadata edits (one row per changed field).
create or replace function public.transitions_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); actor_em text; f text; oldv text; newv text;
  fields text[] := array['name','company_name','ownership_group','target_go_live_date','overall_status',
    'current_phase','portfolio_manager','transition_manager','regional_manager','default_property_id',
    'primary_color','secondary_color','logo_url','notes','active'];
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

-- 4) Grants for admin writes from the browser (RLS still gates to admins).
grant update on public.transitions      to authenticated;  -- gated by transitions_admin_write
grant select on public.admin_audit_log  to authenticated;  -- gated by admin_audit_read
grant all    on public.admin_audit_log  to service_role;

-- 5) Branding storage bucket for logos (guarded: only where Supabase Storage exists).
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
      values ('branding','branding', true)
      on conflict (id) do nothing;

    -- Public read; admin-only write/update/delete on the branding bucket.
    if to_regclass('storage.objects') is not null then
      execute $p$ drop policy if exists branding_public_read on storage.objects $p$;
      execute $p$ create policy branding_public_read on storage.objects
        for select using (bucket_id = 'branding') $p$;
      execute $p$ drop policy if exists branding_admin_write on storage.objects $p$;
      execute $p$ create policy branding_admin_write on storage.objects
        for insert with check (bucket_id = 'branding' and public.is_platform_admin()) $p$;
      execute $p$ drop policy if exists branding_admin_update on storage.objects $p$;
      execute $p$ create policy branding_admin_update on storage.objects
        for update using (bucket_id = 'branding' and public.is_platform_admin()) $p$;
      execute $p$ drop policy if exists branding_admin_delete on storage.objects $p$;
      execute $p$ create policy branding_admin_delete on storage.objects
        for delete using (bucket_id = 'branding' and public.is_platform_admin()) $p$;
    end if;
  end if;
end $$;

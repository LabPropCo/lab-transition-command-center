-- ============================================================================
-- 0012 · Replace transition "Portfolio Manager" with "Community Director".
-- Community Director references an actual user (profiles), not free text, and
-- may be left blank. This does NOT migrate the former Portfolio Manager value:
-- portfolio_manager is dropped and community_director_id initializes to null on
-- every transition. No name->user matching is attempted, so no prior assignment
-- is carried over (intentional). Also removes the Portfolio-Manager default
-- introduced in 0011. FK uses ON DELETE SET NULL so removing a user clears the
-- assignment rather than blocking the delete or leaving an invalid reference.
-- ============================================================================

-- 1) Remove the Portfolio-Manager default trigger from 0011.
drop trigger  if exists trg_transitions_default_pm on public.transitions;
drop function if exists public.transitions_default_pm();

-- 2) Add Community Director as a user reference (nullable; blank allowed).
alter table public.transitions
  add column if not exists community_director_id uuid references public.profiles(id) on delete set null;
-- Denormalized display name so members who can't read arbitrary profiles (RLS)
-- can still see who the Community Director is. Set from the selected user on save.
-- NOTE: this is a cache and may become stale if the user's profile name changes;
-- Phase 3 will add a secure display-name lookup / refresh (see docs).
alter table public.transitions add column if not exists community_director_name text;

-- 3) Rebuild the transition audit trigger without portfolio_manager and with
--    community_director_id, so metadata edits keep auditing correctly.
create or replace function public.transitions_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor uuid := auth.uid(); actor_em text; f text; oldv text; newv text;
  fields text[] := array['name','company_name','ownership_group','target_go_live_date','overall_status',
    'current_phase','community_director_id','transition_manager','regional_manager','default_property_id',
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

-- 4) Drop the Portfolio Manager column now that nothing references it.
alter table public.transitions drop column if exists portfolio_manager;

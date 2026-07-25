-- ============================================================================
-- 0011 · Intelligent default ownership.
-- Additive. On creation only, fill UNassigned owners with the authenticated
-- user; never overwrite an existing assignment. The methodology's owner ROLE
-- (responsible_party) is always preserved; only the assigned USER (owner) is
-- defaulted, and only when neither the methodology nor an existing row set it.
-- ============================================================================

-- Display value for the current user (name if known, else email). Returns null
-- when there is no auth context (e.g. seed/migration), so those paths are
-- unaffected and fall back to the methodology's own default owner.
create or replace function public.current_user_display()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(p.full_name, p.email) from public.profiles p where p.id = auth.uid();
$$;
grant execute on function public.current_user_display() to authenticated;

-- 1) New transition -> default Portfolio Manager to the creator (only if unset).
create or replace function public.transitions_default_pm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.portfolio_manager is null then
    new.portfolio_manager := public.current_user_display();  -- null-safe; stays null without auth
  end if;
  return new;
end $$;
drop trigger if exists trg_transitions_default_pm on public.transitions;
create trigger trg_transitions_default_pm before insert on public.transitions
  for each row execute function public.transitions_default_pm();

-- 2) Instantiation defaults the assigned USER to the current user only when the
-- methodology does not name one: owner = coalesce(template.default_owner,
-- current_user_display()). responsible_party (the role) is untouched. Because
-- instantiation only inserts rows that don't yet exist, existing assignments are
-- never overwritten. (Identical to 0010 otherwise.)
create or replace function public.instantiate_transition_work_items(p_transition_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; m integer := 0; v_id uuid; v_go_live date;
begin
  select id into v_id from public.methodology_versions where is_current limit 1;
  select target_go_live_date into v_go_live from public.transitions where id = p_transition_id;

  insert into public.work_items
    (transition_id, property_id, template_id, code, scope_type, sort_order, phase, phase_order,
     workstream, sub_workstream, description, completion_standard, owner, responsible_party,
     priority, go_live_gate, critical_path, stage, depends_on_code, due_date, due_date_source, status)
  select p_transition_id, null, t.id, t.code, 'transition', t.sort_order, t.phase, t.phase_order,
     t.workstream, t.sub_workstream, t.description, t.completion_standard,
     coalesce(t.default_owner, public.current_user_display()),
     t.responsible_party, t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code,
     case when t.due_offset_days is not null and v_go_live is not null then v_go_live + t.due_offset_days end,
     'methodology', 'Not Started'
  from public.work_item_templates t
  where t.scope_type = 'transition' and not t.archived
    and not exists (select 1 from public.work_items w
                    where w.transition_id = p_transition_id and w.property_id is null and w.template_id = t.id);
  get diagnostics n = row_count;

  insert into public.work_items
    (transition_id, property_id, template_id, code, scope_type, sort_order, phase, phase_order,
     workstream, sub_workstream, description, completion_standard, owner, responsible_party,
     priority, go_live_gate, critical_path, stage, depends_on_code, due_date, due_date_source, status)
  select p_transition_id, p.id, t.id, t.code, 'property', t.sort_order, t.phase, t.phase_order,
     t.workstream, t.sub_workstream, t.description, t.completion_standard,
     coalesce(t.default_owner, public.current_user_display()),
     t.responsible_party, t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code,
     case when t.due_offset_days is not null and v_go_live is not null then v_go_live + t.due_offset_days end,
     'methodology', 'Not Started'
  from public.work_item_templates t
  cross join public.properties p
  where t.scope_type = 'property' and not t.archived and p.transition_id = p_transition_id
    and not exists (select 1 from public.work_items w
                    where w.transition_id = p_transition_id and w.property_id = p.id and w.template_id = t.id);
  get diagnostics m = row_count;

  if v_id is not null then
    update public.transitions set methodology_version_id = v_id where id = p_transition_id;
  end if;
  return n + m;
end $$;
revoke execute on function public.instantiate_transition_work_items(uuid) from public;

create or replace function public.instantiate_property_work_items(p_property_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; t_id uuid; v_go_live date;
begin
  select transition_id into t_id from public.properties where id = p_property_id;
  select target_go_live_date into v_go_live from public.transitions where id = t_id;
  insert into public.work_items
    (transition_id, property_id, template_id, code, scope_type, sort_order, phase, phase_order,
     workstream, sub_workstream, description, completion_standard, owner, responsible_party,
     priority, go_live_gate, critical_path, stage, depends_on_code, due_date, due_date_source, status)
  select t_id, p_property_id, t.id, t.code, 'property', t.sort_order, t.phase, t.phase_order,
     t.workstream, t.sub_workstream, t.description, t.completion_standard,
     coalesce(t.default_owner, public.current_user_display()),
     t.responsible_party, t.priority, t.go_live_gate, t.critical_path, t.stage, t.depends_on_code,
     case when t.due_offset_days is not null and v_go_live is not null then v_go_live + t.due_offset_days end,
     'methodology', 'Not Started'
  from public.work_item_templates t
  where t.scope_type = 'property' and not t.archived
    and not exists (select 1 from public.work_items w where w.property_id = p_property_id and w.template_id = t.id);
  get diagnostics n = row_count; return n;
end $$;
revoke execute on function public.instantiate_property_work_items(uuid) from public;

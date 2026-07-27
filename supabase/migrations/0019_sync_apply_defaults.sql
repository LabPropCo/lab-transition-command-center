-- ============================================================================
-- 0019 · Fix Synchronize default-selection defect (Sprint 18.3).
--
-- sync_preview always shows pending Rename and Metadata changes regardless
-- of selection, but apply_transition_sync's p_rename/p_metadata parameters
-- defaulted to false. A user who edits a methodology item, opens Synchronize,
-- sees the change in the preview, and clicks "Apply selected" without
-- separately checking those two boxes gets a silent no-op ("renamed 0,
-- updated 0") with no error and no audit trail. The UI checkbox defaults are
-- fixed in SyncPanel.tsx (rename/metadata now default to true, matching the
-- always-true add default); this migration makes direct RPC callers match by
-- flipping the same two SQL defaults. No other behavior changes — explicit
-- callers that already pass true/false for these params are unaffected.
-- ============================================================================

create or replace function public.apply_transition_sync(
  p_transition_id uuid,
  p_add boolean default true,
  p_rename boolean default true,
  p_metadata boolean default true,
  p_due boolean default false,
  p_skip_completed boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare added int := 0; renamed int := 0; updated int := 0; dued int := 0;
        actor uuid := auth.uid(); actor_em text; v_go_live date;
begin
  if not public.is_platform_admin() then raise exception 'Only a platform admin may synchronize a transition'; end if;
  select email into actor_em from public.profiles where id = actor;
  select target_go_live_date into v_go_live from public.transitions where id = p_transition_id;

  if p_add then
    select public.instantiate_transition_work_items(p_transition_id) into added;
  end if;

  if p_rename then
    with upd as (
      update public.work_items w set description = t.description, completion_standard = t.completion_standard
        from public.work_item_templates t
        where w.transition_id = p_transition_id and w.template_id = t.id and not t.archived
          and (w.description is distinct from t.description or w.completion_standard is distinct from t.completion_standard)
          and (not p_skip_completed or w.status <> 'Complete')
          and not exists (select 1 from public.transition_sync_deferrals d
                          where d.transition_id = p_transition_id and d.template_id = t.id and d.change_type = 'rename'
                            and d.fingerprint = public.sync_fp('rename', t.id, v_go_live))
        returning w.id)
    select count(*) into renamed from upd;
  end if;

  if p_metadata then
    with upd as (
      update public.work_items w
        set workstream = t.workstream, phase = t.phase, phase_order = t.phase_order,
            priority = t.priority, responsible_party = t.responsible_party,
            go_live_gate = t.go_live_gate, critical_path = t.critical_path,
            stage = t.stage, depends_on_code = t.depends_on_code, sort_order = t.sort_order
        from public.work_item_templates t
        where w.transition_id = p_transition_id and w.template_id = t.id and not t.archived
          and (not p_skip_completed or w.status <> 'Complete')
          and not exists (select 1 from public.transition_sync_deferrals d
                          where d.transition_id = p_transition_id and d.template_id = t.id and d.change_type = 'metadata'
                            and d.fingerprint = public.sync_fp('metadata', t.id, v_go_live))
          and (w.workstream is distinct from t.workstream or w.phase is distinct from t.phase
            or w.priority is distinct from t.priority or w.responsible_party is distinct from t.responsible_party
            or w.go_live_gate is distinct from t.go_live_gate or w.critical_path is distinct from t.critical_path
            or w.depends_on_code is distinct from t.depends_on_code
            or w.phase_order is distinct from t.phase_order or w.stage is distinct from t.stage
            or w.sort_order is distinct from t.sort_order)
        returning w.id)
    select count(*) into updated from upd;
  end if;

  if p_due and v_go_live is not null then
    with upd as (
      update public.work_items w set due_date = v_go_live + t.due_offset_days
        from public.work_item_templates t
        where w.transition_id = p_transition_id and w.template_id = t.id and not t.archived
          and t.due_offset_days is not null and w.due_date_source = 'methodology'   -- never manual overrides
          and (not p_skip_completed or w.status <> 'Complete')
          and w.due_date is distinct from (v_go_live + t.due_offset_days)
          and not exists (select 1 from public.transition_sync_deferrals d
                          where d.transition_id = p_transition_id and d.template_id = t.id and d.change_type = 'due'
                            and d.fingerprint = public.sync_fp('due', t.id, v_go_live))
        returning w.id)
    select count(*) into dued from upd;
  end if;

  update public.transitions
     set methodology_version_id = (select id from public.methodology_versions where is_current limit 1)
   where id = p_transition_id;

  -- Only record an audit entry when something actually changed; a no-op sync is silent.
  if (added + renamed + updated + dued) > 0 then
    insert into public.admin_audit_log(entity_type, entity_id, actor_id, actor_email, field, old_value, new_value)
    values ('transition_sync', p_transition_id, actor, actor_em, 'synchronize', null,
            format('added=%s renamed=%s updated=%s due=%s', added, renamed, updated, dued));
  end if;

  return jsonb_build_object('added', added, 'renamed', renamed, 'updated', updated, 'due', dued);
end $$;

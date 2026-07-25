-- ============================================================================
-- 0014 · v0.4.4 — Enforce controlled responsible_party vocabulary on
-- work_item_templates, matching work_items_resp_chk EXACTLY.
--
-- Schema-only. Contains NO business-specific data edits (the T107 correction is a
-- separate, reviewed operational step — see docs/operational/0014_t107_correction.sql).
-- Aborts (does not coerce) if any template holds an out-of-vocabulary value, so the
-- constraint is added only once the data is clean. Idempotent. Does not modify
-- migrations 0001-0013, synchronization, RLS, or audit behavior.
-- ============================================================================
begin;

-- Guard: refuse to proceed (naming offenders) if any invalid value remains.
-- Correct those as a separate data change first, then re-run 0014.
do $$
declare offending text;
begin
  select string_agg(code || ' => ' || responsible_party, ', ' order by code)
    into offending
  from public.work_item_templates
  where responsible_party is not null
    and responsible_party not in ('The Lab','Client','Prior Manager','Vendor','Shared');
  if offending is not null then
    raise exception
      'Aborting 0014: out-of-vocabulary work_item_templates.responsible_party value(s): %. Correct as a separate data change, then re-run 0014.', offending;
  end if;
end $$;

-- Constraint change (values EXACTLY match work_items_resp_chk). Idempotent.
alter table public.work_item_templates drop constraint if exists work_item_templates_resp_chk;
alter table public.work_item_templates
  add constraint work_item_templates_resp_chk
  check (responsible_party is null or responsible_party in
    ('The Lab','Client','Prior Manager','Vendor','Shared'));

commit;

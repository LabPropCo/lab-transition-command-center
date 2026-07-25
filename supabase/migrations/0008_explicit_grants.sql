-- ============================================================================
-- 0008 · Explicit table privileges — do not depend on Supabase default
-- privileges. (0007 hot-fixed the transition tables; this establishes the full,
-- intended privilege model for every app table so a clean rebuild is
-- self-sufficient and the "permission denied" class of bug cannot recur.)
--
-- Model: RLS is the ONLY authorization boundary. We grant `authenticated` the
-- privileges each table's RLS policies are designed to govern; the policies
-- (is_platform_admin / has_transition_access / can_write_work_item / etc.) do
-- the actual gating. Writes with no permitting policy are denied even with the
-- grant. All statements are idempotent (GRANT is a no-op if already present).
-- ============================================================================

-- Reads (rows still filtered by RLS to what each user may see).
grant select on public.profiles                     to authenticated;
grant select on public.properties                   to authenticated;
grant select on public.work_item_templates          to authenticated;
grant select on public.work_items                   to authenticated;
grant select on public.audit_log                    to authenticated;
grant select on public.transitions                  to authenticated;
grant select on public.transition_members           to authenticated;
grant select on public.transition_member_properties to authenticated;

-- Writes that legitimately originate from the browser, each gated by RLS:
grant update             on public.profiles            to authenticated; -- own row only (profiles_update_self)
grant update             on public.work_items          to authenticated; -- gated by can_write_work_item
grant insert,update,delete on public.work_item_templates to authenticated; -- gated by tpl_admin_write (M6 editor)

-- NOTE: audit_log gets SELECT only. Rows are written exclusively by the
-- SECURITY DEFINER audit trigger, protecting audit integrity — no client insert.
-- Provisioning inserts into work_items happen via SECURITY DEFINER functions,
-- so `authenticated` needs no INSERT there. Admin writes to transitions /
-- members are performed server-side (service_role) below.

-- Server-side role used by Edge Functions (never exposed to the browser).
grant all on public.profiles                     to service_role;
grant all on public.properties                   to service_role;
grant all on public.work_item_templates          to service_role;
grant all on public.work_items                   to service_role;
grant all on public.audit_log                    to service_role;
grant all on public.transitions                  to service_role;
grant all on public.transition_members           to service_role;
grant all on public.transition_member_properties to service_role;

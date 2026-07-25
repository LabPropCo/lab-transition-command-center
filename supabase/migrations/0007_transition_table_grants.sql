-- ============================================================================
-- 0007 · Table privileges for the new transition tables.
--
-- Root cause of "permission denied for table transitions": the tables created
-- in 0004 (transitions, transition_members, transition_member_properties) did
-- not receive the role privileges that Supabase's default-privilege setup had
-- applied to earlier tables. PostgreSQL checks table-level privileges BEFORE
-- RLS, so the `authenticated` role was denied before any policy ran.
--
-- A table GRANT is a prerequisite for RLS, not a replacement for it. These
-- grants do NOT weaken security: every row remains filtered by the existing RLS
-- policies, and no write privilege is given to the browser (`authenticated`)
-- role — admin writes stay server-side via the service role + is_platform_admin.
-- ============================================================================

-- Logged-in users may READ; RLS still restricts rows to what they may access.
grant select on public.transitions                  to authenticated;
grant select on public.transition_members           to authenticated;
grant select on public.transition_member_properties to authenticated;

-- Server-side only: Edge Functions (e.g. invite-user) use the service role,
-- which is never exposed to the browser. Client writes stay off these tables.
grant all on public.transitions                  to service_role;
grant all on public.transition_members           to service_role;
grant all on public.transition_member_properties to service_role;

-- Notes:
--  * Row-level writes are gated by the is_platform_admin() policies from 0005.
--  * The reprovision RPC is SECURITY DEFINER and already executable by
--    `authenticated` (granted in 0006), so it needs no extra table grants.

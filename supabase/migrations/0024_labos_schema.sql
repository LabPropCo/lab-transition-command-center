-- ============================================================================
-- 0024 · LabOS, part 1: schema
--
-- LabOS is a separate module of the same operating system, not a separate
-- application — it lives in this same Supabase project (see
-- docs/RIVER-RUN-INGESTION-ARCHITECTURE.md, Section 2d) under its own schema
-- so it gets a real security boundary (dedicated grants/RLS) without a second
-- project, and reuses the Transition Center's existing identity
-- (public.profiles / public.is_platform_admin()) rather than a second auth
-- system.
-- ============================================================================

create schema if not exists labos;

-- Deny-by-default, same posture as every other schema in this project.
revoke all on schema labos from public;

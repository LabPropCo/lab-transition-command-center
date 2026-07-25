# MIGRATION ORDER — through DB level 0014

All migrations are guarded (create-if-not-exists / or-replace / drop-if-exists /
guarded enum blocks / on-conflict seeds). Statement-level idempotency is proven by
the release gate (Check D re-applies the full chain twice with no error), so every
migration is **safe to rerun**; rerunning an applied one is a harmless no-op. Best
practice is still to apply only the outstanding ones.

| # | Depends on | Safe to rerun | Idempotent | Validation query | Expected |
|---|-----------|---------------|------------|------------------|----------|
| 0001 | — | Yes | Yes | `select to_regclass('public.profiles') is not null;` | t |
| 0002 | 0001 | Yes | Yes | `select to_regclass('public.work_items') is not null;` | t |
| 0003 | 0002 | Yes | Yes | `select exists(select 1 from public.work_item_templates);` | t |
| 0004 | 0002 | Yes | Yes | `select to_regclass('public.transitions') is not null;` | t |
| 0005 | 0004 | Yes | Yes | `select to_regclass('public.transition_members') is not null and to_regclass('public.property_members') is null;` | t |
| 0006 | 0002 | Yes | Yes | `select to_regprocedure('public.reprovision_transition(uuid)') is not null;` | t |
| 0007 | 0004 | Yes | Yes | `select has_table_privilege('authenticated','public.transitions','select');` | t |
| 0008 | 0002,0004 | Yes | Yes | `select has_table_privilege('authenticated','public.work_item_templates','insert');` | t |
| 0009 | 0004 | Yes | Yes | `select exists(select 1 from information_schema.columns where table_schema='public' and table_name='transitions' and column_name='company_name');` | t |
| 0010 | 0004–0009 | Yes | Yes | `select to_regprocedure('public.sync_preview(uuid)') is not null and to_regclass('public.methodology_versions') is not null;` | t |
| 0011 | 0010 | Yes | Yes | `select to_regprocedure('public.current_user_display()') is not null;` | t |
| 0012 | 0009,0011 | Yes | Yes | `select exists(select 1 from information_schema.columns where table_schema='public' and table_name='transitions' and column_name='community_director_id') and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='transitions' and column_name='portfolio_manager');` | t |
| 0013 | 0009,0012 | Yes | Yes | `select exists(select 1 from information_schema.columns where table_schema='public' and table_name='properties' and column_name='active') and has_table_privilege('authenticated','public.properties','update');` | t |
| 0014 | 0002,0003,0013 | Yes | Yes | `select count(*) from pg_constraint where conname='work_item_templates_resp_chk' and conrelid='public.work_item_templates'::regclass;` | 1 |

## One-shot detection (which are applied)
Run the consolidated query in the deployment notes; any row with `present = false`
is outstanding. Apply outstanding migrations in ascending order only.

## Notes on data-affecting steps
- **0003** seeds templates with `on conflict (code) do nothing` — never overwrites
  edited templates on rerun.
- **0005** backfill is gated on `transition_id is null` — a no-op once applied.
- **0010** seeds baseline v1.0 only `if not exists` — no duplicate on rerun.
- **0012** uses `drop column if exists` / `add column if not exists` — a rerun is a
  no-op. Take the pre-flight backup first (see DEPLOYMENT.md).

## 0014 special handling (schema-only + separate data correction)
0014 is transaction-wrapped and adds `work_item_templates_resp_chk` (matching
`work_items_resp_chk`). It contains **no data edits** and **aborts** if any template
holds an out-of-vocabulary `responsible_party`, naming the offenders. Correct data
first via the separate, reviewed step `docs/operational/0014_t107_correction.sql`
(guarded T107 update returning exactly one row). Live order: detect → confirm T107
only → guarded correction → re-detect zero → apply 0014 → `notify pgrst, 'reload schema';`
→ re-test Synchronize.

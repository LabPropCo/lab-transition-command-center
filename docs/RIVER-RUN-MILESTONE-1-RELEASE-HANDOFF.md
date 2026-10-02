# River Run Ingestion — Milestone 1 Release Handoff

**Scope note:** this handoff covers only the LabOS ingestion work described in `RIVER-RUN-MILESTONE-1-BUILD-PLAN.md` (migrations `0024`–`0030` and everything under `src/labos/`, `scripts/labos/`, `src/screens/labos/`). The working tree also contains unrelated uncommitted work from earlier sessions (the Administration module, the LabOS Home shell, Vendor Import fixes) — that work is out of scope here and not represented in this document's inventory, risk review, or commit plan.

---

## 1. Milestone Status

| Dimension | Status |
|---|---|
| Build | ✅ **Complete** — all 9 planned tasks (schema, types, adapter, validation, normalization, Sync Run orchestration, both repository implementations, CLI entrypoint, review screen) delivered |
| Application logic | ✅ **Verified** — 35 automated tests, all passing, covering validation, normalization, idempotency, overwrite/supersede, partial-failure rollback, safe rerun, audit-trail writes, Operational Memory write behavior |
| Real workbook ingestion | ✅ **Verified** — run against the actual `River Run Weekly Summary 2026.07.26.xlsx` via `npm run labos:sync`; produced 3 official + 3 excluded new rentals, 5 move-ins, 0 move-outs, 1 cancel/denial, 15 exposure records (current exposure 8), 71 traffic leads, 71 Operational Memory entries, 0 blocking validation errors |
| Database execution | ⏳ **Verification pending** — no migration has been applied to any real Postgres instance. All of the above is proven against pure functions, an in-memory mock repository, or a hand-built fake Supabase client. See Section 5 for exactly what is and isn't covered, and the build plan's Database Verification Checklist for how to close this gap |
| Production deployment | ⛔ **Not approved.** Nothing in this milestone has touched the linked Supabase project. Approval requires, at minimum, the Database Verification Checklist being executed against a real target and your explicit sign-off per the standing production-change disclosure policy |

**Since the last handoff:** release blockers #4 (hardcoded property) and #5 (implicit repository authorization) have been closed locally. Property/period identity is now an explicit, required `IngestionConfig` — no hardcoding, no default, no filename inference — and every Sync Run now runs a real database-privilege preflight (`checkIngestionCapability()`) before creating anything, with a browser-context construction guard on `SupabaseLabosRepository`. Details in Sections 2, 5, and 6 below. Database execution verification is still pending — closing these two blockers changed *what* needs verifying against a real database, not whether it still needs to happen.

---

## 2. Release Inventory

### New migrations (8, none applied anywhere)
`supabase/migrations/0024_labos_schema.sql`, `0025_labos_properties.sql`, `0026_labos_sync_runs.sql`, `0027_labos_leasing_entities.sql`, `0028_labos_operational_memory.sql`, `0029_labos_weekly_kpi.sql`, `0030_labos_rls.sql`, `0031_labos_capability_check.sql`

### New source files
```
src/labos/
  types.ts                              canonical payload/entity shapes
  config.ts                              IngestionConfig — explicit property/period identity, no defaults
  normalize.ts + normalize.test.ts       payload -> DB-ready rows, KPI aggregation
  repository.ts                          LabosRepository interface (the DB boundary; now incl. checkIngestionCapability)
  repository.mock.ts                     in-memory implementation (all tests run against this)
  repository.supabase.ts                 real implementation (type-checked + mock-client-tested, never executed live); browser-context construction guard
  repository.supabase.test.ts            tests for the above, against a hand-built fake Supabase client
  syncRun.ts + syncRun.test.ts            Sync Run state machine / orchestrator; IngestionAuthorizationError; capability preflight as its first step
  testHelpers.ts                         shared test fixture builder (incl. testIngestionConfig)
  api.ts                                 read layer for the Sync Review screen
  adapters/
    sectionScanner.ts + .test.ts          SUMMARY sheet section-boundary parser
    weeklySummaryAdapter.ts + .test.ts    full 4-sheet Weekly-Summary adapter; property name now genuinely extracted from the workbook, not hardcoded
  validation/
    rules.ts + rules.test.ts              Validation Matrix (V1-V14) as executable rules
  sourceFileProviders/
    localFileProvider.ts                  Milestone-1 file source (local path -> SourceFileHandle)

scripts/labos/
  run-sync.ts                            developer CLI entrypoint (`npm run labos:sync`)

src/screens/labos/
  SyncReview.tsx                         presentational review component
  SyncReviewDemo.tsx                     demo harness (synthetic data, runs the real pipeline in-browser)

src/styles/labos-sync-review.css         styling for the above

docs/
  RIVER-RUN-DASHBOARD-PRD.md              Phase 1 PRD (context/lineage)
  RIVER-RUN-INGESTION-ARCHITECTURE.md     architecture design
  RIVER-RUN-MILESTONE-1-BUILD-PLAN.md     this milestone's build plan (now includes the Database Verification Checklist)
  RIVER-RUN-MILESTONE-1-RELEASE-HANDOFF.md  this document
```

### Modified existing files (this milestone's changes only)
- `src/app/router.tsx` — one import + one route added (`labos/sync-review` → `SyncReviewDemo`), not linked from any navigation. +21/-1 lines.
- `package.json` — added `"test": "vitest run"` and `"labos:sync": "tsx scripts/labos/run-sync.ts"` scripts; added `vitest`, `tsx`, `@types/node` to `devDependencies`.
- `package-lock.json` — regenerated by `npm install`, no manual edits.
- `supabase/config.toml` — added an `[api]` block exposing the `labos` schema to PostgREST for local/dev (`schemas = ["public", "labos", "graphql_public"]`). **Not mirrored to the production project's dashboard setting** — that's a separate production config change requiring its own disclosure and approval.

### New routes
- `/labos/sync-review` — internal diagnostic screen, renders `SyncReviewDemo` (synthetic data, mock repository, no live DB). Not reachable from any nav/sidebar.

### New dependencies
| Package | Version | Why |
|---|---|---|
| `vitest` | `^4.1.10` | This repo's first-ever test runner — required to fulfill the build plan's test strategy |
| `tsx` | `^4.23.1` | Runs the TypeScript CLI script directly (`scripts/labos/run-sync.ts`) without a separate compile step |
| `@types/node` | `^26.1.2` | Type definitions for the CLI script's use of `node:fs/promises`, `process`, etc. |

### New npm scripts
- `npm run test` → `vitest run`
- `npm run labos:sync -- --file "<path>" --property-name "<name>" --reporting-period-end <YYYY-MM-DD> --workbook-alias <alias> [--triggered-by <id>] [--confirm-overwrite]` — all four of `--file`/`--property-name`/`--reporting-period-end`/`--workbook-alias` are now required, with no default property; the CLI fails with a clear usage message if any are missing.

### New database objects (defined in migrations, not yet applied anywhere)
- **Schema:** `labos`
- **Tables (11):** `properties`, `floorplans`, `units`, `sync_runs`, `source_files`, `validation_results`, `leasing_transactions`, `exposure_records`, `traffic_leads`, `operational_memory`, `weekly_kpi_snapshots`
- **Enum types (7):** `sync_run_status`, `source_type`, `validation_severity`, `leasing_event_type`, `new_rental_exclusion_reason`, `exposure_status`, `memory_type`
- **Functions/triggers (2):** `labos.prevent_operational_memory_content_edit()` + `trg_operational_memory_immutable`; `labos.check_ingestion_capability()` (the authorization preflight — plain SQL, not `security definer`, so it reports the *actual calling role's* privileges via `has_schema_privilege`/`has_table_privilege`, not the function owner's)
- **Indexes:** `sync_runs_active_week` (partial unique index enforcing one active completed run per property/week), plus the unique constraints in the table definitions below
- **RLS policies (11):** `labos_read_platform_admin` on every table, read-only, reusing `public.is_platform_admin()`
- **Grants:** `usage` on schema to `authenticated`/`service_role`; `select` on all tables to `authenticated`; `all` on all tables to `service_role`; `execute` on `check_ingestion_capability()` to `authenticated`/`service_role` (deliberately broad — an under-privileged `authenticated` caller must be able to run the preflight and get an honest "not authorized" answer)

### Configuration changes
- Local/dev `supabase/config.toml`: `labos` schema exposed via `[api].schemas`.
- **Not changed:** anything in the production Supabase dashboard, the production project's schema-exposure setting, or any environment variable/secret.

---

## 3. Migration Risk Review

General note before the per-file breakdown: every migration here is **purely additive** — new schema, new tables, no `ALTER TABLE` on anything pre-existing, no touching `public`. That structurally caps the blast radius and lock risk far below a typical schema-change migration. The real risks in this batch are about the schema's own internal correctness and about what happens *after* real data starts flowing through it, not about breaking the existing Transition Center.

| # | Purpose | Objects Created | Dependencies | Locking/Downtime Risk | Failure Modes | Rollback Implications |
|---|---|---|---|---|---|---|
| **0024** | Create the `labos` schema | Schema `labos` | None | None — schema creation is instantaneous and affects nothing else | Fails only if the schema name already exists (it won't, on a fresh project) | `drop schema labos cascade` — safe here specifically because nothing has been created inside it yet |
| **0025** | Reference data | `properties`, `floorplans`, `units` tables | `0024` | None — new tables only | A duplicate `name`/`type_code`/`unit_number` insert fails the relevant `unique` constraint (by design) | Safe to drop in isolation only if `0024` is also being rolled back; these tables have no data risk on their own until Sync Runs start referencing them |
| **0026** | Sync Run audit/lineage skeleton | `sync_run_status`, `source_type`, `validation_severity` enums; `sync_runs`, `source_files`, `validation_results` tables; `sync_runs_active_week` partial unique index | `0024`, `0025` (FK to `properties`), `public.profiles` (FK, must already exist — it does, from migration `0001`) | None | A concurrent double-"complete" for the same property/week correctly fails on `sync_runs_active_week` rather than silently allowing two active runs — this is the intended failure mode, not a bug | **This is where rollback stops being trivial.** Once even one Sync Run has been created, `drop schema labos cascade` destroys the entire audit trail this table exists to provide — the one thing Milestone 1 was built to make permanent |
| **0027** | Leasing/exposure/traffic entities | `leasing_event_type`, `new_rental_exclusion_reason`, `exposure_status` enums; `leasing_transactions`, `exposure_records`, `traffic_leads` tables | `0025`, `0026` | None | Malformed adapter output violating a `not null` or the `(sync_run_id, sheet_line_ref)` / `(sync_run_id, unit_id)` unique constraints fails the load cleanly (caught by the orchestrator's rollback path, Section 5) | **Destructive once populated** — same as `0026`, this holds the actual weekly transaction data. Dropping it after real ingestion discards real leasing/exposure/traffic history with no application-level undo |
| **0028** | Operational Memory | `memory_type` enum; `operational_memory` table; `prevent_operational_memory_content_edit()` function + `trg_operational_memory_immutable` trigger | `0025`, `0026` | None | The trigger correctly rejects any `UPDATE` that changes `content` — that's a designed failure mode (immutability), not a bug. An `UPDATE` that only touches `superseded_by` should still succeed (worth confirming explicitly in the Database Verification Checklist, since it's not yet tested against real Postgres) | **The single highest-consequence rollback in this batch.** This table is explicitly designed to hold content that should never be lost — dropping it after real narrative/pricing-rationale/manager-comment entries exist is a permanent, unrecoverable loss of exactly the "organizational memory" this milestone's stated purpose was to preserve |
| **0029** | Derived weekly KPI snapshot | `weekly_kpi_snapshots` table | `0026` | None | Constraint failures here just mean a Sync Run's derive step has a bug (caught by the orchestrator, never silently wrong) | Destructive once populated, but lower stakes than `0026`–`0028` — these rows are fully re-derivable from the entity tables by re-running normalization, unlike raw ingested/authored data |
| **0030** | Row-Level Security | 11 RLS policies, schema/table grants | Every prior migration (touches every `labos.*` table) | None on its own, but **this is the migration that makes the schema actually usable/safe** — if it's skipped or fails partway, tables exist with RLS enabled and no policies, meaning **zero rows are readable by anyone except `service_role`**, which fails safe (blocks reads) rather than failing open (never blocks writes it shouldn't) | Partial application (e.g., script interrupted after some `alter table` calls but before all policies exist) leaves some tables unreadable even to platform admins — detectable immediately (empty results where data should exist) and fixable by re-running the remaining `create policy`/`grant` statements, which are idempotent-safe to reissue | Not independently destructive — re-running `0030` in full is always safe. The risk is *incomplete* application, not rollback |
| **0031** | Ingestion capability preflight | `labos.check_ingestion_capability()` function + its `execute` grant | `0024`–`0030` (checks privileges on tables/schema those migrations created) | None — a single function definition | The function itself has no meaningful failure mode (`has_*_privilege` calls never error on a valid role), but a **missing** `0031` (e.g. applying `0024`–`0030` and stopping) means every Sync Run's preflight gets `rpc_unreachable` and refuses to run — a safe failure (blocks ingestion) rather than an unsafe one (never blocks a mis-authorized caller) | Not independently destructive — this function holds no data. Dropping/recreating it any time is safe; the only consequence of it being absent is that ingestion cannot start at all, which is the intended fail-safe behavior, not a bug |

**Summary judgment:** migrations `0024`, `0025`, and `0029` are low-stakes to roll back at any point (reference/derived data, no unique organizational content). Migrations `0026`, `0027`, and especially `0028` become **high-stakes, effectively irreversible** the moment real Sync Runs start landing — `drop schema labos cascade` after that point is a genuine data-loss event, not routine cleanup, and should require the same level of sign-off as any other production data deletion.

---

## 4. Deployment Runbook

**Do not run any of this against the linked production project without the standard 4-point disclosure (what changes, impact, downtime risk, rollback) and your explicit approval first.** The steps below assume a target you've already approved — ideally a throwaway/local Supabase project for the first pass, per the build plan's Database Verification Checklist.

1. **Pre-deployment backup.** Even though this batch touches no existing table, take a full logical backup of the target project before applying anything new to it (`supabase db dump` or the dashboard's backup feature) — standard practice for any migration, and your safety net if `0030`'s grants are somehow misapplied in a way that affects something unexpected.
2. **Apply migrations.** `supabase link --project-ref <target>` (if not already linked), then `supabase db push`. Confirm `supabase migration list` shows `0024`–`0031` with matching local/remote markers.
3. **Verify schema exposure.** Confirm the target project's PostgREST config actually exposes `labos` (mirror `config.toml`'s `[api].schemas` change to that project's dashboard setting — this is a manual step, not applied by `db push`). Query via `supabase-js`: a `.schema('labos').from('properties').select('id')` call should return `[]`, not a "schema must be one of ..." error. Then call `checkIngestionCapability()` directly against the real service-role client and confirm it reports `authorized: true` with all six checks granted — this is the first real signal that the whole chain (schema exposure, grants, RLS, the preflight function itself) is wired correctly, before touching any real ingestion.
4. **Verify constraints and indexes.** Run the two crafted `insert` pairs from the Database Verification Checklist (duplicate `sync_runs_active_week`, duplicate `(sync_run_id, sheet_line_ref)`) and confirm each second insert fails with the expected constraint-violation error, not a silent success.
5. **Verify RLS.** As a platform-admin session, confirm `select * from labos.sync_runs;` returns rows once any exist. As a non-admin authenticated session and as `anon`, confirm the same query returns zero rows, not an error.
6. **Dry-run ingestion.** Run `npm run labos:sync -- --file "<real workbook path>" --property-name "<name>" --reporting-period-end <YYYY-MM-DD> --workbook-alias <alias>` — all four flags explicit, no defaults — with the CLI still wired to `MockLabosRepository` (the default) one more time against this specific target workbook, purely to reconfirm the expected numbers before touching real infrastructure with them.
7. **Review validation results.** Before wiring the real repository, re-read the dry run's validation output line by line — confirm 0 blocking, and that every warning/info entry is one you recognize and accept (especially any new `V9`/`V12`/`V13` entries that weren't in the last verified run, which would indicate the source workbook's shape has drifted).
8. **Execute the first committed Sync Run.** Only now, wire `scripts/labos/run-sync.ts` to `SupabaseLabosRepository` with a service-role client pointed at the target project (a small, temporary code change — not part of Milestone 1's default script). Run it once, for real, against the actual current week's workbook.
9. **Reconcile row counts.** Compare the run's reported entity counts and KPI snapshot against the same numbers already proven against the mock for a known workbook (or, for a new week, against a manual count of the workbook's own numbered rows). Any mismatch blocks proceeding — investigate before trusting anything downstream of this run.
10. **Confirm Operational Memory immutability.** Attempt the crafted `update ... set content = ...` from the Database Verification Checklist against a real row from this run. Confirm it's rejected by the trigger.
11. **Confirm safe rerun/idempotency.** Run the exact same file through the script again, without `--confirm-overwrite`. Confirm it stops at `blocked` with `V7`, and that `select count(*) from labos.leasing_transactions where sync_run_id = '<first-run-id>';` is unchanged — no duplicate rows anywhere.
12. **Post-deployment monitoring.** For at least the first few real weekly runs: manually check `labos.validation_results` for unexpected blocking errors after each run, and manually reconcile the KPI snapshot against the actual emailed weekly report for that same week (this is the closest thing Milestone 1 has to an independent ground truth, until the Trend-workbook cross-check exists).
13. **Rollback/recovery decision points.** Define these *before* step 8, not after something goes wrong:
    - **Before any Sync Run exists:** rolling back (`drop schema labos cascade`) is low-stakes — do it freely if something's structurally wrong.
    - **After the first real Sync Run:** a rollback is now a data-loss event. The decision to do it requires your explicit approval, made with full knowledge of exactly what week(s) of data would be destroyed — never treat it as a routine "reset and try again" step past this point.
    - **A single bad run:** should be handled by re-running with `--confirm-overwrite` (superseding, not deleting) — this is the designed recovery path and should be exhausted before anything schema-level is considered.

---

## 5. Release Acceptance Matrix

| Criterion | Evidence | Test/Command | Status | Remaining Gap |
|---|---|---|---|---|
| Sync Run reaches `completed` on a clean payload | `syncRun.test.ts` "takes a clean payload all the way to completed"; real-file CLI run | `npx vitest run src/labos/syncRun.test.ts`; `npm run labos:sync -- --file "..."` | ✅ Mocked **and** real-file (mock repo) | Real-*database* execution unproven |
| Official `new_rentals_count` excludes non-numeric-Line rows | `weeklySummaryAdapter.test.ts`, `normalize.test.ts`; real-file run (3 official + 3 excluded) | `npx vitest run src/labos` | ✅ Mocked + real-file | Real-database execution unproven |
| `D303`/`WAITC1`/`WAITB1` classify correctly | `weeklySummaryAdapter.test.ts` dedicated assertions; real-file run confirms identical classification | same | ✅ Mocked + real-file | none — this is the one criterion verified against the *actual* source document's actual ambiguous rows, not just a synthetic fixture |
| Exposure count reflects the confirmed 30-day/unrented rule | `normalize.test.ts` (6 dedicated cases); real-file run (exposure = 8) | same | ✅ Mocked + real-file | Real-database execution unproven |
| No resident/prospect identity field ever populated | `weeklySummaryAdapter.test.ts` payload-serialization check; `rules.ts` V11 self-check | same | ✅ Mocked + real-file (spot-checked in the actual run's output) | Real-database execution unproven — i.e., that a real Postgres `null` column genuinely stays `null` under the real repository's upsert path, not just that the JS object never set it |
| Traffic Detail `Key Notes` stored verbatim, linked to its lead | `syncRun.test.ts` "writes Operational Memory verbatim..." | same | ✅ Mocked | Real-file run also confirmed 71/71 traffic-lead/memory parity; real-database persistence unproven |
| No duplicate load on rerun without confirmation | `syncRun.test.ts` idempotency tests | same | ✅ Mocked | Real unique-constraint enforcement (`sync_runs_active_week`, etc.) unproven against real Postgres — this is the single most important untested real-DB behavior, since the mock's idempotency logic is hand-written to *simulate* what the constraint should do, not driven by the constraint itself |
| Overwrite supersedes without deleting | `syncRun.test.ts` overwrite test | same | ✅ Mocked | Real-database execution unproven |
| Partial-failure rollback leaves nothing half-loaded | `syncRun.test.ts` partial-failure test (custom failing repository subclass) | same | ✅ Mocked | This specifically has **not** been tested against `SupabaseLabosRepository` — the mock's rollback is a set of array filters; the real repository's `deleteAllEntitiesForSyncRun` is untested SQL. Real transactional atomicity across the multiple table writes in `loadEntities` is also unverified — see Section 6 |
| `SupabaseLabosRepository` issues correct table/column/onConflict calls | `repository.supabase.test.ts` (fake Supabase client) | `npx vitest run src/labos/repository.supabase.test.ts` | ✅ Against a fake client only | **Never executed against real Postgres.** This is the crux of the whole "database execution verification pending" status — the fake client proves the code *calls* the right things, not that Postgres *accepts* them |
| Operational Memory content is immutable | Migration `0028`'s trigger definition (code review only) | *(no automated test exists — cannot unit-test a Postgres trigger without a real database)* | ⛔ **Not tested at all**, mocked or real | This is a real gap, not just an unproven-in-prod item: there is currently zero automated coverage of the immutability trigger. Must be verified manually per the runbook (step 10) the first time a real database exists |
| RLS blocks non-admin reads, allows admin reads | Migration `0030`'s policy definitions (code review only) | *(no automated test — requires a real Postgres instance with RLS enforcement)* | ⛔ **Not tested at all** | Same category of gap as immutability — verify manually per the runbook (step 5) |
| Migrations apply cleanly, in order | Manual review against known-good patterns from `0001`/`0023` | *(none — `supabase db push` has not been run against any target)* | ⛔ **Not executed** | The single largest remaining gap overall |
| Property/period identity comes from explicit config, never hardcoded or filename-inferred | `weeklySummaryAdapter.test.ts` cross-property test (same structure, different property, zero adapter code changes); real-file run via explicit `--property-name`/`--reporting-period-end`/`--workbook-alias` flags | `npx vitest run src/labos/adapters/weeklySummaryAdapter.test.ts`; `npm run labos:sync -- ...` | ✅ Mocked + real-file | Real-database execution unproven (same as every other criterion) |
| V1 (property mismatch) is a real check, not tautological | `rules.test.ts` "V1 — flags the wrong property as blocking" + case-insensitivity test; real-file run deliberately passing a wrong property name and confirming it blocks | `npx vitest run src/labos/validation/rules.test.ts` | ✅ Mocked + real-file | none — this is now genuinely verified both ways (correct property passes, wrong property blocks) against the real workbook |
| Authorization preflight blocks before any Sync Run is created | `syncRun.test.ts` "runSync — authorization preflight" (5 tests: authorized, missing-schema, RLS-denial, no-adapter-call, no-partial-run) | `npx vitest run src/labos/syncRun.test.ts` | ✅ Mocked | The mock's `simulatedCapability` is hand-set by the test, not driven by real `has_table_privilege` calls — the real preflight's SQL (migration `0031`) is itself unproven against Postgres (see the row below) |
| `SupabaseLabosRepository.checkIngestionCapability()` calls the right RPC and maps results correctly | `repository.supabase.test.ts` (3 tests: fully authorized, partially denied, RPC unreachable) | `npx vitest run src/labos/repository.supabase.test.ts` | ✅ Against a fake client only | Never executed against a real `check_ingestion_capability()` function — whether the real SQL's `has_table_privilege` calls behave as expected for a real service-role vs. authenticated caller is unverified |
| `SupabaseLabosRepository` cannot be instantiated in a browser context | `repository.supabase.test.ts` "refuses to construct in a browser context" | `npx vitest run src/labos/repository.supabase.test.ts` | ✅ | This is a real, executable runtime guard (not just a code-review observation) — verified by actually simulating a browser `window` global and confirming construction throws |

**Plain summary:** every criterion about *application logic* (parsing, classification, validation, orchestration, idempotency-as-designed) has real evidence, including a real-file run. Every criterion about *what Postgres actually does* — constraint enforcement, RLS, the immutability trigger, transactional behavior — has zero execution evidence. These are independent categories of proof, and Milestone 1 has fully closed the first without having started the second.

---

## 6. Final Technical Review

**Writes bypassing the repository interface:** none found. `grep`-verified — no `.from(`, `supabase.`, or `createClient` call exists anywhere under `src/labos/` outside `repository.supabase.ts` and its own test file. Every write path (`syncRun.ts`, `normalize.ts`, the adapter) goes through the `LabosRepository` interface exclusively.

**Service-role / elevated-access assumptions — closed this pass.** Two independent mechanisms now exist, deliberately not relying on inspecting the key itself (which this class cannot and should not do):
1. **Documented privilege requirements.** Every operation `checkIngestionCapability()` checks — schema usage, `sync_runs` select/insert/update, `leasing_transactions` insert, `operational_memory` insert — is documented in migration `0031`'s header comment and `repository.ts`'s interface doc, with the reasoning for each (sync_runs is the lineage anchor; the two insert checks are representative of the entity/memory tables).
2. **A real, executable preflight.** `checkIngestionCapability()` asks Postgres itself (`has_schema_privilege`/`has_table_privilege` against `current_user`, deliberately not `security definer` so it reflects the actual caller, not the function owner) whether the current session can do what a Sync Run needs — and `runSync` calls this as its literal first step, before creating anything. An unauthorized caller gets a structured `IngestionAuthorizationError` naming exactly which checks failed, never a generic permission-denied, and never a partially-created Sync Run.
3. **A trusted-runtime construction guard.** `SupabaseLabosRepository`'s constructor now throws immediately if evaluated where `window` is defined — a real backstop against the class ever running in a browser bundle, not just a documented convention. Combined with the fact that nothing under `src/screens/` or `src/components/` imports `repository.supabase.ts` (grep-verified, unchanged from the prior review), this closes the "browser cannot instantiate/use it for writes" requirement structurally, not just by convention.

Remaining, lower-priority hardening not built this pass (noted, not a blocker): a real ESLint import-boundary rule forbidding `repository.supabase.ts` imports from `src/screens/**`/`src/components/**` would catch the mistake at lint time instead of at runtime construction — a nice-to-have layered on top of the guard above, not a substitute for it.

**RLS policies that could unintentionally block the application:** the design is read-only for `authenticated` and write-only-via-`service_role` **by intent** — this is now explicitly surfaced to the caller via the preflight (an `authenticated`-only client will see `checkIngestionCapability()` report unauthorized with the specific missing grants, rather than discovering the problem mid-write) instead of only being documented in this review and the architecture doc. Whoever builds the Milestone 2 trigger UI still must route "Sync Now" through a server-side/service-role process — the preflight makes a wrong wiring fail loudly and immediately, but doesn't build that server-side process itself.

**Migration-order assumptions:** verified — every FK reference in `0025`–`0029` points at an object created in an earlier-numbered migration (or `public.profiles`, which predates this batch). No forward references exist. One real future-maintenance risk: `grant all on all tables in schema labos to service_role` (`0030`) only covers tables that existed *at the time that statement ran*. Any Milestone 2 migration that adds a new `labos.*` table must re-issue an equivalent grant for that new table — it will not inherit access automatically.

**Destructive rollback language:** corrected in this pass (see Section 3 and the build plan's Database Verification Checklist, both updated) — `drop schema labos cascade` is now explicitly labeled as safe only pre-ingestion and as a genuine, approval-requiring data-loss event once real Sync Runs exist.

**Hard-coded River Run / workbook-specific assumptions — closed this pass, with one caveat found along the way:**
- `weeklySummaryAdapter.ts` no longer hardcodes a property name. The property name is now genuinely extracted from the workbook's own `SUMMARY!row0` text (e.g. `"RIVER RUN ACTIVITY - For Week Ending:"` → `"RIVER RUN"`) and compared case-insensitively against `config.propertyName` (V1). This makes V1 a real check for the first time — proven by deliberately passing a wrong property name against the real file and confirming it blocks (previously, since the adapter always emitted `"River Run"` regardless of the actual file, V1 could never fail).
- **Caveat found via the real-file proof, not assumed:** the extraction regex initially assumed the header cell ended right after `"ACTIVITY -"`; the real cell actually continues with `"For Week Ending:"`. Fixed to capture everything before the word `"ACTIVITY"` and ignore all trailing boilerplate, regardless of what it says — this was only caught because the change was verified against the real workbook, not just synthetic fixtures.
- The Unit Availability Details group-marker text (`"River Run (riverrun)"`, `"Total for riverrun"`) is now built from `config.propertyName` + `config.workbookPropertyAlias`, compared case-insensitively — no hardcoded property/alias text remains anywhere in the adapter.
- `scripts/labos/run-sync.ts` and `src/screens/labos/SyncReviewDemo.tsx` both now require/construct an explicit `IngestionConfig` — no default property name exists anywhere in the codebase; the CLI fails clearly if `--property-name`/`--reporting-period-end`/`--workbook-alias` are omitted.
- **Remaining assumptions — genuinely format-specific, not property-specific**, and explicitly not generalized further than that: the `" ACTIVITY"` header convention; the repeated `"<Property> (<alias>)"` / `"Total for <alias>"` group-marker structure; the `Notice`/`Applicant`/`Future`/`Hold`/`"(Skip)"` status vocabulary in Unit Availability Details; the column layout/order within each `SUMMARY` section; the `/^\d+\s*bdr/i` bed-count pattern in Inventory; and the `WAIT`-prefix convention for waitlist unit codes. All of these are Yardi/this-report-template's own conventions — consistent, as far as the evidence goes, with a single shared "Weekly Activity" report template used across a portfolio, not something unique to River Run. None of them have been verified against a second property's actual workbook, though — that remains a real, if lower-priority, unknown for whenever a second property is actually ingested.

**Source workbook fields retained that could contain resident or prospect PII:**
- `resident_ref` / `prospect_ref`: never populated (always `null`), verified structurally (not in the canonical TypeScript types at all) and by a runtime self-check (`V11`).
- `has_reason` (Notice/Move-Out/Cancel): boolean only — the actual Reason free text (which the earlier PRD phase found contains real sensitive resident circumstances) is read by the adapter but never persisted. Still-deferred governance question, unchanged this milestone.
- `operational_memory.content` (Traffic Detail's Key Notes): **stored verbatim, per your explicit approval.** This is CRM-automation text in the real data seen so far ("Auto-linked Call.", "Winter Lease Waitlist...") rather than personal narrative, but it is still freeform text a leasing agent could, in principle, type a prospect's name into. This is an accepted, approved risk, not an oversight — flagged here so it's a documented decision, not a silent gap, per your own instruction not to leave PII questions unstated.

---

## 7. Commit Readiness

**Nothing has been committed or deployed.** Proposed structure, in logical, independently-reviewable units:

**Commit 1 — Schema foundation**
```
supabase/migrations/0024_labos_schema.sql
supabase/migrations/0025_labos_properties.sql
supabase/migrations/0026_labos_sync_runs.sql
supabase/migrations/0027_labos_leasing_entities.sql
supabase/migrations/0028_labos_operational_memory.sql
supabase/migrations/0029_labos_weekly_kpi.sql
supabase/migrations/0030_labos_rls.sql
supabase/config.toml
```
> feat(labos): add ingestion data foundation — schema, entities, Operational Memory, RLS
>
> Seven additive migrations for a new `labos` schema (properties/units/
> floorplans, Sync Run audit skeleton, leasing/exposure/traffic entities,
> immutable Operational Memory, derived weekly KPI snapshot, RLS reusing
> the existing is_platform_admin() identity). Nothing outside `labos` is
> touched. Not yet applied to any database — see
> docs/RIVER-RUN-MILESTONE-1-RELEASE-HANDOFF.md before deploying.

**Commit 2 — Canonical types and test tooling**
```
src/labos/types.ts
src/labos/testHelpers.ts
package.json
package-lock.json
```
> chore(labos): add canonical payload types and this repo's first test runner
>
> CanonicalPayload/SourceAdapter shapes mirroring the new migrations 1:1.
> Introduces vitest (this repo had no test runner before) plus tsx and
> @types/node for the CLI entrypoint added in a later commit.

**Commit 3 — Weekly-Summary Adapter**
```
src/labos/adapters/sectionScanner.ts
src/labos/adapters/sectionScanner.test.ts
src/labos/adapters/weeklySummaryAdapter.ts
src/labos/adapters/weeklySummaryAdapter.test.ts
```
> feat(labos): add the Weekly-Summary Adapter
>
> Parses SUMMARY/Unit Availability Details/Traffic Detail/Inventory into
> the canonical payload shape. Includes the confirmed New-Rentals Line-
> column classification (official vs. cancelled_or_denied vs.
> waitlist_placeholder) and Operational Memory capture from Key Notes.
> Verified against a real workbook, not just synthetic fixtures.

**Commit 4 — Validation and normalization**
```
src/labos/validation/rules.ts
src/labos/validation/rules.test.ts
src/labos/normalize.ts
src/labos/normalize.test.ts
```
> feat(labos): add the Validation Matrix (V1-V13) and normalization
>
> Payload-level checks (property/week/required-fields/inventory
> cross-reference/PII self-check) plus the pure payload -> DB-row
> transformation, including confirmed exposure-window and KPI-exclusion
> logic.

**Commit 5 — Repository layer (mock + real)**
```
src/labos/repository.ts
src/labos/repository.mock.ts
src/labos/repository.supabase.ts
src/labos/repository.supabase.test.ts
```
> feat(labos): add the LabosRepository interface, mock, and Supabase implementation
>
> The database boundary. SupabaseLabosRepository is type-checked and
> tested against a fake Supabase client but has NOT been executed against
> a real database — see the Database Verification Checklist before
> wiring it to any real project.

**Commit 6 — Sync Run orchestrator**
```
src/labos/syncRun.ts
src/labos/syncRun.test.ts
```
> feat(labos): add the Sync Run state machine
>
> Orchestrates discover -> parse -> validate -> normalize -> load with
> full idempotency (active-week uniqueness + explicit overwrite
> confirmation), partial-failure rollback, and audit-trail writes at
> every transition.

**Commit 7 — CLI entrypoint and review screen**
```
src/labos/sourceFileProviders/localFileProvider.ts
scripts/labos/run-sync.ts
src/labos/api.ts
src/screens/labos/SyncReview.tsx
src/screens/labos/SyncReviewDemo.tsx
src/styles/labos-sync-review.css
src/app/router.tsx
```
> feat(labos): add the developer CLI and minimal Sync Review screen
>
> `npm run labos:sync` proves the full pipeline against a real workbook.
> /labos/sync-review (unlinked from navigation) is a read-only diagnostic
> surface — official KPIs, the excluded-rows reconciliation, validation
> results, and audit history. Not the Property Dashboard.

**Commit 8 — Documentation**
```
docs/RIVER-RUN-DASHBOARD-PRD.md
docs/RIVER-RUN-INGESTION-ARCHITECTURE.md
docs/RIVER-RUN-MILESTONE-1-BUILD-PLAN.md
docs/RIVER-RUN-MILESTONE-1-RELEASE-HANDOFF.md
```
> docs(labos): add Milestone 1 PRD, architecture, build plan, and release handoff

**Commit 9 — Close release blockers 4 and 5: explicit property configuration + authorization preflight**
```
src/labos/config.ts
src/labos/types.ts
src/labos/testHelpers.ts
src/labos/adapters/weeklySummaryAdapter.ts
src/labos/adapters/weeklySummaryAdapter.test.ts
src/labos/validation/rules.ts
src/labos/validation/rules.test.ts
src/labos/normalize.ts
src/labos/syncRun.ts
src/labos/syncRun.test.ts
src/labos/repository.ts
src/labos/repository.mock.ts
src/labos/repository.supabase.ts
src/labos/repository.supabase.test.ts
scripts/labos/run-sync.ts
src/screens/labos/SyncReviewDemo.tsx
supabase/migrations/0031_labos_capability_check.sql
docs/RIVER-RUN-MILESTONE-1-BUILD-PLAN.md
docs/RIVER-RUN-MILESTONE-1-RELEASE-HANDOFF.md
```
> feat(labos): require explicit property/period config; add authorization preflight
>
> Removes every hardcoded "River Run" assumption from the adapter and
> orchestrator — property/period identity now comes from a required
> IngestionConfig (propertyId, propertyName, reportingPeriodEnd,
> workbookPropertyAlias), with the property name genuinely extracted from
> the workbook's own content rather than assumed, making V1 a real check
> for the first time. Proven against the real workbook under a different
> property name in a dedicated test, with zero adapter code changes.
>
> Adds labos.check_ingestion_capability() (migration 0031) and wires it as
> the first step of every Sync Run — verifies real database privileges via
> Postgres's own has_schema_privilege/has_table_privilege against the
> actual calling role, never by inspecting which key was used. A denied
> preflight throws a structured IngestionAuthorizationError before any
> Sync Run row is created. SupabaseLabosRepository's constructor now also
> refuses to run in a browser context.
>
> Still not applied to any database — this closes two release blockers
> found in the prior handoff, not the "database execution verification
> pending" status, which remains open.

---

## Remaining Release Blockers

Two blockers from the prior handoff are closed (see the "Since the last handoff" note in Section 1, and Section 6). What remains — all in the same category, "nothing has executed against a real database yet":

1. **No migration has ever been executed against real Postgres**, including the new `0031`. This is the primary blocker — everything else in this document exists to make that step safe and verifiable when you're ready, not to route around it.
2. **RLS and the Operational Memory immutability trigger have zero test coverage of any kind** (mocked or real) — they cannot be unit-tested without a real database, and haven't been manually verified either.
3. **`SupabaseLabosRepository` has never run a real query** — the fake-client tests prove intent, not Postgres compatibility (upsert `onConflict` syntax, type coercion, RLS interaction with the service role are all unverified). This now also applies to `checkIngestionCapability()` itself — whether `has_table_privilege` genuinely reports what's expected for a real service-role vs. authenticated caller is unverified.
4. **Production config exposure of the `labos` schema has not been mirrored to the actual linked project's dashboard** — required before the real repository can reach it, and is itself a disclosure-and-approval production change.

Closed, not remaining:
- ~~`propertyName: "River Run"` hardcoded in the adapter~~ — closed; see Sections 1, 5, 6.
- ~~`SupabaseLabosRepository` doesn't enforce authorization~~ — closed via the capability preflight + browser-context guard; see Sections 1, 5, 6.

No Milestone 2 work (Trend workbook, Portfolio Survey, narrative generation) has been started, per your instruction.

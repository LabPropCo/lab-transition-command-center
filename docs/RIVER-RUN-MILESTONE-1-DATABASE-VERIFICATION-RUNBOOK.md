# River Run Milestone 1 — Database Verification Runbook

**Status: prepared, not executed.** Nothing in this document has been run. No project has been linked, no dashboard setting changed, no credential used. This is the exact sequence to follow once every item below is satisfied.

**Scope discipline:** this phase proves the existing migrations (`0024`–`0031`) and `SupabaseLabosRepository` against a real Postgres/Supabase instance. No new code, schema, or feature work happens here — if execution surfaces a real defect, the fix is scoped and proposed separately, not folded into this runbook.

## Execution Gate — current status

Execution does not begin until every row below reads Provided. As of this revision:

| Gate item | Status |
|---|---|
| Disposable test project ref and URL | ⏳ Not yet provided |
| Confirmation that credentials have been configured locally (not shared through chat) | ⏳ Not yet provided |
| Confirmation that the full `0001`–`0031` migration history is approved | ✅ **Provided** — confirmed: the test environment mirrors Transition Center dependencies rather than isolating LabOS |
| Explicit authorization to run the database verification sequence | ⏳ Not yet provided |

No command in this document runs until all four read Provided.

## Credential Handling Rules (binding for this entire runbook)

- **Never provided through chat.** The service-role key and database password are configured directly in the trusted local execution environment — I will not ask for them in the conversation, and if they appear in a message anyway, I will not echo them back or use them from the chat text itself.
- **Never printed, logged, committed, screenshotted, or written into documentation or command output.** Every command below that touches a credential reads it from an environment variable already present in the shell — no command includes a literal key value, and no output-capture step in this runbook retains one. Where a command's output could theoretically include a credential (it shouldn't, for anything here), that output is treated as sensitive and excluded from any evidence log.
- **The anon key is scoped to unauthorized-access testing only** (Section 4.8's non-admin/anon RLS-denial checks) — it is never used to construct a `SupabaseLabosRepository` or to perform any ingestion write. Only the service-role key does that, and only from the trusted local script described in Section 5.
- **`.gitignore` verified before any credential is configured** (read-only check, already performed): this repo's `.gitignore` already covers `.env`, `.env.local`, and `.env.*.local`. Recommendation: store the service-role key in a file matching one of those exact patterns (e.g. `.env.server.local`), or as a plain shell `export` with no file at all — never a new filename outside those patterns. One related, non-credential note from the same check: `pre_migration_schema_snapshot.sql` and `migration_output.log` are artifacts this runbook generates — `*.log` is already git-ignored, but the `.sql` snapshot is not; keep it outside the repo directory (or add it to `.gitignore` before creating it) even though it contains no secrets, since it's a disposable verification artifact, not a repo file.

---

## 1. Target Environment

**A clean, disposable Supabase test project — not the currently linked one.**

Confirmed by inspecting this repo's local CLI state (read-only, no changes made): it is currently linked to project ref **`grmgrsxmlzsswdmxtfsx`** (the production project backing thelabpropco.com). This value is the "known bad" reference for Section 1's verification gate below — if the linked ref ever matches this, stop immediately.

**Important prerequisite, stated plainly so it isn't discovered mid-run:** `labos`'s own migrations depend on the *existing* Transition Center schema — `sync_runs.triggered_by` references `public.profiles(id)`, and every RLS policy calls `public.is_platform_admin()`, both defined in migration `0001`. A "clean" test project therefore means clean **and then given the full `0001`–`0031` migration history**, not `labos` in isolation against an otherwise-empty database. Running only `0024`–`0031` against a database with no `public.profiles` table will fail at `0026`. This is addressed explicitly in Section 3.

---

## 2. Preflight Package

### Project Identity Confirmation Checklist — complete before any linking command

This must be filled in and explicitly confirmed before Section 2's linking steps run, not assumed from context:

| Item | Value |
|---|---|
| Test project name | *(you provide)* |
| Test project ref | *(you provide)* |
| Test project URL | *(you provide)* |
| Current Supabase CLI linked ref (`cat supabase/.temp/project-ref`) | *(checked at the time, immediately before linking)* |
| Confirmation the linked ref is **not** `grmgrsxmlzsswdmxtfsx` | *(explicit yes/no — not inferred)* |

**If the CLI reports `grmgrsxmlzsswdmxtfsx` at any point in this process — before linking, after linking, or before any migration command — stop immediately.** Do not proceed, do not attempt to "fix" the link inline; re-run the link command explicitly with the correct test ref and re-check before continuing.

### Required environment variables

| Variable | Value source | Where it may live |
|---|---|---|
| `SUPABASE_URL` | Test project's API URL (Project Settings → API) | Anywhere — not sensitive |
| `SUPABASE_ANON_KEY` | Test project's anon/public key | Anywhere client-reachable is fine (it's designed to be public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Test project's service-role key | **Server-side only** — see the rule below |
| `SUPABASE_ACCESS_TOKEN` | A personal Supabase CLI access token (for non-interactive `supabase login`), if not already logged in | Local shell environment only, never committed |
| `SUPABASE_TEST_PROJECT_REF` | The test project's ref (from its dashboard URL) | Anywhere — used only to double-check linking, not a secret |

### Credentials that must never be browser-accessible

**`SUPABASE_SERVICE_ROLE_KEY` must never be assigned to a `VITE_`-prefixed variable, never placed in any `.env` file Vite reads for the client build, and never referenced from anything under `src/`.** This repo's existing convention already separates these correctly — `src/lib/supabase.ts` reads only `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` for the browser client. The service-role key is used **exclusively** by a local/CLI-only script for this verification (see Section 5) and must be exported directly in the shell running that script (e.g. `export SUPABASE_SERVICE_ROLE_KEY=...` in the terminal session, or a `.env.server`-style file that is `.gitignore`d and never imported by any Vite-bundled code path). If this key is ever needed by the running application (not just this verification), the correct home for it is a server-side Edge Function's environment, exactly like the existing `invite-user` function's own service-role usage — never the browser bundle.

### Supabase CLI linking steps

```bash
# 1. Confirm CLI version (already verified present, v2.110.0)
npx supabase --version

# 2. Log in, if not already (opens a browser for auth, or use SUPABASE_ACCESS_TOKEN non-interactively)
npx supabase login

# 3. Link THIS repo to the TEST project (never the production ref above)
npx supabase link --project-ref <SUPABASE_TEST_PROJECT_REF>
```

**Before this link step, actually run:** `cat supabase/.temp/project-ref` — if it already shows `grmgrsxmlzsswdmxtfsx`, that's the current (production) link; linking to the test project ref will overwrite this file. **This means the production link is temporarily replaced in the local CLI state for the duration of this verification** — not destructive to the production project itself (linking only changes which project `supabase db push`/`migration list` target from this machine), but worth being deliberate about: confirm you're ready to treat this repo folder as "pointed at test" for the whole session, and re-link back to production explicitly afterward if you need to resume any production-adjacent work in this same folder.

### Verify the CLI is linked to the intended test project — do this before every migration command, not just once

```bash
cat supabase/.temp/project-ref
```
**Expected result:** exactly `<SUPABASE_TEST_PROJECT_REF>`, and explicitly **not** `grmgrsxmlzsswdmxtfsx`. Treat any other value as a hard stop.

```bash
npx supabase projects list
```
**Expected result:** the test project ref appears in the list, and you independently recognize it as the disposable test project you created (by name), not by ref alone — ref-only confirmation is not sufficient given how easy transposition errors are.

### Dashboard configuration required to expose the `labos` schema

This is a manual dashboard step — `supabase db push` does **not** touch API exposure settings.

1. Test project dashboard → **Project Settings → API**.
2. Find **"Exposed schemas"** (sometimes labeled "Schema" under the Data API section).
3. Add `labos` to the list, alongside the existing `public` and `graphql_public` (mirrors this repo's local `supabase/config.toml`'s `[api].schemas` setting, which only governs `supabase start` locally — the hosted dashboard has its own, separate copy of this setting that must be changed by hand).
4. Save, and allow a short propagation delay (PostgREST reloads its schema cache on a short interval or on an explicit `NOTIFY pgrst, 'reload schema'`).

**Verification that this step actually worked** (Section 4 has the full check) — a quick sanity version:
```bash
curl -s "$SUPABASE_URL/rest/v1/properties?select=id" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Accept-Profile: labos"
```
**Expected result:** `[]` (empty array, schema reachable, table exists but has no rows yet) — not `{"message":"..."}`-shaped errors mentioning schema exposure.

---

## 3. Migration Execution Plan

**Run this entire section only after Section 2's linking verification passes.**

### 3.1 Confirm the target database is empty or appropriately isolated

```sql
-- Should return zero rows on a genuinely fresh project
select schema_name from information_schema.schemata where schema_name = 'labos';

-- Sanity check on what schemas DO exist (expect only Supabase's own defaults:
-- public, auth, storage, extensions, graphql, graphql_public, pgbouncer,
-- realtime, vault — and public should be empty on a brand-new project)
select schema_name from information_schema.schemata order by schema_name;

select count(*) from public.profiles; -- expect: relation does not exist (public is empty/fresh)
```
**Expected result:** `labos` schema absent; `public.profiles` does not exist yet (this project has never had the Transition Center migrations applied).

### 3.2 Capture a pre-migration schema snapshot

```bash
npx supabase db dump --schema-only -f pre_migration_schema_snapshot.sql
```
Retain this file as the "before" baseline — it should be nearly empty (Supabase's own default schemas only) since this is a fresh project.

### 3.3 Apply the full migration history, in order — `0001` through `0031`

Per Section 1's prerequisite: `labos` depends on `public.profiles`/`public.is_platform_admin()`, both from `0001`. This is one continuous push, not two separate ones — `supabase db push` applies every migration file in the `supabase/migrations/` folder that the target hasn't seen yet, in filename order, in one run.

**Explicitly ruled out: manually recreating only the objects LabOS depends on** (e.g. hand-writing a stub `profiles` table with just an `id`/`is_platform_admin` column, or a simplified `is_platform_admin()` function, to save time). That would verify against a schema and RLS environment that doesn't match the real application — defeating the purpose of this whole exercise. The full `0001`–`0031` history, applied through the same `db push` mechanism production would eventually receive, is the only approved path.

```bash
npx supabase db push 2>&1 | tee migration_output.log
```

**Stop immediately on the first failure.** `supabase db push` already halts at the first migration that errors — do not add `--include-all` or any flag that suppresses this. If `migration_output.log` shows an error:
1. **Do not retry blindly.** Read the error against the specific migration file it names.
2. **Do not attempt a partial manual fix via the dashboard SQL editor** — any correction belongs in a new migration file, applied through the same `db push` path, once you understand the root cause.
3. Proceed to Section 7's "Migration failure before any data exists" recovery path.

### 3.4 Confirm migration ordering

```bash
npx supabase migration list
```
**Expected result:** every migration from `0001` through `0031` shows matching `local`/`remote` version markers, in ascending numeric order, with no gaps.

### 3.5 Confirm all expected objects exist

See Section 4 for the executable checks — run all of them now, as the closing step of this migration phase, before moving to Section 5.

### 3.6 Create test users via the application's actual authorization model

**Not a manual `insert into profiles`, and not a temporary RLS/permission bypass.** Both would test against a scenario that doesn't reflect reality. Instead, use the same mechanism this application actually uses to create accounts — the Supabase Auth Admin API (`admin.createUser`), which fires the real `handle_new_user()` trigger from migration `0001` and creates a real `profiles` row exactly as it would in production. This is the identical mechanism this repo's own `scripts/seed-admin.mjs` and the `invite-user` Edge Function both already use — not a new, weaker path invented for this verification.

Using a temporary local script (service-role client, never committed, same class as Section 5's script):
```ts
// Standard user — created via the real Admin API + trigger, left at defaults (is_platform_admin = false).
const { data: standard } = await client.auth.admin.createUser({
  email: "<a real address you control>", email_confirm: true,
});

// Platform admin — same real path, then is_platform_admin flipped via the
// service-role client, which is the ONE legitimate path migration 0023's
// column-restricted grant + trigger allow (authenticated clients cannot do
// this to themselves — confirmed in the earlier Admin Module work). Not a
// bypass: this is the designed mechanism for this exact operation.
const { data: admin } = await client.auth.admin.createUser({
  email: "<a different real address you control>", email_confirm: true,
});
await client.from("profiles").update({ is_platform_admin: true }).eq("id", admin.user.id);
```
**What this deliberately does NOT do:** disable RLS on any table, grant `authenticated` broader privileges than migration `0030` already defines, or write directly to `profiles` for the standard user (the trigger does that). Section 4.8's RLS checks are only meaningful if these two accounts came from the real path — otherwise a false pass is possible.

---

## 4. Database Verification — Executable Checks

Run these via `psql` (connection string from the test project's dashboard → Settings → Database) or the SQL Editor in the dashboard. Where a check requires simulating an authenticated request (not just `psql` as the Postgres superuser), that's called out explicitly.

### 4.1 `labos` schema creation
```sql
select schema_name from information_schema.schemata where schema_name = 'labos';
```
Expected: one row, `labos`.

### 4.2 PostgREST/API schema exposure
Already covered in Section 2's dashboard step — re-confirm with the same `curl` command after migrations are applied (now expecting an actual, if empty, `properties` table to respond).

### 4.3 Table and column definitions
```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'labos'
order by table_name, ordinal_position;
```
Expected: 11 tables (`properties`, `floorplans`, `units`, `sync_runs`, `source_files`, `validation_results`, `leasing_transactions`, `exposure_records`, `traffic_leads`, `operational_memory`, `weekly_kpi_snapshots`), columns matching migrations `0025`–`0029` exactly (field names/nullability as defined there — e.g. `leasing_transactions` includes `line_label`, `is_official_kpi`, `exclusion_reason` from the later blocker-closure work).

### 4.4 Foreign keys and unique constraints
```sql
select tc.table_name, tc.constraint_name, tc.constraint_type,
       string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
where tc.table_schema = 'labos' and tc.constraint_type in ('FOREIGN KEY', 'UNIQUE', 'PRIMARY KEY')
group by tc.table_name, tc.constraint_name, tc.constraint_type
order by tc.table_name, tc.constraint_type;
```
Expected, at minimum (Postgres's default auto-naming, `{table}_{columns}_key`):
- `properties_name_key` (unique: `name`)
- `floorplans_property_id_type_code_key` (unique: `property_id, type_code`)
- `units_property_id_unit_number_key` (unique: `property_id, unit_number`)
- `leasing_transactions_sync_run_id_sheet_line_ref_key` (unique: `sync_run_id, sheet_line_ref`)
- `exposure_records_sync_run_id_unit_id_key` (unique: `sync_run_id, unit_id`)
- `traffic_leads_sync_run_id_sheet_line_ref_key` (unique: `sync_run_id, sheet_line_ref`)
- `weekly_kpi_snapshots_sync_run_id_key` (unique: `sync_run_id`)
- FKs from every entity table to `sync_runs`/`properties`/`units` as defined in `0025`–`0029`, plus `sync_runs.triggered_by` → `public.profiles(id)`

### 4.5 Upsert conflict keys — cross-check against `SupabaseLabosRepository`'s actual `onConflict` strings
The three `onConflict` values the real code sends (`sync_run_id,sheet_line_ref` for `leasing_transactions`/`traffic_leads`, `sync_run_id,unit_id` for `exposure_records`, `sync_run_id` for `weekly_kpi_snapshots`) must exactly match a real unique constraint on that exact column set — confirmed by Section 4.4's output above. This is the single most important check in this section: a mismatched `onConflict` string doesn't fail loudly, it fails as a confusing runtime error the first time a real upsert runs.

### 4.6 Required indexes
```sql
select indexname, indexdef from pg_indexes where schemaname = 'labos' order by tablename;
```
Expected: `sync_runs_active_week` present, with its definition containing `WHERE ((status = 'completed'::labos.sync_run_status) AND (superseded_by IS NULL))` (or equivalent) — confirming it's the partial index, not a plain unique index.

### 4.7 RLS enabled on every expected table
```sql
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'labos' and c.relkind = 'r'
order by c.relname;
```
Expected: `relrowsecurity = true` for all 11 tables.

### 4.8 Platform-admin access / unauthorized-user denial
Requires two real test accounts in this project — one platform admin (`profiles.is_platform_admin = true`), one standard user. Simulate their RLS context directly in `psql` (the precise way to test RLS without a live HTTP round trip):
```sql
-- As the platform admin
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"<admin-user-uuid>"}';
select count(*) from labos.sync_runs; -- expect: succeeds, returns a real count (0 or more)
reset role;

-- As the standard (non-admin) user
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"<standard-user-uuid>"}';
select count(*) from labos.sync_runs; -- expect: succeeds, returns 0 rows (RLS-filtered, not an error)
reset role;

-- As anon
set local role anon;
select count(*) from labos.sync_runs; -- expect: 0 rows
reset role;
```

### 4.9 Trusted ingestion access (`service_role`)
```sql
select rolname, rolbypassrls from pg_roles where rolname = 'service_role';
```
Expected: `rolbypassrls = true` — this is standard Supabase platform configuration, not something this migration set creates; worth confirming explicitly on this specific project rather than assumed.
```sql
set local role service_role;
insert into labos.properties (name) values ('Verification Probe') returning id; -- expect: succeeds
delete from labos.properties where name = 'Verification Probe'; -- clean up immediately
reset role;
```

### 4.10 `checkIngestionCapability()` — success and structured failure
```sql
set local role service_role;
select * from labos.check_ingestion_capability(); -- expect: every check_name row, granted = true
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"<standard-user-uuid>"}';
select * from labos.check_ingestion_capability(); -- expect: every row granted = false (no insert/update grants for authenticated)
reset role;
```

### 4.11 Operational Memory immutability
```sql
set local role service_role;
insert into labos.sync_runs (property_id, reporting_week, status, triggered_by)
  values ((select id from labos.properties limit 1), '2099-01-01', 'completed', (select id from public.profiles limit 1))
  returning id; -- note the id as <probe-run-id>

insert into labos.operational_memory (sync_run_id, property_id, reporting_week, memory_type, content)
  values ('<probe-run-id>', (select id from labos.properties limit 1), '2099-01-01', 'traffic_note', 'original text')
  returning id; -- note the id as <probe-memory-id>

update labos.operational_memory set content = 'edited text' where id = '<probe-memory-id>';
-- Expected: ERROR — "labos.operational_memory.content is immutable; insert a new row and set superseded_by instead"

update labos.operational_memory set superseded_by = null where id = '<probe-memory-id>';
-- Expected: succeeds (only `content` is protected)

-- Clean up the probe rows
delete from labos.operational_memory where id = '<probe-memory-id>';
delete from labos.sync_runs where id = '<probe-run-id>';
reset role;
```

### 4.12 Transaction rollback behavior — read this carefully before testing
**`loadEntities` is not wrapped in a single native Postgres transaction — it issues several separate PostgREST calls (one upsert per entity table).** "Rollback" in this system is the **application's own compensating cleanup** (`deleteAllEntitiesForSyncRun`, called from `syncRun.ts`'s `catch` block), not a database-level `ROLLBACK`. This section's SQL checks confirm the *result* of that compensating cleanup (zero rows for a failed run's `sync_run_id`) — Section 5.10 is where this gets exercised end-to-end via the real repository, which is the only way to actually prove it.

### 4.13 Failure before Sync Run creation when preflight fails
Covered in Section 5.1 (requires the real repository, not raw SQL) — the assertion here is simply: after a deliberately-denied preflight attempt, `select count(*) from labos.sync_runs;` is unchanged from before the attempt.

---

## 5. Real Repository Proof

This requires a small, **temporary** script — not a new permanent file in this repo (per "no additional architecture changes"). Save the snippet below to a scratch location (e.g. outside the repo, or in a file you delete afterward) and run it with `tsx`, using the SAME `weeklySummaryAdapter`/`runSync`/`SupabaseLabosRepository` already built:

```ts
// TEMPORARY verification script — not committed to the repo.
import { createClient } from "@supabase/supabase-js";
import { loadLocalFile } from "<path-to-repo>/src/labos/sourceFileProviders/localFileProvider";
import { weeklySummaryAdapter } from "<path-to-repo>/src/labos/adapters/weeklySummaryAdapter";
import { SupabaseLabosRepository } from "<path-to-repo>/src/labos/repository.supabase";
import { runSync } from "<path-to-repo>/src/labos/syncRun";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const repo = new SupabaseLabosRepository(client);

async function main() {
  // 5.1 — capability preflight, standalone
  const capability = await repo.checkIngestionCapability();
  console.log("Preflight:", capability);
  if (!capability.authorized) throw new Error("Preflight failed — stop here, do not proceed.");

  const propertyId = await repo.getOrCreateProperty("River Run");
  const file = await loadLocalFile("<path to the real 2026.07.26 workbook>");
  const config = {
    propertyId, propertyName: "River Run",
    reportingPeriodEnd: "2026-07-26", workbookPropertyAlias: "riverrun",
  };

  // 5.3 — first committed Sync Run (there is no separate "dry-run" mode against
  // the real repository — 5.2's dry run is the existing MockLabosRepository
  // path, run one more time immediately before this, exactly as already
  // proven; this call is the first one that actually writes)
  const result = await runSync(repo, { adapter: weeklySummaryAdapter, file, config, triggeredBy: "db-verification" });
  console.log(result.summary);

  // 5.7 — safe rerun proof, same process
  const rerun = await runSync(repo, { adapter: weeklySummaryAdapter, file, config, triggeredBy: "db-verification-rerun" });
  console.log("Rerun status (expect BLOCKED, V7):", rerun.syncRun.status);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
```

| Step | Action | Command | Expected |
|---|---|---|---|
| 5.1 | Capability preflight | (script, above) | `authorized: true`, all checks granted |
| 5.2 | Dry-run ingestion | `npm run labos:sync -- --file "<path>" --property-name "River Run" --reporting-period-end 2026-07-26 --workbook-alias riverrun` (existing CLI, `MockLabosRepository`, no DB touched) | Same numbers already proven: 3 official + 3 excluded new rentals, 5 move-ins, 0 move-outs, 1 cancel/denial, 15 exposure records, exposure 8, 71 traffic leads/memory entries |
| 5.3 | Review validation/reconciliation | Read the dry run's console output line by line | 0 blocking; every warning/info recognized from prior runs, nothing new |
| 5.4 | First committed Sync Run | Run the script above | `result.syncRun.status === "completed"`; same numbers as 5.2 |
| 5.5 | Direct SQL row-count reconciliation | `select count(*) from labos.leasing_transactions where sync_run_id = '<id>';` (repeat per table) | Matches `result.entityCounts` exactly |
| 5.6 | Verify Sync Run status + audit history | `select id, status, triggered_by, triggered_at, superseded_by from labos.sync_runs where property_id = '<id>' order by triggered_at;` | One row, `status = 'completed'`, `superseded_by is null` |
| 5.7 | Safe rerun | Same script's second `runSync` call | `status === "blocked"`, validation includes `V7_DUPLICATE_REPORTING_WEEK` |
| 5.8 | No duplicate rows | Re-run 5.5's counts | Identical to 5.5 — unchanged |
| 5.9 | No duplicate Operational Memory | `select count(*) from labos.operational_memory where sync_run_id = '<id>';` before/after 5.7 | Unchanged |
| 5.10 | Controlled partial-failure + recovery | `revoke insert on labos.operational_memory from service_role;` then attempt a **new** sync run (different `reportingPeriodEnd`, e.g. a second real or synthetic week) | Run ends `status = 'failed'`; `select count(*) from labos.leasing_transactions where sync_run_id = '<new-failed-run-id>';` returns `0` (compensating rollback worked); then `grant insert on labos.operational_memory to service_role;` and confirm a fresh attempt for that same week succeeds cleanly |

---

## 6. Acceptance Evidence

For every check above, retain:
- **Command/SQL executed** — copy-pasted, not paraphrased, into a verification log file.
- **Raw output** — full `psql`/script stdout, not a summary.
- **Expected result** — quoted from this document, so a reviewer can compare intent to actual without re-deriving it.
- **Pass/fail** — explicit, per check, not inferred from "nothing looked wrong."
- **Cleanup impact** — every probe row inserted for a check (Sections 4.9, 4.10, 4.11) is deleted immediately after that check, in the same session; Section 5's real ingestion data is **not** cleanup-deleted (it's the actual proof artifact) — it lives in the disposable test project until that project itself is torn down, not deleted row-by-row.

Suggested log structure (one row per check, matching Sections 3–5's numbering): `check_id | command_or_sql | expected | actual | pass_fail | evidence_file_ref`.

---

## 7. Recovery

**Dropping the schema is not the default recovery once any committed data exists.** It appears below only in the one scenario where it's actually appropriate.

**a. Migration failure before any data exists (Section 3.3 fails):**
No data is at risk — nothing was created before the failure, or only schema-level objects with zero rows exist. Read the failing migration's error against its file. If the fix is a genuine migration bug, correct it in a new migration file (never edit `0024`–`0031` in place once they've been run against any target, including this test one — treat "applied here" the same as "applied in production" for discipline purposes) and re-run `db push`. `drop schema labos cascade` is acceptable here specifically because there is no data to lose — but prefer understanding the root cause first regardless.

**b. Migration success, no committed Sync Runs (Section 3 passes, Section 4 checks pass, Section 5 hasn't started yet):**
Schema exists, fully verified, zero real data. If Section 4's checks reveal a structural issue (wrong constraint, missing grant), fix forward with a new migration and re-verify — dropping and recreating is low-stakes here but usually unnecessary; a targeted fix is faster and proves the fix works incrementally.

**c. Failure during the first committed Sync Run (Section 5.4 or 5.10's controlled failure):**
This is a real partial-failure scenario, and the system is designed for exactly this. The orchestrator's compensating rollback should have already removed any partial entity rows for that `sync_run_id` (verify per Section 5.5's counts = 0). **Do not delete the `sync_runs` row itself** — it stays, marked `failed`, as the permanent audit record that this attempt happened and didn't silently succeed. Investigate the root cause (application bug vs. real database constraint behaving differently than the mock assumed — the latter is exactly what this whole runbook exists to surface). Once understood and fixed, a fresh Sync Run (new row) can be attempted for the same reporting week — no special recovery step is needed beyond that, since the failed run never became "active" (Section 3's `sync_runs_active_week` index only recognizes `completed` runs).

**d. Successful ingestion followed by a discovered defect (data exists and is real):**
1. **Classify the defect first.** Is it a logic/classification bug (e.g., an exposure-count miscalculation) or actual data corruption (rows silently wrong at the storage layer)? These have different correct responses.
2. **For a logic bug:** the already-committed data is still valid raw material — it reflects exactly what the (buggy) code computed, which has audit value. Fix the bug in application code (a separate change, not part of this runbook), then **re-run the affected reporting week with `--confirm-overwrite`** — this supersedes the old run (marks it `superseded_by`, keeps it queryable) rather than deleting it, preserving full lineage of what was originally computed and what replaced it.
3. **For a schema-level defect** (e.g., a missing column needed to represent something correctly): add a new migration (`0032`+) — never edit `0024`–`0031` in place once applied to this or any real target.
4. **Schema drop is reserved for:** a scenario where the data itself is fundamentally untrustworthy across the board (e.g., a bug silently wrote incorrect values into every row of a table, not just one run) **and** this specific test project's data has no standalone value worth preserving. Even then, this is a deliberate, explicitly-approved decision made with full knowledge of exactly what's being discarded — never a default reflex to "start clean."

---

## 8. Execution Control

**Nothing above has been executed.** No project linked, no dashboard setting changed, no credential used, no SQL run against any real database.

### The four-item execution gate (repeated from the top of this document)

Execution begins only once all four are true:

1. **Disposable test project ref and URL** — provided by you.
2. **Confirmation that credentials have been configured locally** — the service-role key and database password are set directly in your trusted local execution environment; not shared through chat, not requested by me in chat.
3. **Confirmation that the full `0001`–`0031` migration history is approved** — ✅ already provided (this message): the test environment mirrors Transition Center dependencies rather than isolating LabOS.
4. **Your explicit authorization to run the database verification sequence.**

Once all four are satisfied, execution follows this document exactly, stopping on the first unexpected migration or verification result (per Sections 3.3 and 7), and does not touch the production project or attempt to fix a failing migration against it under any circumstance.

### Still needed from you

- Test project ref and URL (gate item 1).
- Confirmation credentials are configured locally (gate item 2) — I will not ask for the key/password values themselves.
- Explicit go-ahead to begin (gate item 4).
- A database connection string, or your confirmation that I should derive one from the project ref, for the `psql`/dashboard-SQL-editor checks in Section 4.
- Two real email addresses you control, for Section 3.6's test-user creation (one becomes the platform admin, one stays standard).

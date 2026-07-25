# Release validation

**Rule: never ship a package that hasn't passed `scripts/release_check.py`, and
the check must run against the ZIP you intend to ship — not the working tree.**
The 0006 incident happened because "it validated on my tree" was treated as
"the artifact is correct." These are now separate facts, and the gate proves the
second one.

## Run it

```bash
pip install pgserver psycopg2-binary          # one-time
python scripts/release_check.py \
  --zip  dist/lab-transition-command-center.zip \
  --tree . \
  --applied-dsn "$SUPABASE_DB_URL"            # or: --applied 0001,0002,...
```

Exit code 0 = safe to ship; non-zero = do not ship. CI should block on it.

## What it checks

| Check | Catches |
|-------|---------|
| **A. Sequence** | A missing/duplicate/misnamed migration (would have caught the absent 0006). |
| **B. Clean rebuild from ZIP** | A package that can't build a database from scratch using only its own contents. |
| **C. Acceptance as `authenticated`** | Behavioural regressions **and missing table GRANTs** — the harness deliberately does *not* apply Supabase default privileges, so a table without an explicit grant fails here (the 0007 class). |
| **D. Idempotency** | A migration that breaks when re-applied (important because manual SQL-editor runs have no "already applied" guard). Applies the whole chain twice on a fresh DB. |
| **E. ZIP ↔ tree parity** | A file present in the tree but missing from the ZIP, or vice versa, or altered in packaging (the exact 0006 failure mode). |
| **F. Applied-vs-repo drift** | A migration recorded in the database's applied history but missing from the repository. |

## Idempotency & how execution is controlled

**Is 0007 safely rerunnable?** Yes. `GRANT` is idempotent — re-running it is a
no-op, never an error. The same is true of `0008`.

**Is the whole chain rerunnable?** Yes, by construction: every migration uses
`create … if not exists`, `create or replace`, `drop … if exists` then create,
guarded `do $$ … $$` blocks, and `on conflict do nothing` for seed inserts.
`0005`'s data backfill is guarded by `if exists (… transition_id is null)`, so a
second run does not create a second transition or duplicate work items. Check D
verifies this automatically on every release.

**How is execution controlled today?** Migrations have been applied **manually**
in the Supabase SQL editor. Manual application does **not** write to
`supabase_migrations.schema_migrations`, so there is **no automatic "already
applied" guard and no drift detection** from the platform — control is entirely
manual. Two consequences:

1. Because the chain is idempotent (and D proves it), a manual re-run is safe.
2. To get real history + drift protection, adopt the **Supabase CLI**
   (`supabase db push`), which records applied versions and refuses to re-run
   them. Once you do, run the gate with `--applied-dsn` so check F compares the
   live applied history against the repo automatically. Until then, keep a simple
   ledger of which versions you've applied and pass it via `--applied`.

## Packaging order (must not vary)

1. `npm run build` (must succeed) → then delete `dist/`, `*.tsbuildinfo`.
2. Zip the tree, excluding `node_modules/`, `dist/`, `*.tsbuildinfo`.
3. Run `scripts/release_check.py --zip <zip> --tree .` and require exit 0.
4. Only then publish the ZIP.

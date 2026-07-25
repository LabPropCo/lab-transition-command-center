# DEPLOYMENT — v0.4.3 (DB level 0013)

**Lifecycle stage: Ready for Acceptance** (see `LIFECYCLE.md`). Passing the release
gate is Internal Validation only; v0.4.x is not Accepted/Frozen until you complete
`ACCEPTANCE_CHECKLIST.md` in the running app.

## Migration classification

| Migration | Included in this package | Expected to already exist | Required | Optional |
|-----------|--------------------------|---------------------------|----------|----------|
| 0001–0009 | No | **Yes** (must be present first) | Yes | No |
| 0010 methodology & sync | **Yes** | No | **Yes** | No |
| 0011 default ownership  | **Yes** | No | **Yes** | No |
| 0012 community director | **Yes** | No | **Yes** | No |
| 0013 property admin + CD name | **Yes** | No | **Yes** | No |

There are **no optional migrations** in this release. If the detection query (see
`MIGRATION_ORDER.md` / step 1 below) shows any of 0001–0009 missing, stop: this
package assumes they exist and does not include them.

## Procedure

1. **Detect current state** — run the feature-detection query in
   `MIGRATION_ORDER.md`. Apply only migrations reported `present = false`, in
   ascending order. Do not rerun ones already present.
2. **Pre-flight backup (before 0012):**
   ```sql
   create table if not exists public._backup_transitions_pre0012 as
     select * from public.transitions;
   ```
3. **Confirm no Portfolio Manager data will be lost (before 0012):**
   ```sql
   select id, name, portfolio_manager from public.transitions
   where portfolio_manager is not null;   -- expect zero rows
   ```
4. **Apply** 0010, 0011, 0012, then 0013 (contents pasted into the SQL editor).
5. **Reload PostgREST:**
   ```sql
   notify pgrst, 'reload schema';
   ```

## Estimated runtime
DDL only, plus a one-row baseline snapshot in 0010. On the current Arkansas data
volume (1 transition, 2 properties, ~177 work items, 106 templates) the whole
0010→0013 batch completes in **well under 5 seconds**. Runtime scales with row
counts; at this scale it is effectively instant. The `notify` is instantaneous;
the cache refresh settles within a few seconds.

## Expected output
- Each DDL statement returns **"Success. No rows returned."** (or the SQL editor's
  equivalent). No errors.
- 0010 seeds baseline version **v1.0** silently (guarded `if not exists`).
- After 0012, `portfolio_manager` no longer exists and `community_director_id` /
  `community_director_name` exist.
- After 0013, `properties` has address/city/state/zip/property_type/notes/active and
  the properties grant + audit trigger are in place.
- `notify pgrst, 'reload schema';` returns success; the app's Methodology,
  Sync, and Community Director dropdown then function.

## Rollback
- Non-destructive migrations (0010, 0011) can be left in place; if fully reverting
  see the drop lists in `docs/PHASE2-DEPLOY.md`.
- **0012 rollback** (re-add `portfolio_manager`, restore values from the pre-flight
  backup, restore the 0009 audit function, optionally drop the Community Director
  columns and restore the 0011 default trigger) is in `docs/COMMUNITY-DIRECTOR.md`
  → "Rollback". Broader safety net: Supabase point-in-time recovery if enabled.

# Multi-Property Transitions — acceptance testing

This architecture update makes the **Transition** the primary operating unit.
Arkansas is one transition with two properties; work items are either **shared**
(transition-level, once) or **property-level** (once per property).

There are two ways to get the schema in place. Use **Path A** on your existing
live Supabase (non-destructive). Use **Path B** only for a throwaway dev database.

---

## Path A — non-destructive migration (your live database)

Run these in the Supabase SQL editor, in order. Nothing is reset; your users,
106 work items, and audit history are preserved.

1. `supabase/migrations/0004_transitions_schema.sql`
2. `supabase/migrations/0005_transitions_backfill.sql`
3. `supabase/migrations/0006_template_config_and_reprovision.sql`
4. `supabase/migrations/0007_transition_table_grants.sql`  ← grants `authenticated` SELECT on the new tables (required, or the app gets "permission denied for table transitions")

What 0005 does to your current data:
- creates the **Arkansas Portfolio Transition** and attaches your existing
  sample property to it;
- classifies the 106 templates (35 shared / 71 property — see
  `docs/TEMPLATE-SCOPE-MAP.md`);
- converts your existing shared-scope work items to one transition-level copy
  (nulls their `property_id`) — safe because there is a single property;
- migrates `property_members` → `transition_members`, then drops the old table;
- adds a second **Property B (placeholder)** and instantiates its 71
  property-level items.

Result: **177 work items** (35 shared + 71 × 2 properties).

> Rename the placeholder later with:
> `update public.properties set name='<real name>' where name='Property B (placeholder)';`

## Path B — fresh dev database

`supabase db reset` runs 0001–0005 then `seed.sql`, which builds the Arkansas
transition with **Cedar Crossing** and **Magnolia Court** and a realistic status
mix (177 items).

---

## Acceptance criteria → how to verify

| # | Criterion | How to check |
|---|-----------|--------------|
| 1 | One transition contains ≥2 properties | Top bar shows "Arkansas Portfolio Transition · 2 properties" |
| 2 | Users enter one Command Center | No property switching; a single transition, with a property *filter* |
| 3 | Shared work items appear once | Filter = **Shared** → 35 rows, each tagged `Shared` |
| 4 | Property items appear once per property | Filter = **Cedar Crossing** → 71; **Magnolia Court** → 71 |
| 5 | Filter by All / Shared / A / B | Property dropdown in the top bar and on Work Items |
| 6 | Dependencies show Task ID + name | Open a dependent item (e.g. T018) → "Depends on: T016 · …" |
| 7 | Edits persist after refresh | Change a status/owner, reload → value holds (real DB) |
| 8 | Audit logging works | Table `audit_log` gets a row per changed field, incl. shared items |
| 9 | RLS intact | A transition member sees 177; a restricted member sees only their property + shared |
| 10 | Unauthorized user blocked | A user with no `transition_members` row sees 0 |
| 11 | Sample data survives | Your original work items keep their ids, statuses, and audit trail |
| 12 | No DB reset | Path A never drops your data tables (only the superseded `property_members`) |

### Quick SQL spot-checks
```sql
select name from transitions;                                   -- Arkansas Portfolio Transition
select count(*) from properties;                                -- 2
select scope_type, count(*) from work_items group by scope_type; -- transition 35 / property 142
select count(*) from work_items where property_id is null;       -- 35 (shared, once)
select to_regclass('public.property_members');                   -- NULL (dropped)
```

### RLS spot-check (impersonate in SQL editor)
```sql
-- As a transition member you should see 177; as an outsider, 0.
select count(*) from work_items;
```

---

## Rollback guidance

The forward migration is non-destructive, so the **safest rollback is to restore
the pre-migration backup / Supabase point-in-time snapshot** taken before you ran
0004–0005. Do that if anything looks wrong.

If you must reverse structurally without a snapshot, run
`supabase/rollback/ROLLBACK_0004_0005.sql`. It:
- recreates `property_members` from `transition_members`,
- restores the old `has_property_access` / `has_property_write` functions and the
  property-scoped RLS policies,
- re-points existing work items back to their property,
- drops the transition tables and columns.

⚠️ Rollback **discards** anything created only under the new model — the second
placeholder property, its 71 work items, and any transition-level audit rows.
Test it on a branch/copy first. Data created after the migration cannot be
perfectly restored to the old shape.


## Troubleshooting: app shows "Loading…", an error bar, or "No transitions available"

After a migration that ADDS tables (like `transitions`), Supabase's PostgREST API
sometimes keeps serving a **stale schema cache**, so the app's REST query for the
new table fails even though the data is correct in SQL. The app now shows the
actual error with a **Retry** button instead of a blank "No transition".

Fix it once, in the Supabase SQL editor:

```sql
notify pgrst, 'reload schema';
```

(or Settings -> API -> "Reload schema cache"). Then click **Retry** in the app,
or hard-refresh. If the error mentions `permission denied`, confirm the
`authenticated` role has SELECT on `public.transitions`; if it mentions the
relation does not exist, confirm migration `0004` ran on this project.

# Admin milestone — Phase 2: Methodology Library & Transition Synchronization

Additive. Requires migrations 0004–0009 applied first, then **0010**.

## What's included

### Methodology Library (`/admin/methodology`, platform-admin only)
The authoritative methodology for every future transition. Full CRUD on master
work items with a CMS feel, not a table editor:
- Add, rename, edit description/instructions, template ID, workstream, phase,
  scope, owner role, default owner, **due-date logic** (offset days from go-live),
  dependencies, priority, **Critical Path**, **Go-Live Gate**.
- Reorder (up/down), duplicate, archive, restore.
- Search, scope/workstream/phase filters, sortable columns, and bulk
  archive / restore / delete.
- Delete is allowed only for unused items; in-use items must be archived
  (enforced by the database foreign key, surfaced as a friendly message).

### Transition Synchronization (from the library, per transition)
When the methodology changes, an admin runs **Synchronize** against a chosen
transition. A preview categorizes the delta before anything is written:
- **Add** — new work items that will be created (per scope/property)
- **Rename** — description changes on existing items
- **Metadata** — workstream/phase/priority/owner-role/gate/critical/dependency changes
- **Conflict** — scope mismatches to review (e.g., a template moved to shared
  while property-level items exist)
- **Protected** — completed work that will not be touched

The admin chooses which categories to apply. Synchronization is **additive** and
**never overwrites** status, owner, due dates, notes, comments/attachments, or
audit history, and **never deletes** completed work. Completed items are
protected by default.

### Methodology versioning
- A baseline **v1.0** is captured automatically; every existing transition is
  stamped with its methodology version.
- **Publish version** snapshots the current methodology under a label (v1.1, …).
- "Changed since v1.x" is available via `methodology_diff` (added / changed /
  removed).
- Each transition records the version it was provisioned/synced from; sync stamps
  the current version on apply.

### Separation of concerns (enforced)
- Editing the **Methodology Library** affects only *future* provisioning.
- Editing **Current Transition Work Items** affects only that transition.
- The two live on distinct screens with distinct data (`work_item_templates` vs
  `work_items`) and never cross except through the explicit Synchronize action.

## Apply order (Supabase SQL editor)
`0007` → `0008` → `0009` → **`0010`**. After adding tables, run
`notify pgrst, 'reload schema';` so PostgREST exposes the new RPCs.

## Acceptance (Phase 2)
- ✓ Create a brand-new master work item.
- ✓ Rename an existing master work item.
- ✓ Edit every methodology field.
- ✓ Duplicate a methodology item.
- ✓ Archive and restore methodology items.
- ✓ Synchronize a transition with a preview.
- ✓ Add newly created methodology items into the transition.
- ✓ Decide whether renamed methodology items update the transition.
- ✓ Refresh and verify everything persists.
Plus: publish a version, diff against a prior version, and see the transition's
current methodology version.

## Release gate
`scripts/release_check.py` now also asserts, on a clean rebuild: a new
methodology item appears in the sync preview, an additive apply creates it in the
transition, a version publishes, and a non-admin cannot synchronize.

## Review hardening (pre-deployment)
Addressing the deployment-review questions, folded into 0010 before first apply:

1. **Idempotent sync.** After applying all selected changes, a second preview
   shows no actionable add/rename/metadata/due deltas — only intentionally
   retained categories (protected-completed, conflicts, archived). Asserted in
   the release gate.
2. **Immutable-ID matching.** Provisioning, sync, and version diffs join on the
   immutable `work_item_templates.id` (carried as `work_items.template_id`), not
   on `code` or name. Editing a template's code never breaks the link or creates
   a phantom add. Asserted in the gate.
3. **Deferrals (delta-scoped).** `transition_sync_deferrals` records the
   *fingerprint* of the specific declined rename/metadata/due delta (plus the
   version context, timestamp, and user). The "Ignore" action suppresses that
   exact delta only; if the template changes again the fingerprint no longer
   matches and the new delta re-appears, so a deferral can never permanently
   hide legitimate future changes. Asserted in the gate.
4. **Archived / removed visibility + lineage.** Sync preview surfaces an
   "archived / removed" category for work items whose template was archived.
   A `BEFORE DELETE` trigger prevents hard-deleting any template referenced by a
   transition work item or a version snapshot (archive-only); only genuinely
   unused, never-versioned templates can be deleted, so historical identifiers
   are never orphaned. Asserted in the gate.
5. **Immutable versions with counts.** Published versions are client-immutable
   (insert/update/delete revoked; writes only via the SECURITY DEFINER publish
   function) and carry release note, publisher email, timestamp, and
   added/changed/removed counts (viewable in Version history).
6. **Due-date source.** `work_items.due_date_source` distinguishes
   `methodology` from `manual`. Methodology-derived dates are recomputed from the
   template's due-offset and go-live and can be synced intentionally (the "Apply
   methodology due dates" option); manual overrides never appear in the due delta
   and are never overwritten.

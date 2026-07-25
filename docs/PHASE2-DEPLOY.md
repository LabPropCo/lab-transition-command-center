# Phase 2 — Deployment & Validation Runbook (Arkansas)

## 1. Apply migrations (Supabase SQL editor, in order)
Run each file's contents if not already applied:
```
0007_transition_table_grants.sql
0008_explicit_grants.sql
0009_admin_transition_settings.sql
0010_methodology_and_sync.sql
```

## 2. Reload the PostgREST schema cache
After 0010 (new tables + RPCs), tell PostgREST to pick them up:
```sql
notify pgrst, 'reload schema';
```
If the RPCs still 404 from the app after a minute, run it again, or toggle
Settings → API → "Reload schema" in the Supabase dashboard.

## 3. Confirm the baseline landed
```sql
select label, is_current, added_count, changed_count, removed_count from methodology_versions;
-- expect one row: v1.0, is_current = true

select name, methodology_version_id is not null as stamped from transitions;
-- Arkansas should be stamped

select count(*) as templates from work_item_templates;         -- 106
select count(*) as snapshot from methodology_version_items;     -- 106 (v1.0)
select count(*) from work_items where transition_id =
  (select id from transitions limit 1);                         -- 177
```

## 4. Validate the workflow in the app (as the platform admin)
System → Methodology Library:
- **Create** a new master item; confirm it saves and appears.
- **Rename** an item (edit name/description); **edit** other fields; **Save**.
- **Duplicate** an item; **Archive** then **Restore** it (toggle "Show archived").
- Change a **template ID (code)** on an item — this must NOT break sync matching.
- **Publish version** (e.g. v1.1); open **History** and confirm the note,
  publisher, timestamp, and change counts.

System → Methodology Library → **Synchronize Arkansas…**:
- Review the **preview** (add / rename / metadata / due / conflict / protected / archived).
- **Selectively apply**: check "Add new work items" (and optionally renames /
  metadata / due), keep "Protect completed work" on, **Apply selected**.
- Confirm new items appear in Master Work Items for Arkansas.
- Use **Ignore** on a rename/metadata row and confirm it drops out of the preview
  and is not applied.
- Set a due date manually on a work item; confirm it never appears in the due
  delta and is never overwritten by sync.

Verification:
- **Protected fields**: open a synced item that had status/owner/notes — confirm
  those are unchanged.
- **Version stamping**: `select methodology_version_id from transitions;` matches
  the current version after apply.
- **Non-admin**: a non-admin has no System menu and cannot reach `/admin/*`.
- **Persistence + idempotency**: refresh; run the preview again — no remaining
  actionable changes except items you intentionally deferred or that are
  protected/conflicting. A repeated (no-op) Apply changes nothing and writes NO
  audit entry; only an Apply that actually changes something is audited.

## Rollback
0010 is additive. To remove Phase 2 objects (does not touch work item data other
than the added `due_date_source` column):
```sql
drop function if exists apply_transition_sync(uuid,boolean,boolean,boolean,boolean,boolean);
drop function if exists sync_preview(uuid);
drop function if exists defer_sync_change(uuid,uuid,text);
drop function if exists undefer_sync_change(uuid,uuid,text);
drop function if exists methodology_diff(uuid);
drop function if exists publish_methodology_version(text,text);
drop table if exists transition_sync_deferrals;
drop table if exists methodology_version_items;
alter table transitions drop column if exists methodology_version_id;
drop table if exists methodology_versions;
-- optional: alter table work_item_templates drop column if exists due_offset_days, drop column if exists archived;
-- optional: alter table work_items drop column if exists due_date_source;
```

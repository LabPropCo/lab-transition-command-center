# M2 — Work Items engine · acceptance

Status: **code complete, compiled, and validated against a real Postgres**
(migrations + triggers + RLS run and asserted locally). Live acceptance is against
your Supabase project after `supabase db reset` / `db push`.

## How to run it
```bash
supabase db reset          # applies 0001, 0002, 0003 + seed (sample property, 106 items)
npm run dev
```
Sign in (M1) as the admin; open **Master Work Items**. The sample property is
seeded with a realistic mix of statuses so filters/sort have something to bite on.

## Criteria → where it lives → how to verify

| # | Criterion | Implementation | Verify |
|---|-----------|----------------|--------|
| 1 | 106 items in reusable template library | `0003_seed_work_item_templates.sql` → `work_item_templates` | `select count(*) from work_item_templates` = 106 |
| 2 | Work Items property-scoped | `work_items.property_id` + `instantiate_property_work_items()` | Each property has its own 106 rows; RLS filters by property |
| 3 | List, search, filter, sort | `WorkItems.tsx` — search (id/desc/owner), filters (workstream/phase/status/gate-only), sortable columns (ID/Due/Priority/Status) | Type in search; change filters; click column headers |
| 4 | Detail side panel (approved) | `WorkItemDetail.tsx` | Click any row → panel slides in |
| 5 | Edit status, owner, responsible party, due date, notes, Dropbox link | Panel fields + `updateWorkItem()`; inline status in the table too | Edit, Save; inline-change a status in the table |
| 6 | Changes persist after refresh | Writes go to Postgres; list reloads from DB | Edit, refresh the page, confirm it stuck |
| 7 | Completion sets `completed_at`; reopening clears it | `work_items_before_update()` trigger | Set Complete → `completed_at` populates; reopen → clears |
| 8 | Dependency shows Task ID + name | Panel resolves `depends_on_code` against loaded items | Open T018 → "Depends on: T016 · Open security deposit trust account" |
| 9 | Every meaningful change writes to audit log | `work_items_audit()` trigger (SECURITY DEFINER), one row per changed field | `select * from audit_log order by id desc` after an edit |
| 10 | RLS blocks unassigned properties | `wi_read/insert/update/delete` policies via `has_property_access` / `has_property_write` | A non-member sees 0 rows and cannot edit |

## Local validation already performed (against bundled Postgres)
- Migrations 0001→0003 + seed apply cleanly. Templates = 106; sample work_items = 106.
- Status mix matches the workbook exactly (21 Complete / 64 Not Started / 11 In
  Progress / 5+1+3 Waiting / 1 Blocked).
- RLS SELECT: platform admin 106, assigned member 106, outsider **0**.
- Completion lifecycle: Complete → `completed_at` set, `updated_by` = actor;
  reopen → `completed_at` cleared.
- Audit: status / notes / dropbox_link / due_date changes each logged with actor email.
- Write isolation: outsider UPDATE affects **0 rows**; outsider reads **0** audit rows.
- Second-property isolation: a member of property A sees **0** items in property B.

## Notes / deliberate choices
- **Owner / responsible party / status** are fixed pick-lists from the workbook.
  They become admin-editable (`config_lists`) in M6.
- **Priority/phase/workstream** are shown read-only in the panel — only the six
  fields in criterion #5 are editable, matching the spec exactly.
- The audit trigger records **one row per changed field**, which drives the
  activity feed in a later milestone.
- Dev seed clears its own audit rows at the end so testers see only their own
  actions. Real properties (instantiated via M6) never generate seed audit noise.
- **RLS write** allows any member except `read_only`; a `read_only` user's edit is
  rejected by Postgres and surfaced as a permission message in the panel.

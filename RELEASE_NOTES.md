# Release Notes — The Lab Transition Command Center

Product versions are for humans; migration numbers are for the database. They are
tracked separately and deliberately do not line up one-to-one. Release stages
follow `LIFECYCLE.md`: passing the gate reaches only **Ready for Acceptance** — a
version is **Frozen** only after the owner completes the in-app checklist.

| Version | Release name | DB migrations | Status |
|---------|--------------|---------------|--------|
| v0.2.0  | Transition Architecture | 0001–0008 | **Frozen** (User Accepted) |
| v0.3.0  | Admin Phase 1 — Admin area + Transition Settings | 0009 | **Frozen** (User Accepted) |
| v0.4.0  | Methodology Library & Transition Synchronization | 0010 | Ready for Acceptance |
| v0.4.1  | Default ownership | 0011 | Ready for Acceptance |
| v0.4.2  | Community Director | 0012 | Superseded by v0.4.3 |
| v0.4.3  | Property Administration & Community Director fixes | 0013 | Superseded by v0.4.4 |
| v0.4.4  | Template responsible_party integrity (this package) | 0014 | Ready for Acceptance |

## v0.4.4 — current package
- **Version:** 0.4.4
- **Build date:** 2026-07-15
- **Database migration level:** 0014
- **Compatible migration range:** requires DB at level **0014** (this app build
  reads `community_director_id`, the sync RPCs, and `due_date_source`; it will not
  run correctly against an older schema).
- **Included migrations:** 0010, 0011, 0012, 0013, 0014.
- **Expected already present:** 0001–0009.
- **Lifecycle stage:** Ready for Acceptance (Internal Validation passed; awaiting your in-app acceptance).

### What's in this release (v0.4.0 → v0.4.2 combined)
- **v0.4.0 Methodology Library & Transition Synchronization** — full CRUD master
  methodology (CMS), fingerprinted deferrals, immutable-ID matching, additive
  sync with protected fields, versioning with change counts, delete protection.
- **v0.4.1 Default ownership** — new transition work items default the assigned
  *user* to the creator only when unassigned; methodology owner *role* preserved.
- **v0.4.2 Community Director** — replaces Portfolio Manager with a user-referenced
  Community Director (dropdown, blank allowed, FK `ON DELETE SET NULL`, audited).

### v0.4.4 — acceptance-defect fix (this package)
Found during v0.4.3 acceptance testing; fixed before Frozen. Synchronize aborted
with `work_items_resp_chk` because `work_item_templates.responsible_party` was not
constrained and the methodology editor accepted free text, letting an out-of-vocabulary
value (T107 = "Property Manager") reach the constrained `work_items` table on sync.
- **Editor** (`src/components/TemplateDetail.tsx`): the free-text "Owner role
  (responsible)" field is now a dropdown reusing the shared `RESP_PARTIES` constant
  (blank + The Lab / Client / Prior Manager / Vendor / Shared). `owner` unchanged.
- **Database** (migration `0014`, schema-only, transaction-wrapped): adds
  `work_item_templates_resp_chk`, matching `work_items_resp_chk` exactly, with an
  abort guard that refuses (and names offenders) rather than coercing.
- **Synchronize is unchanged** — the defect was invalid source data reaching a
  constrained table, not the sync logic.
- **T107 correction is a separate, reviewed operational step**
  (`docs/operational/0014_t107_correction.sql`) — not embedded in the migration.
  Live order: detect → confirm T107 only → guarded correction (exactly one row) →
  re-detect zero → apply 0014 → reload PostgREST → re-test Synchronize.
- `responsible_party` write-path audit: the only path that accepted arbitrary text
  was the methodology editor; seed (0003), the gate fixtures, and all RPC/sync paths
  already use valid vocabulary. No import utility exists. Details in the changed-file
  list and RESP_PARTIES reuse.

### v0.4.3 — acceptance-defect fixes (this package)
Found during v0.4.x acceptance testing; fixed before Frozen:
1. **Property Administration** — the Properties admin screen is pulled forward from
   Phase 3 so a transition can be configured without SQL. Admins can rename, edit
   (name/address/city/state/zip/unit count/type/notes), add, mark Active/Inactive,
   set the Default Property, and replace "Property B (placeholder)". Renames
   preserve the property ID, work items, audit, membership, and transition links;
   no work items are recreated, duplicated, or deleted (all 177 preserved).
   Property edits are audited and propagate to filters, scope labels, and dropdowns.
2. **Community Director is now free text** — the user picker (which surfaced the
   logged-in email) is replaced by a plain name field stored in
   `community_director_name`; blank is allowed, no auth/lookup, no default.
   `community_director_id` is retained (nullable) for a future optional link.

### ⚠ Modifies previously accepted phases (stated explicitly, per policy)
- v0.4.2 + v0.4.3 **change the v0.3.0 (Admin Phase 1) Transition Settings**: Portfolio
  Manager was replaced by Community Director (0012), and the Community Director
  user-picker was replaced by a free-text name field (0013).
- **Property administration** (normally a v0.5.0/Phase 3 feature) is pulled forward
  into v0.4.3 to resolve the acceptance defect. Phase 3 will still own Users and any
  deeper property features.
- **v0.4.4** adds a CHECK to `work_item_templates.responsible_party` (table from
  v0.2.0). Additive integrity only; existing values already conform; no v0.2.0
  data/behavior change.
No other part of v0.2.0 or v0.3.0 is altered.

### Acceptance
Internal Validation (release gate A–G) has passed, so this package is **Ready for
Acceptance**. It is **not accepted**. It becomes **Frozen** only after you
personally complete `ACCEPTANCE_CHECKLIST.md` (v0.4.x) inside the running
application in Arkansas. See `LIFECYCLE.md`.

# ACCEPTANCE CHECKLISTS

One checklist per phase, tied to the stages in `LIFECYCLE.md`. A green release
gate only makes a version **Ready for Acceptance**. When *you* complete a phase's
checklist inside the running app (User Acceptance), that phase becomes **Frozen**:
no later package may modify it silently — any change to a frozen phase must be
called out explicitly in `RELEASE_NOTES.md` and `manifest.json`.

---
## v0.2.0 — Transition Architecture  · STATUS: ✅ FROZEN (User Accepted)
(Recorded from prior approval.)
- [x] Auth, membership, and RLS scoping validated
- [x] Multi-property transition model; Arkansas loads
- [x] 177 seeded work items; shared vs property scope correct

## v0.3.0 — Admin Phase 1 (Admin area + Transition Settings) · STATUS: ✅ FROZEN (User Accepted)
(Recorded from prior approval. NOTE: the Transition Settings screen is modified by
v0.4.2 — see Release Notes.)
- [x] Admin area gated to platform admins
- [x] Transition Settings edit + live propagation + server-side audit

---
## v0.4.x — Methodology Library & Transition Synchronization · STATUS: 🧪 READY FOR ACCEPTANCE
Internal Validation (gate A–G) passed. Completing these in Arkansas (User
Acceptance) is what moves v0.4.x to **Frozen**.

### Methodology Library (v0.4.0)
- [ ] Create a new master work item; it persists
- [ ] Rename an item; edit every field; Save persists
- [ ] Duplicate an item
- [ ] Archive then restore an item (toggle "Show archived")
- [ ] Change a template's code (ID) — sync matching still works (no phantom add)
- [ ] Publish a version; History shows note, publisher, timestamp, change counts

### Transition Synchronization (v0.4.0)
- [ ] Preview shows add / rename / metadata / due / conflict / protected / archived
- [ ] Selectively apply (Add on; Protect completed on); new items appear
- [ ] Decide whether renames apply; verify chosen behavior
- [ ] "Ignore" a rename/metadata delta → it drops from the next preview
- [ ] Change that template again → a fresh delta reappears
- [ ] Manually set a due date → it never appears in the due delta or gets overwritten
- [ ] Completed work: status/owner/notes unchanged after sync
- [ ] Re-run a full sync → no duplicates/changes and NO audit entry (no-op)

### Default ownership (v0.4.1)
- [ ] A synced-in item with no methodology owner shows you as owner; role preserved
- [ ] An existing/hand-set owner is not overwritten on re-sync

### Community Director (v0.4.2)
- [ ] Leave Community Director blank → saves and stays blank
- [ ] Assign a Community Director → selection persists
- [ ] Clear it → returns to blank
- [ ] Audit history shows the assignment and the clear (old id → new id, and → null)


### v0.4.3 — Property Administration (acceptance defect fixes)
- [ ] Rename Cedar Crossing
- [ ] Rename "Property B (placeholder)"
- [ ] Refresh and see both names persist
- [ ] See updated names in the property filter
- [ ] See updated names in Work Item scope labels
- [ ] Add a new property
- [ ] Edit property information (address/city/state/zip/units/type/notes)
- [ ] Mark a property inactive
- [ ] Set the Default Property
- [ ] Verify the existing 177 Work Items remain unchanged (none created/duplicated/deleted)
- [ ] Verify property edits appear in audit history (who/when/old/new)
- [ ] Verify non-admins cannot edit Properties

### v0.4.3 — Community Director (acceptance defect fixes)
- [ ] Enter a Community Director name (e.g. "Jane Smith")
- [ ] Refresh and verify the name persists
- [ ] Confirm your email no longer appears as the default value
- [ ] Verify the change appears in audit history
- [ ] Verify non-admins cannot edit Community Director


### v0.4.4 — Template responsible_party integrity (acceptance defect fix)
Operational DB steps (owner-performed/approved; see docs/operational/0014_t107_correction.sql):
- [ ] Run the invalid-value detection query; confirm T107 is the only result
- [ ] Run the guarded T107 correction; confirm exactly one returned row
- [ ] Re-run detection; confirm zero invalid rows
- [ ] Apply migration 0014; then `notify pgrst, 'reload schema';`

Application behavior:
- [ ] Methodology editor "Owner role (responsible)" is a dropdown (blank + 5 values); arbitrary text is not possible
- [ ] A valid role saves through the editor
- [ ] Database rejects an invalid template responsible_party via direct SQL (insert and update)
- [ ] Arkansas Synchronize creates exactly two T107 work items (one per property)
- [ ] Both T107 items use responsible_party = 'The Lab'
- [ ] T030 methodology due-date change behaves as previewed
- [ ] Completed T001 remains protected (unchanged) across Synchronize
- [ ] Archived T018 items remain retained (not deleted)
- [ ] Synchronize remains atomic (a failed apply makes no partial changes)
- [ ] Synchronize audit summary is recorded

### General
- [ ] Refresh: everything persists
- [ ] Non-admin cannot reach `/admin/*` or write settings/methodology/sync

**Sign-off (User Acceptance):** _______________  Date: ________  → on completion,
v0.4.x moves from Ready for Acceptance to **Frozen**, then Production Baseline
once deployed live.

# Release Lifecycle (permanent project standard)

Every product version moves through these stages in order. **Passing automated
tests is necessary but not sufficient** for acceptance — the release gate only
establishes *Internal Validation*. A version is **Frozen only after the product
owner personally completes the in-app acceptance checklist.**

| # | Stage | Who owns it | Entry criteria | Meaning |
|---|-------|-------------|----------------|---------|
| 1 | **Development** | Engineering (Claude) | Work in progress | Being built; not yet validated. |
| 2 | **Internal Validation** | Engineering (Claude) | Code complete | Release gate A–G green + local replica rehearsal done. |
| 3 | **Ready for Acceptance** | Engineering → Owner | Internal Validation passed; package shipped with manifest | Handed to the owner for testing. **Not accepted.** |
| 4 | **User Acceptance** | Product owner (you) | Owner runs the acceptance checklist **inside the running application** | Owner is actively verifying in the live environment. |
| 5 | **Frozen** | Product owner (you) | Acceptance checklist fully completed & signed off | Locked. No later package may modify it silently; any change must be declared in RELEASE_NOTES.md + manifest.modifiesAcceptedPhases. |
| 6 | **Production Baseline** | Product owner (you) | Frozen release deployed and running in production | The current live baseline. |

## Rules
- The release gate can move a version to at most **Ready for Acceptance**. It can
  never mark a version Frozen — only the owner can, via stage 4 → 5.
- `manifest.json` carries the current `lifecycleStage`. The gate validates it is
  one of the stages above and displays it, but does not decide it.
- Automated PASS ≠ Accepted. A green gate means "Ready for Acceptance," nothing more.

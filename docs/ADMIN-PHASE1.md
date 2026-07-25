# Admin milestone — Phase 1: Admin area + Transition Settings

Additive only. No existing route, color, type, layout, or UX was changed.

## Apply order (Supabase SQL editor)
Phase 1 depends on the grant migrations. Run in order if not already applied:
1. `0007_transition_table_grants.sql`
2. `0008_explicit_grants.sql`
3. `0009_admin_transition_settings.sql`  (transition metadata, admin audit, branding bucket)

`0009` is idempotent and guards the storage bucket creation so it is safe on any
project (it only creates the bucket where Supabase Storage exists).

## What's included
- **Admin area** at `/admin`, gated by `RequireAdmin` (platform admins only). A
  **System** nav group appears in the sidebar only for admins, listing only the
  screens that exist today.
- **Transition Settings** (`/admin/transition-settings`): edit transition name,
  company name, go-live date, status, current phase, portfolio/transition/
  regional managers, default property, primary/secondary color, logo, and notes.
- **Live propagation:** saving reloads the transition context, so the top bar,
  the browser title, the go-live countdown, and the company line update at once.
- **Logo upload** to the `branding` storage bucket (admin-write, public-read), or
  paste a URL.
- **Server-side admin audit:** an `AFTER UPDATE` trigger writes one
  `admin_audit_log` row per changed field (entity_type `transition`), captured
  with actor + old/new value. This table also backs the Phase 4 Audit Log UI.

## Acceptance (Phase 1 subset)
- ✓ Rename the transition (updates top bar, title, nav immediately).
- ✓ Rename the company.
- ✓ Change the go-live date (countdown updates).
- ✓ Upload a logo (or set a URL).
- ✓ Every settings field persists to Supabase and survives refresh.
- ✓ Non-admins cannot see the admin area or write settings (RLS + guard).
- ✓ Every admin edit is recorded with who/when/old/new.

Remaining acceptance items (properties, users, methodology CRUD, sync UI,
import/export, audit UI) land in Phases 2–4.

## Release gate
`scripts/release_check.py` now also asserts, on a clean rebuild, that an admin
edit to a transition is audited and that a non-admin edit is blocked.

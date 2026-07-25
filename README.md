# The Lab · Transition Command Center

Operational platform for managing multifamily property transitions.
See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full, approved architecture.

## Milestone status
- **M0 — Foundation** ✅ Deployable themed shell: design system, navigation, chrome.
- **M1 — Auth & property scoping** ✅ *code complete* — invite-only 6-digit email OTP,
  RLS-scoped multi-property access, property switcher, first-admin seed, invite
  Edge Function. Live setup + acceptance tests: **[docs/M1-RUNBOOK.md](./docs/M1-RUNBOOK.md)**.
- **M2 — Work Items engine** ✅ *code complete & DB-validated* — 106-item template
  library, property-scoped instances, list/search/filter/sort, detail side panel,
  editable fields, completion + audit triggers, RLS. See **[docs/M2-ACCEPTANCE.md](./docs/M2-ACCEPTANCE.md)**.
- **M3 — Dashboard** ⏳ next (not started).

## Run locally
```bash
npm install
cp .env.example .env.local     # add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                    # http://localhost:5173
```
Without Supabase env the login screen renders in a clearly-labeled "backend not
configured" state, so the UI still runs.

## Local demo mode (offline UI review — no backend)

The simplest way to review the interface. **No Supabase, auth, email, or
Cloudflare required.** It loads the Cedar Crossing sample property and all 106
work items from local fixtures and signs you in as a demo admin automatically.

Dev-only: gated on `import.meta.env.DEV` + the flag, so it is impossible to enable
in a production build (fixtures and demo code are dead-code eliminated).

**Run it:**
```bash
npm install
echo "VITE_DEMO_MODE=true" > .env.local   # the only line you need
npm run dev
```
Open the printed URL (e.g. http://localhost:5173). You'll land straight in the app
with a **DEMO MODE** badge (bottom-left). Open Dashboard, Master Work Items (all
106 items, searchable/filterable/sortable), the detail panel, My Actions, etc.

Notes:
- Edits work live for review but are **session-only** — they reset on refresh
  (there's no backend to persist to).
- To leave demo mode, delete `.env.local` (or set `VITE_DEMO_MODE=false`) and restart.

> Two local modes exist. Use **demo mode** (above) to review the UI with zero setup.
> Use the **dev auth bypass** (below) only when you want to review against *real*
> Supabase data. If both flags are set, demo mode wins.

## Local dev auth bypass (review against REAL Supabase data)

Use this when you want to review the app signed in as the admin against your real
Supabase project (real JWT, real RLS, real data) — without email/Resend. Dev-only
and excluded from production builds, exactly like demo mode.

It does a **real** `signInWithPassword`, so the admin needs a password once:

**1) One-time — set the dev password** (defaults to `labdev-transition`):
```bash
SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY \
npm run set:dev-password
```

**2) Add the flag to `.env.local`** (plus your Supabase URL + anon key):
```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
VITE_DEV_AUTH_BYPASS=true
```
That's it — no password variable needed (it uses the same default). If you chose a
custom password in step 1, also add `VITE_DEV_ADMIN_PASSWORD=your-password`.

**3) Restart:** `npm run dev`. You'll be signed in automatically as the admin with a
red **DEV MODE** badge. If sign-in fails, the app shows a clear panel telling you
exactly what to run (it never drops you on the OTP screen while the bypass is on).

Turn it off: remove `VITE_DEV_AUTH_BYPASS` from `.env.local` and restart.

> Two local modes: **demo mode** (above) = zero backend, sample data, UI review.
> **Dev auth bypass** (this one) = real Supabase data. If both are set, demo wins.

## Build
```bash
npm run build      # type-checks, then outputs static site to /dist
npm run preview
```

## Deploy (Cloudflare Pages)
- Preset **Vite** · build `npm run build` · output `dist`.
- Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as Pages env vars.
- `public/_redirects` handles SPA routing.

## Backend (Supabase) — see the runbook
- `supabase/migrations/0001_auth_and_properties.sql` — profiles, properties,
  property_members, RLS, helpers.
- `supabase/functions/invite-user/` — admin-only, service-role provisioning.
- `supabase/templates/otp-email.html` — 6-digit OTP email (magic-link fallback).
- `scripts/seed-admin.mjs` — one-time first-admin bootstrap (`npm run seed:admin`).

## Security invariants (do not regress)
- Browser holds only the **anon key**; **RLS is the authorization boundary**.
- **Service-role key never in the frontend** — only in Edge Function secrets and
  the local seed script.
- **Invite-only**: sign-up disabled in the dashboard AND `shouldCreateUser:false`
  on the client; users provisioned only via `invite-user`.
- **Generic login responses** — the login screen never reveals who is registered.
- **No passwords stored** — credentials are metadata only (arrives M5).

## Project layout
```
src/app         router, AppShell, RequireAuth guard
src/auth        AuthProvider (session)
src/properties  PropertyProvider (RLS-scoped property list + switcher state)
src/screens     Login + one screen per milestone (M0 shared placeholder frame)
src/components  Sidebar, TopBar, PropertySwitcher
src/lib         supabase client, nav config
src/styles      tokens.css (palette), global.css, app.css, login.css
supabase/       migrations, functions, templates, config, seed
scripts/        seed-admin.mjs
docs/           M1-RUNBOOK.md
```

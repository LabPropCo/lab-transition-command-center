# The Lab · Transition Command Center — Architecture (V1.0, consolidated)

Status: **approved**. This is the founding reference. Every decision below is locked
unless explicitly revisited. Implementation proceeds one milestone at a time; each
milestone leaves the app in a working, testable state and stops for approval.

---

## 1. What this is

The operational platform The Lab Property Company uses to run multifamily property
transitions — from management-agreement execution through go-live and the first 90
days. Not a project tracker: a purpose-built command center whose north star is that
users "know exactly where we stand, what they own, what's blocking go-live, and what
happens next."

The approved **HTML prototype defines the experience**; the approved **Excel workbook
defines the behavior** (a 106-item work-item engine across 9 workstreams and 10
phases, with derived readiness, go-live gates, and per-owner queues).

---

## 2. Architecture at a glance

```
Browser — React SPA (the approved UX, faithfully rebuilt)
   │  Supabase JS client (anon key + user JWT)
   ▼
Supabase
   ├── Postgres      all operational data · Row-Level Security is the boundary
   ├── Auth          invite-only 6-digit email OTP (magic link fallback)
   └── Edge Functions  provisioning, invites, Dropbox, audit (service role, server-only)
   │  links only
   ▼
Dropbox — document system of record (URLs stored; files never leave Dropbox)

Hosting: Cloudflare Pages (static SPA)   ·   Email: Resend via Supabase Custom SMTP
Source/CI: GitHub → Cloudflare Pages     ·   Secrets: external password manager
```

Design principle: **few moving parts.** One backend (Supabase), one host
(Cloudflare Pages), one document store (Dropbox), one mail provider (Resend).

---

## 3. Decisions (locked)

| # | Decision | Resolution |
|---|----------|-----------|
| 1 | Frontend | Faithful **React + Vite + TypeScript** rebuild of the prototype. The uploaded HTML is a bundled export, not maintainable source; we preserve the *experience*, not the artifact. |
| 2 | Multi-property | **Yes, from day one.** Everything is scoped by `property_id`. Replaces the workbook's "duplicate per transition" model. |
| 3 | Documents | **Dropbox, links only, in V1.** Pasted links; no file upload/storage. Dropbox API picker is a later enhancement. |
| 4 | Credentials | **Metadata only — no passwords stored.** The app tracks credential lifecycle; secrets live in the team's password manager. |
| 5 | Hosting | **Cloudflare Pages** (static SPA). Server logic consolidated into Supabase Edge Functions, not a second platform. |
| 6 | Database | **Supabase Postgres.** Recommend **Pro ($25/mo)** for daily backups and to avoid free-tier project pausing on a weekly-use tool. |
| 7 | Auth | **Supabase Auth, invite-only email OTP** (see §5). Microsoft SSO out for V1 (teams span unfederated tenants/domains). Google SSO optional future, never required. |
| 8 | Admin | Nontechnical **in-app Admin console** owns properties, people, roles, and the transition template. The Supabase dashboard is not an admin surface. |

---

## 4. Authorization — RLS is the boundary

Authentication proves *identity*; **`property_members` + Row-Level Security decide
what each user may view or edit.** The browser holds only the anon key, which is
powerless on its own.

- RLS is **deny-by-default on every table.**
- Access is granted only through rows in `property_members` (user × property × role).
- A SQL helper — `has_property_access(property_id, min_role)` — keeps policies DRY
  and auditable.
- The sensitive `credentials` table holds **no secrets** and is further restricted
  to elevated roles; every read is audit-logged.
- RLS policy design and tests are a first-class deliverable reviewed before M2 data
  writes ship.

---

## 5. Authentication (V1, final)

**Primary experience: 6-digit email OTP.** Magic link is a fallback only.

Why OTP-first: your users are spread across unrelated corporate mail systems.
Corporate link scanners (Defender Safe Links, Proofpoint) pre-click magic links and
silently consume the single-use token; links opened on a different device than they
were requested from break under PKCE. A code the user reads and types avoids both.

**Invite-only — enforced by three controls together:**
1. Public sign-ups **disabled** at the project level.
2. Client sign-in call passes **`shouldCreateUser: false`** — the login screen can
   never mint an account.
3. Users are provisioned **only** by an admin via a server-side Edge Function using
   the service-role key (`admin.createUser` / `inviteUserByEmail`), which writes the
   `property_members` rows in the same transaction.

**Other auth rules:**
- **Generic login responses** — "If that address is registered, you'll get a code" —
  regardless of whether the email exists, so the user list can't be probed.
- **De-provisioning** is first-class: admins revoke property membership and disable
  access; removing `property_members` cuts access instantly via RLS.
- **First-admin bootstrap:** exactly one admin (+ one backup) is seeded by
  migration at setup; everyone else comes through the console.
- **Email:** **Resend via Supabase Custom SMTP**, with auth templates configured for
  the OTP flow. Deliverability across multiple corporate domains is an **M1
  acceptance criterion**, not a post-launch discovery.
- **Google SSO:** pluggable later with no schema/RLS rework. Nothing in V1 assumes a
  provider.

---

## 6. User roles (per-property)

Role lives on `property_members`, so a regional manager sees only their portfolio.

- **admin** — Director of Operations + backup; everything, plus users/properties/
  templates/config.
- **regional_manager** — full read/write on assigned properties.
- **property_manager** — read/write work items, docs, vendors, risks on their property.
- **accounting** — read/write accounting/banking items, documents, credential metadata.
- **transition_team** — read/write items they own; read elsewhere.
- **read_only** — scoped view (future: client/ownership visibility).

---

## 7. Data model (first pass)

All operational tables carry `property_id` and are RLS-scoped.

- `properties` — one row per transition (the "Property Setup" sheet).
- `property_members` — user × property × role. Drives all authorization.
- `work_items` — the engine: phase, workstream, sub-workstream, description,
  completion standard, owner, responsible party, dependency, critical-path,
  go-live gate + gate group, priority, start, due, status, notes, doc link,
  `updated_at`, `updated_by`, `completed_at`.
- `documents` — request → received → reviewed → completed, reviewer, missing info,
  Dropbox link.
- `credentials` — **metadata only** (system, account, URL, username, MFA method,
  primary/backup owner, verified date, reset-required). No secret column.
- `contacts`, `vendors`, `risks_issues`, `decisions`.
- `config_lists` — editable enumerations (statuses, priorities, workstreams, phases,
  owners, gate groups) so admins tune pick-lists without code.
- `templates` — reusable task library; new transitions start pre-populated.
- `audit_log` — who changed what, when.

Go-live gates and readiness are **computed** from `work_items`, never stored, so they
cannot drift.

---

## 8. Design system (locked to the prototype)

Reproduced verbatim — the prototype is the brief.

- Surfaces: paper `#F4EEE3`, card `#FAF5EB`, panel `#ECE3D1`, line `#D9CFBC`.
- Ink: `#26211A` / soft `#5C5448` / muted `#8A8071`.
- Accents: gold `#A8813B`, bronze `#9C7C52` (hover), terra `#A5624A` (alert).
- Type: **Fraunces** (display) + **Inter** (body).
- IA: four-group sidebar — Command / Execution / Oversight / Reference — plus Admin.

---

## 9. Repository layout

```
/src
  /app        router, AppShell, auth guard (M1)
  /screens    one file per screen as each milestone builds it out
  /components Sidebar, TopBar, and shared UI
  /lib        supabase client, nav config, derived-metric helpers
  /styles     tokens.css (the palette), global.css, app.css
  /types      domain types
/supabase
  /migrations schema + RLS (M1)
  /functions  invite / provision-transition / dropbox / audit (M1+)
/public       _redirects (SPA rewrite for Cloudflare Pages)
```

---

## 10. Milestones

Each stops for approval.

- **M0 — Foundation.** ✅ built. Repo, React/Vite/TS skeleton, design tokens, navigable themed
  shell, Supabase client wired, CI to Cloudflare. *Testable: the themed shell deploys.*
- **M1 — Auth & property scoping.** ✅ code complete (live setup via docs/M1-RUNBOOK.md). Invite-only OTP, Resend SMTP + multi-domain
  delivery tests, `properties` + `property_members`, RLS, property switcher, auth
  guard, first-admin seed. *Testable: two users see only their properties; invites work.*
- **M2 — Work Items engine.** ✅ code complete & DB-validated. The 106-item model, list/filter/detail, status
  write-back, audit. *Testable: change a status, it persists and logs.*
- **M3 — Dashboard & derived metrics.** Readiness, gates, workstream progress,
  blockers — pixel-matched. *Testable: dashboard reflects M2 live.*
- **M4 — Command screens.** My Actions, Weekly Meeting, Roadmap, First 90 Days.
- **M5 — Registers.** Documents, Risks, Decisions, Contacts, Vendors, Credentials-metadata.
- **M6 — Admin console.** Create transition from template; invite/assign/revoke/disable.
- **M7 — Hardening.** RLS audit, backups, empty/error states, final polish.

---

## 11. Deployment

GitHub `main` → Cloudflare Pages production; PR previews for review. Supabase
migrations version-controlled and applied via CI. A separate Supabase **staging**
project so we never test against live transition data.

---

## 12. Risks & mitigations

- **Live-credential storage** → descoped to metadata + password manager.
- **RLS misconfiguration = data exposure** → explicit policy tests before M2.
- **Magic-link failures across corporate mail** → OTP-first.
- **Email deliverability** → Resend + multi-domain tests as M1 acceptance.
- **Free-tier project pausing** → Supabase Pro.
- **Scope creep (notifications/integrations)** → out of V1.
- **Open item to confirm:** the workbook's document links reference *SharePoint*,
  but Dropbox is the chosen repository — reconcile the true system of record.


## Multi-Property Transitions (pre-M3)

The **Transition** is the primary operating unit; **Properties** belong to a transition. Each `work_item_template` has a `scope_type` (`transition` = one shared item; `property` = one per property). Access is transition-scoped via `transition_members`, with optional per-property restriction via `transition_member_properties`. RLS enforces both. Migrations `0004`/`0005` evolve existing data non-destructively (106 -> 177 for a two-property transition). See `docs/TEMPLATE-SCOPE-MAP.md` and `docs/TRANSITIONS-ACCEPTANCE.md`.

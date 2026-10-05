# River Run Ingestion Architecture — Version 1

**Status:** Design proposal, no code written yet. Built on the finalized data model from `RIVER-RUN-DASHBOARD-PRD.md`, after the Unknowns walkthrough.

**Scope reminder (from the original Phase 1 brief):** Version 1 does not connect to Yardi or AIRM directly. It faithfully ingests the *existing* reporting artifacts — the two Google Sheets/Drive workbooks and the shared Portfolio Market Survey — into one real data model, and produces the dashboard and a narrative first draft from that model. Direct system integration (Yardi, AIRM) is a later phase, noted below only as a future extension point, not something this design builds.

---

## 1. Source Inventory

| Source | What it actually is | Update cadence | Role in V1 |
|---|---|---|---|
| **Yardi** | System of record for units, residents, leases, and the annual **budget** | Continuous (internal to Yardi) | Not connected in V1. Its output reaches V1 only indirectly, via the Weekly Summary export. |
| **AIRM** | Revenue-management engine (successor to the retired "LRO" system) | Continuous, syncs to Yardi (currently unreliable per this week's thread) | Not connected in V1. Its recommended rents reach V1 only via the Pricing tables already present in the workbooks. |
| **Weekly Summary workbook** | A **hybrid document** — part system-generated, part manual entry — created fresh each week in Google Drive (`River Run Weekly Summary {YYYY.MM.DD}.xlsx`). Conceptually, every quantitative metric in it originates from Yardi; the manual work exists only because not every data point has a direct integration yet. It is an **intermediate operational workbook, not the long-term system of record**. | Weekly | Primary V1 ingestion source, because it accurately reflects the current workflow — but consumed through an adapter boundary (Section 2a) so it can be replaced, metric by metric, by a direct Yardi source later without touching anything downstream. |
| **Trend-Occ Comparisons workbook** | **One continuously-updated file** in Google Drive, 2012–present | Updated weekly, in place | Ingestion source for historical trend/budget/forecast data. Also a **required write target** — V1 must append this week's row, not just read it. |
| **Portfolio Market Survey** | A **separate, shared** Google Sheet, one tab per portfolio property plus a cross-property "4 bed compare" tab | Updated Monday mornings, by an admin who is not Jessica | Ingestion source for competitive data. Read-only from this system's perspective; owned and timed by someone else's process. |
| **Monday Narrative** | Today, a manually-composed email | Weekly | Not a source — a generated **output** in V1 (first draft only, reviewed/edited/approved by Jessica before send). |

---

## 2a. Design Principle — Source-Agnostic Metric Ingestion

Every metric in the data model conceptually originates from Yardi, even though V1 reads it out of the Weekly Summary workbook rather than Yardi itself. That gap is a workflow limitation today, not a permanent design decision — so the architecture draws a hard boundary at the **adapter layer**:

- **Left of the boundary** (source-specific, expected to change): today, a single **Weekly-Summary Adapter** that knows how to parse the workbook's sheets. Later, this can be replaced — one metric group at a time — by a **Yardi Adapter** calling Yardi Connect/API directly, or a **Yardi + Weekly-Summary hybrid** during a transition period where some metrics come from Yardi and others still come from the workbook.
- **Right of the boundary** (source-agnostic, must not change when an adapter changes): validation, normalization into the canonical entities, load, derivation, and all three outputs.

Every adapter — regardless of source — must emit the same canonical shape (the entities from the PRD's data model: Unit, Leasing Transaction, Exposure Record, Renewal Pipeline Record, Rent-by-Floorplan-by-Week, Traffic/Lead, Competitive Property). As long as an adapter honors that contract, the dashboard, the Trend write-back, and the Narrative generator never need to know or care whether a given metric came from a spreadsheet or from Yardi directly. This is what makes "swap the source without touching the reporting logic" an actual architectural property instead of an aspiration.

**Practical effect on the long-term goal:** once a Yardi Adapter exists and is trusted, the Weekly-Summary Adapter can be *inverted* — instead of parsing the workbook, LabOS generates it, using the exact same canonical entities it already holds. The Weekly Summary moves from being an input to being an output, without any change to the entities, the dashboard, or the narrative generator — only the adapter at that one boundary flips direction.

---

## 2b. Long-Term Target Architecture

```
 ┌────────────────────────┐
 │  Yardi (Yardi Connect/  │   System of Record
 │  API, once available)   │   (units, residents, leases, budget)
 └───────────┬─────────────┘
             │  Yardi Adapter
             ▼
 ┌─────────────────────────────────────────────┐
 │              LabOS                            │   Operational Intelligence Layer
 │  (canonical entities, derivation, judgment-    │
 │   assisted narrative reasoning)                │
 └───────────┬─────────────┬─────────────┬───────┘
             ▼              ▼              ▼
      Dashboard      Google Sheets    Monday Narrative
     (read model)   (generated, not   (first draft, human-
                       parsed)          approved before send)
```

Google Sheets flips from source to output here — including, eventually, the Weekly Summary itself. This is the direction V1 is built toward, not something V1 builds.

---

## 2c. Google Drive Access Architecture

Verified directly against the connected Google Drive integration available in this environment, rather than assumed — its actual tool surface is:

- `search_files` — structured query by title/full-text/modifiedTime/parentId (e.g. `title contains 'River Run Weekly Summary' and modifiedTime > '...'`, or scoped to the shared folder's `parentId`). This is exactly what "locate the correct River Run reporting files" and "identify the current reporting week" need.
- `read_file_content` / `download_file_content` — reads Sheets, PDFs, and Word/Office documents alike (PDF is explicitly supported). Covers every read requirement, including "read PDFs and other supporting documents."
- `get_file_metadata`, `list_recent_files`, `get_file_permissions` — last-modified timestamps and folder listing, needed for the audit trail and staleness checks.
- `create_file`, `copy_file` — can create a brand-new file or a copy of one.

**What it cannot do: edit an existing file in place.** There is no cell-level update or row-append operation — nothing equivalent to the Google Sheets API's `values.append`/`batchUpdate`. That's a hard gap against a stated requirement ("write updates back to the appropriate Google Sheets/workbooks," specifically appending this week's row to the *same*, continuously-updated Trend workbook, not creating a new file each time).

Per your own stated rule — prefer the connector, only add OAuth/service-account architecture where the connector can't reliably do the job — this is exactly that case, and only for that case:

- **Reads (discovery, file location, reporting-week identification, workbook/PDF content):** the connected Drive integration, as-is. No additional credentials.
- **Writes (appending to the Trend workbook; eventually generating the Weekly Summary as an output):** a narrowly-scoped Google Sheets API write credential (a service account or OAuth app granted edit access to specifically the Trend workbook and, later, the Weekly Summary's destination folder — not broad Drive access). This is the smallest possible addition that fills the one gap the connector has, rather than replacing the connector wholesale.

This keeps the "prefer the connector" principle honest — it's not a fallback because building a full custom integration seemed easier, it's a fallback because the connector was actually tested and found to lack one specific, necessary capability.

---

## 2d. Database Architecture

Same Supabase project as the Transition Command Center, under a dedicated schema (e.g. `labos`, distinct from the Transition Center's `public` schema) with its own tables, naming conventions, and RLS policies. I don't see a compelling reason to isolate into a separate project:

- **Shared identity, for free.** `profiles` and `is_platform_admin` already exist and are already correctly RLS-gated (Admin module, migration 0023). LabOS reuses that instead of building a second auth system — directly consistent with "one operating system, multiple modules," not two applications that happen to share a login page.
- **Schema-level isolation is real isolation.** A dedicated Postgres schema with its own `GRANT`s and RLS policies is a genuine security boundary, not a cosmetic one — it doesn't require a separate project to prevent LabOS tables from being queryable by roles that shouldn't see them.
- **Operational simplicity.** One connection string, one set of migrations history, one place to look during an incident — meaningful given this is still a small team running its own infrastructure.

A separate project would only earn its cost if LabOS needed independent scaling/billing from the Transition Center, a different data-residency requirement, or a hard blast-radius wall (e.g. a compliance boundary) — none of which apply here. If any of those ever become true, splitting later is a migration, not a blocker to starting unified now.

---

## 3. Pipeline (Version 1)

```
 ┌─────────────────────┐   ┌──────────────────────┐   ┌───────────────────────┐
 │ Weekly Summary       │   │ Trend-Occ Comparisons│   │ Portfolio Market Survey│
 │ (hybrid, new file/wk)│   │ (one running file)   │   │ (shared, admin-owned)  │
 └──────────┬───────────┘   └──────────┬───────────┘   └───────────┬───────────┘
            │                          │                            │
            ▼                          ▼                            ▼
 ┌────────────────────────────────────────────────────────────────────────────┐
 │ 1. Discovery (via connected Drive integration, read-only) — search the      │
 │    shared folder for this week's Weekly Summary by name/date pattern;      │
 │    confirm the Trend workbook + Portfolio Survey by fixed file ID; record   │
 │    each file's last-modified timestamp for the Sync Run audit trail         │
 ├────────────────────────────────────────────────────────────────────────────┤
 │ 2. Adapter (source-specific) — Weekly-Summary Adapter parses each known    │
 │    sheet into the canonical entity shape (schema-per-sheet, from the PRD's  │
 │    Section 1 reverse-engineering). This is the ONLY stage a future Yardi   │
 │    Adapter would replace.                                                   │
 ├────────────────────────────────────────────────────────────────────────────┤
 │ 3. Validation (source-agnostic) — shape/row-count sanity checks; flag      │
 │    structural drift (these are hand-maintained files today — a moved       │
 │    column should not fail silently)                                        │
 ├────────────────────────────────────────────────────────────────────────────┤
 │ 4. Normalization (source-agnostic) — map canonical rows onto the unified   │
 │    data model (Renewal codes → enum, Rent source → Actual/Budget/           │
 │    AIRM-Recommended/Prior-Year, Exposure → unrented + move-out ≤ 30 days)   │
 ├────────────────────────────────────────────────────────────────────────────┤
 │ 5. Load (source-agnostic) — upsert into LabOS's own database. This becomes │
 │    the real source of truth going forward, even though it originates from  │
 │    spreadsheets today                                                       │
 ├────────────────────────────────────────────────────────────────────────────┤
 │ 6. Derive (source-agnostic) — compute Weekly KPI Snapshot (3-yr rolling    │
 │    avg, occupancy vs. budget, exposure count) from the loaded entities —   │
 │    and flag any disagreement with the hand-typed numbers already in the    │
 │    source files as a QA signal, not a silent overwrite                     │
 └──────────────────────────────────┬───────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
 ┌────────────────────┐  ┌────────────────────┐  ┌─────────────────────────┐
 │ Property Dashboard  │  │ Trend workbook      │  │ Monday Narrative draft   │
 │ read model          │  │ write-back           │  │ (Reasoning Record →      │
 │ (served from DB)    │  │ (append this week's  │  │  driver-tagged, tone-    │
 │                      │  │  row via scoped      │  │  matched first draft;    │
 │                      │  │  Sheets-API write     │  │  Jessica edits/approves  │
 │                      │  │  credential, 2012+    │  │  before send)            │
 │                      │  │  history untouched)  │  │                          │
 └────────────────────┘  └────────────────────┘  └─────────────────────────┘
```

Steps 3–6 and all three outputs are identical in the long-term architecture — only step 2's adapter changes. That's the whole point of the boundary.

---

## 3a. Sync Run — Trigger Model (Version 1)

**Manual "Sync Now" only, by design.** Not a placeholder for automation done later — the manual step is load-bearing: because the Portfolio Survey and Weekly Summary become ready at different, human-controlled times, only Jessica knows when every required input has actually landed. A schedule would just be a guess at that timing.

**A Sync Run is a first-class, auditable record — not a fire-and-forget action.** Every invocation creates one, tied to a specific reporting week, and must surface, before anything is committed:

- **Files discovered** — which file satisfied each source (Weekly Summary, Trend workbook, Portfolio Survey), with its Drive file ID.
- **Reporting week identified** — the date this run is for, derived from the discovered Weekly Summary's filename/date.
- **Last-modified timestamps** — per discovered file, so staleness is visible, not assumed.
- **Validation status** — pass/fail per source, from pipeline step 3.
- **Missing or stale inputs** — called out explicitly (e.g. "Portfolio Survey last modified 6 days ago — likely not yet updated for this week") rather than silently proceeding.
- **Metrics successfully processed** — a count/summary per entity type (leases, move-ins, exposure records, etc.), so a partial failure is visible at a glance.
- **Outputs generated** — dashboard data refreshed / Trend row appended / Narrative draft produced, each with its own success/fail state, since one output failing shouldn't hide that the other two succeeded.

**No silent overwrite.** If a reporting package already exists for that week (e.g. a re-run), the sync must show what would change and require confirmation before replacing it — never blindly overwrite an existing week's data or a Trend workbook row.

**Every Sync Run is retained as audit history**, keyed by reporting week — what was read, what was validated, what was written, what was generated, when, and by whom.

**Future scheduling is additive, not a redesign.** Because the pipeline itself (Sections 2a/3) doesn't know or care what invoked it, a future scheduled trigger is just a second caller of the same Sync Run — it doesn't change discovery, validation, normalization, load, derivation, or the outputs. V1 ships only the manual trigger; the architecture doesn't block adding a schedule later.

**Data model addition — Sync Run record:**
- Reporting week, triggered-by (user), triggered-at (timestamp)
- Per-source: file ID, last-modified timestamp, validation status
- Missing/stale input flags
- Per-entity-type processed counts
- Per-output generation status (dashboard / Trend write-back / narrative draft)
- Overwrite decision (if re-run against an existing week), and who approved it

---

## 4. Timing & Sequencing

Two real-world dependencies, not just technical ones:

- **Portfolio Survey** is updated by someone else, Monday mornings. Ingestion of the competitive-data step cannot run at midnight — it needs to either wait for a signal (e.g. the admin's edit) or simply run later in the morning, after their update is expected to be done. Running too early means stale competitor pricing silently flows into that week's dashboard/narrative.
- **Weekly Summary** is a new file, not a fixed one — discovery has to search the Drive folder for this week's filename pattern rather than assume a static file ID. If the admin is late, or names it inconsistently, discovery needs to fail loudly (missing file) rather than silently reuse last week's.

---

## 5. Open Design Questions — All Resolved

1. ~~How does the Weekly Summary workbook itself get produced today?~~ **Resolved.** Hybrid — part system-generated, part manual, conceptually 100% Yardi-sourced. Handled via the adapter boundary in Section 2a.
2. ~~Google Drive/Sheets API access.~~ **Resolved.** Connected Drive integration for all reads (verified capable — search, read, download, metadata, PDFs included); a narrowly-scoped Sheets-API write credential only for the one gap the connector doesn't cover (in-place append to the Trend workbook). Section 2c.
3. ~~Where does LabOS's own database live?~~ **Resolved.** Same Supabase project as the Transition Command Center, dedicated `labos` schema, own tables/RLS, shared identity via existing `profiles`/`is_platform_admin`. Section 2d.
4. ~~Trigger model.~~ **Resolved.** Manual "Sync Now" for V1, modeled as a first-class auditable Sync Run record tied to a reporting week; no silent overwrites; scheduling is a future additive trigger, not a redesign. Section 3a.

This is still a design document, not a build plan — but there are no more open architectural questions blocking one. Next step is your call: review this as a whole, or move to scoping the actual build (schema migrations, the Weekly-Summary Adapter, the Sync Now UI).

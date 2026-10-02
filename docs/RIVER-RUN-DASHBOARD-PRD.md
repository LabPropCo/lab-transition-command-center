# River Run Property Dashboard & Monday Reporting Engine — Product Requirements Document

**Status:** Phase 1 — understanding the existing process. No implementation, no redesign.
**Source documents reviewed:**
- `RR Weekly.pdf` — the 07.19.26 weekly report email thread (snapshot summary, narrative, competitive survey, pricing tables, Lab Analytics, plus the week's follow-up execution emails)
- `River Run Weekly Summary 2026.07.19.xlsx` — the raw Yardi-sourced workbook behind the report (SUMMARY, Unit Availability Details, Traffic Detail, Inventory)
- `River Run Trend-Occ Comparisons 2026.xlsx` — the multi-year trend workbook (Raw, Leasing, Occupancy, Turnover, Occ forecast, Cancels, TCP Rent Roll Comparison, Occ Trend to Budget (Wk), LRO Rent Roll Comparison)

**A note on the source data:** the Weekly Summary workbook's resident-level sheets (New Rentals, Move-Ins, Notice, Unit Availability Details, Traffic Detail) contain real resident and prospect names, resident IDs, and — in the Notice section specifically — free-text reasons that included sensitive personal circumstances (health, legal, financial). None of that is reproduced anywhere below. Every section that touches resident-level data describes it as a field type and structure only. This is called out explicitly in Unknowns/Governance below because it's a real decision the eventual system needs, not something I've decided for you.

---

## 0. Product Philosophy (context, not new — restated for grounding)

One source of truth. Three outputs:
- **Google Sheets** — stays, because it holds years of trusted history (the Trend workbook alone goes back to 2012).
- **Property Dashboard** — the "what should I do" view, reviewed continuously.
- **Monday Narrative** — the "what happened and why" writeup, sent to the team.

Phase 1 is not about replacing any of these. It's about fully understanding the process well enough that all three could, eventually, be generated from one model. **We are reverse-engineering, not redesigning.**

---

## 1. What Information Is Reported Every Week

Reading the PDF and both workbooks together, the weekly process actually produces information in four layers: a rolled-up snapshot, a written interpretation of that snapshot, a competitive/pricing layer, and an analytics/forecast layer. Every recurring element below appears **every week** in either the email or its two attachments.

### 1.1 Snapshot Summary (email body, top)
A fixed bullet list, each with a historical comparator:
- Leases (count, vs. 3-year average)
- Move-ins (count)
- Move-outs (count)
- Notices (count)
- Renewals (count)
- Cancels/Denials (count)
- Walk-ins (count, vs. 3-year average)
- Current Exposure (count, vs. 3-year average, vs. same week last year, vs. last week — i.e. four comparators on one number)
- Weekly Occupancy Rate (vs. 3-year average, vs. Budget)

### 1.2 Narrative (email body, free text)
Not a data section — a written interpretation, but it consistently covers the same topics in the same order every week:
- Traffic/leasing pace this week vs. last week, and what's scheduled next week
- Occupancy momentum (move-ins vs. move-outs, and what's already scheduled)
- Near-term exposure change (denials + notices due in the next 30 days, and whether any are already backfilled)
- A month-end **projection**: units occupied and % if only already-scheduled activity happens, then a second, more conservative projection including known upcoming move-outs, then the gap ("we will need to secure N additional move-ins")
- Submarket commentary: where prospect traffic is weighted (move-in timing), which competitors moved rate/concessions and why, and the net effect on the competitive set's total exposure
- The subject property's own current starting rents by floorplan
- A recommended or already-implemented pricing action, with explicit rationale tied to a specific competitor's concession
- A one-line renewal-pipeline status (what the team is working this week, not a number)
- A one-line staffing/team-capacity status (this week: a new hire starting, property now fully staffed)

### 1.3 Lab Analytics (email body, structured under the narrative)
- **Forecast:** anticipated cancellations/denials (count), anticipated notices (count, with reason categories), leases needed to hit goal (count)
- **Renewals:** for each of the next three expiring months, a breakdown of renewal decisions into a small coded taxonomy (see Unknowns — the exact meaning of each code is not documented anywhere in the source) plus an overall % renewed

### 1.4 Portfolio Market Survey (table)
Dated snapshot of the competitive set: starting rent by unit type (Studio/1x1/2x2/3x2) for each named competitor property, a free-text Specials column, a computed row-average, and week-over-week $ and % change per unit type.

### 1.5 Pricing (tables)
- **Week-to-week Mid Term Rate**: the subject property's own asking rent by floorplan code (1 Bed, 1 Bed R, 2 Bed, 2 Bed R, Loft, Loft R, 3 Bed, 3 Bed R — "R" denotes the river-view/premium variant of each floorplan), current week vs. prior week, plus a Total Market Rent roll-up and its variance.
- **LT (long-term) Rate — current year**: the same floorplan breakdown, current asking rate.
- **LT Rate — prior year**: the same breakdown, one year prior.
- **LT year-over-year variance**: current minus prior, by floorplan, plus the Total Market Rent delta.

### 1.6 The week's execution thread (follow-up emails, same subject line)
Not a formal report section, but a recurring pattern every week: colleagues acknowledge the report, then a sequence of emails works through *implementing* the pricing recommendation — specific unit-by-unit rent changes, confirmation of which discounted units leased before the change could even be applied, a live availability table (Unit / Beds / Rent / Date Available / Sqft / Amenities), and — this week specifically — a note that the revenue-management system (Yardi + "AIRM") isn't syncing correctly, so pricing is being pushed manually with a support ticket open.

### 1.7 Underlying raw data (the two workbooks — feeds sections 1.1–1.5, not shown directly in the email)
- **SUMMARY sheet**: line-item detail behind every Snapshot Summary count — New Rentals, Move-Ins, Move-Outs, Notice, Renewals, Cancels/Denial — each a small table (unit, floorplan type, rent, relevant dates, reason where applicable, resident reference, lease term).
- **Unit Availability Details sheet**: the literal source of the "Current Exposure" number — every currently-vacant-or-about-to-vacate unit, grouped into status categories (e.g. notice-unrented, notice-rented, applicant, future, vacant not-ready), each group subtotaled, with a grand total for the property.
- **Traffic Detail sheet**: the full prospect log behind the Walk-ins/leasing-pace narrative — one row per prospect, first-contact date, source channel, and funnel-stage flags (call/email/tour/lease).
- **Inventory sheet**: a static reference table mapping every unit number to its floorplan type code, bed count, and river/off-river designation — this is what lets every other sheet refer to units by a short type code instead of repeating bed count and view every time.
- **Trend workbook — Raw/Leasing/Occupancy/Turnover/Cancels sheets**: the same weekly metrics (leases, occupancy %, notices, cancels), but as a multi-year time series — one column per year back to 2012 for some metrics — used to compute the "3-year average" comparators seen in the Snapshot Summary.
- **Trend workbook — Occ forecast sheet**: the current year's actual weekly occupancy vs. four independently-computed forecast models, repeated as a block per historical year (effectively a backtest of forecasting approaches).
- **Trend workbook — Occ Trend to Budget (Wk) sheet**: a rolling two-month snapshot, updated weekly — budgeted occupancy %, current forecasted occupancy %, and additional move-ins needed — this is the direct source of the narrative's month-end projection paragraph.
- **Trend workbook — TCP Rent Roll Comparison sheet**: weekly Total Market Rent — Budget vs. Actual vs. prior-year actual vs. variance — the revenue side of the same budget-tracking exercise.
- **Trend workbook — LRO Rent Roll Comparison sheet**: the revenue-management engine's own recommended rent by floorplan, week by week, going back multiple years — structurally identical to the Pricing tables in the email, but this is the system's *recommendation*, not necessarily what was actually charged.

---

## 2. Why Each Section Exists — the Operational Question

| Section | Operational question it answers |
|---|---|
| Snapshot Summary counts (leases, move-ins, move-outs, notices, renewals, cancels, walk-ins) | **Is this a normal week, or not?** — every count is judged against a 3-year average, not in isolation. |
| Current Exposure | **Are we creating or reducing leasing risk?** (the user's own example — confirmed exactly by the data: it's a forward-looking count of units at risk of sitting vacant, not a backward-looking count of what already happened) |
| Weekly Occupancy Rate (vs. budget, vs. 3-yr avg) | **Are we on pace?** (the user's own example) — against two different bars at once: our own history, and what we committed to ownership. |
| Narrative — traffic/leasing pace | **Is interest converting into signed leases fast enough?** |
| Narrative — occupancy momentum & scheduled activity | **Where will we actually land, given what's already scheduled — not just where we are today?** |
| Narrative — 30-day exposure change | Same question as Current Exposure, but explicitly forward-looking and reason-coded (denials, notices) rather than a single number. |
| Narrative — month-end projection & gap-to-goal | **What do we need to do, right now, to hit this month's number?** — this is the paragraph that turns a lagging metric into an action item. |
| Competitive Leasing Activity | **What is the competition actually doing, and does it change what we should charge or how urgently we should lease?** |
| Overall competitive exposure trend | **Is the whole submarket tightening or loosening, independent of anything we're doing?** |
| Current Pricing (subject property) | **What are we actually charging, right now, by unit type?** — a simple fact, but one that changes multiple times a week and needs to be visible before any pricing decision. |
| Recommended/implemented rate action | **Are we positioned to win this week's available demand, or will we lose it on price?** |
| Renewal-pipeline status (narrative line) | **Is future occupancy protected?** (the user's own example) |
| Staffing/team-capacity note | **Do we have the people in place to execute the plan?** — a distinct risk from anything leasing-metric-based. |
| Lab Analytics — Forecast (anticipated cancels/notices, leases needed) | **What do we already know is coming, and how big is the resulting gap?** |
| Lab Analytics — Renewals by month | **Of everything expiring soon, how much is secured, how much is lost, and how much is still unknown?** — a finer-grained, decision-coded version of "is future occupancy protected." |
| Portfolio Market Survey | **How do we compare to the specific properties our prospects are actually choosing between?** |
| Pricing — week-to-week variance | **How much did our own asking rent move this week, and in which direction?** |
| Pricing — LT year-over-year | **Are we growing rent or giving it back, on a year-over-year basis?** — the revenue scorecard underneath all the weekly noise. |
| Unit Availability Details (underlying) | **Exactly which units are the risk, why, and how urgent is each one?** — the operational punch-list behind the single Exposure number. |
| Traffic Detail (underlying) | **Where is traffic actually coming from, and is anything going stale in the pipeline?** — the working list behind the Walk-ins number. |
| Multi-year trend sheets (Leasing/Occupancy/Turnover/Cancels) | **Is this week normal for this time of year** — i.e., is a dip in March meaningfully different from the same dip every March? |
| Occ forecast (multi-model backtest) | **Which forecasting approach has actually been accurate, so which one should we trust this week?** |
| Occ Trend to Budget (Wk) | **Are we tracking to what we told ownership, updated continuously as the month unfolds?** |
| TCP Rent Roll Comparison | Same budget-tracking question, on the revenue side rather than the occupancy side. |
| LRO Rent Roll Comparison | **What does the revenue-management system recommend, and how does that compare to what we're actually charging?** — directly relevant this week, since the system feeding this comparison is mid-sync-outage. |

---

## 3. Dashboard Architecture

Organized the way the report is actually *read*, top to bottom, not by data source or software convention. The narrative itself already reads in this order — pulse, then trajectory, then risk detail, then competitive context, then pricing, then protection, then capacity, then history — so the dashboard mirrors that review flow rather than inventing a new one.

**1. Where do we stand (Pulse)**
The Snapshot Summary, always visible, first: leases, move-ins, move-outs, notices, renewals, cancels/denials, walk-ins, current exposure, occupancy — each shown against its 3-year-average and budget comparators, not as a bare number.

**2. Where are we headed (Trajectory)**
The forward-looking layer: projected month-end occupied units/%, additional move-ins needed to hit goal, what's already scheduled to move in/out. This is deliberately separate from Pulse — Pulse is "what happened," Trajectory is "what happens next if nothing changes."

**3. What's putting us at risk (Exposure Detail)**
The unit-level punch list behind the single Exposure number — which units, which status category, how many days vacant, whether a make-ready or move-in date is already set. This is a drill-down from Trajectory, not a top-level tile — you only need it when the Exposure number itself looks wrong or worrying.

**4. Is the market moving (Competitive Position)**
The Portfolio Market Survey table and the overall competitive-exposure trend. Answers "is this a market problem or an us problem" before any pricing decision gets made.

**5. What are we charging, and should we change it (Pricing)**
Current asking rent by floorplan, week-over-week variance, year-over-year variance, and — once the Yardi/AIRM sync is reliable — the revenue-management system's recommendation alongside what's actually being charged, so a gap between "recommended" and "actual" is visible rather than discovered by a manual spot-check.

**6. Is future occupancy protected (Renewals)**
The renewal pipeline by expiring month, with whatever the renewal-decision taxonomy resolves to (see Unknowns), and % renewed. Kept separate from Trajectory because it answers a different-horizon question — not "this month," but "the next several months."

**7. Can we execute (Team & Operations)**
Staffing/capacity status. Small and infrequent in the source data, but real — a plan is only as good as the team's ability to run it.

**8. Is this normal (Historical Context)**
The multi-year seasonality view and forecast-model accuracy — a reference/drill-down layer, not something that needs to be on-screen every week, but essential for judging whether any of the above numbers are actually surprising.

This ordering is a direct translation of the narrative's own structure — nothing here is invented; it's the same operational sequence Jessica already reads in, made navigable instead of linear.

---

## 4. Data Model

Every unique data element found across both workbooks and the PDF, deduplicated and grouped by what it actually represents rather than by which sheet it happened to live in. Several concepts (occupancy %, rent-by-floorplan, exposure) appear in three or four different sheets in the source material; each is modeled once below, with a "source/type" dimension instead of being duplicated per sheet.

**Property**
- Name, market, total unit count, budgeted occupancy % (by week/month), budgeted Total Market Rent (by week)

**Unit**
- Unit number, floorplan type code, bed count, river/off-river designation, square footage, description (from Inventory)

**Floorplan / Unit Type**
- Type code (e.g. 1 Bed, 1 Bed R, 2 Bed, 2 Bed R, Loft, Loft R, 3 Bed, 3 Bed R), bed count, reference sqft

**Rent-by-Floorplan-by-Week** *(one fact table, not five duplicated tables)*
- Floorplan, week, rent amount, **source** (Actual / Budget / LRO-Recommended / Prior-Year-Actual) — this single structure covers the email's Mid Term Rate table, the LT current/prior/variance tables, TCP Rent Roll Comparison, and LRO Rent Roll Comparison, which are today four-plus separately maintained tables describing the same underlying concept.

**Leasing Transaction** *(one event log, typed by event)*
- Event type (new lease / move-in / move-out / notice / renewal / cancel-denial), unit, resident reference (opaque ID — see Governance below), rent, relevant date(s) (effective, expiration, move date), reason (free text, move-out/notice/cancel only), lease term (ST/LT), specials/concession applied

**Resident** *(minimal, lease-relevant fields only)*
- Opaque ID, current unit, current rent, deposit — deliberately not modeling narrative/circumstance text as a queryable field (see Governance)

**Renewal Pipeline Record**
- Unit, expiring month, decision code (taxonomy TBD — see Unknowns), prior rent, new/offered rent, offer-sent date

**Traffic / Lead**
- Prospect reference, first-contact date, source channel, funnel-stage flags (call/email/tour/lease), last-activity note

**Exposure Record** *(the detail behind the single "Current Exposure" number)*
- Unit, status category (notice-unrented / notice-rented / vacant-unrented / vacant-rented / applicant / future / hold, ready or not-ready), days vacant, make-ready date, move-in date, notice date, move-out date

**Competitive Property**
- Name, market, survey date, rent by unit type (Studio/1x1/2x2/3x2), specials/concessions (free text)

**Weekly KPI Snapshot** *(derived/materialized, not separately entered)*
- Date, leases, move-ins, move-outs, notices, renewals, cancels/denials, walk-ins, current exposure (= sum of Exposure Records), occupancy % actual, occupancy % budget, occupancy % 3-yr-average — should be computed from the tables above, not hand-maintained, since today's Snapshot Summary and Lab Analytics numbers appear to be re-entered by hand in more than one place (see Unknowns/Version 2).

**Occupancy Forecast Record**
- Date, forecast model ID, forecasted occupancy %, actual occupancy % (once known) — supports the multi-model backtest seen in Occ forecast.

**Narrative / Commentary**
- Free-text weekly writeup, tied to a report date. Currently 100% human-authored judgment layered on top of the numbers above — not derivable from the data model alone (see Unknowns — how much of this could eventually be templated is an open question, not a Phase 1 decision).

---

## 5. Unknowns — Questions I Cannot Answer From the Supplied Documents

1. **Renewal decision codes**: the narrative's Renewals stat line (`July: r's:1, R's:2, n's:0, N's:8, Unknowns:3`) uses a lowercase/uppercase r/R/n/N/Unknown taxonomy that's never defined in either workbook or the email. What does each code mean?
2. **AIRM**: what specifically is this system — a Yardi-native revenue-management module, or a separate third-party product? What's its intended relationship to the LRO Rent Roll Comparison sheet — are they the same engine, or two different/legacy systems?
3. **LRO**: what does this stand for, and is it the same system as AIRM under a different name, or genuinely separate?
4. **Portfolio Market Survey source**: where does the competitor pricing table actually get collected/maintained, by whom, and how often — is it specific to River Run's report, or a shared portfolio-wide document that also feeds other properties' weekly reports?
5. **3-year average definition**: is the "3-year avg" comparator in the Snapshot Summary computed live from the Trend workbook's history, and if so, which exact three years, recalculated how often (rolling vs. fixed)?
6. **Budget source of truth**: where do the annual Budget numbers (occupancy %, Total Market Rent) actually originate and get revised — is the Trend workbook the master, or does it get imported from somewhere else?
7. **Narrative authorship**: how much of the weekly Narrative is mechanical restatement of the numbers vs. genuine judgment calls that only a person could make? This directly determines how much of the eventual Monday Narrative generator can be templated vs. must stay human-written.
8. **Exact definition of "Current Exposure"**: does it equal the sum of every group in Unit Availability Details, or is there a different official definition used when reporting to ownership at month-end?
9. **Relationship to "the Google Sheets"**: are the two workbooks supplied here *the* Google Sheets referenced in the Product Philosophy, or are there additional historical trackers not included in what was provided?
10. **Historical depth needed**: the Trend workbook's Leasing/Occupancy/Turnover/Cancels sheets go back to 2012. Does the future data model need to ingest/preserve all of that, or only a rolling window (e.g. last 3–5 years)?
11. **Audience for each output**: is the Monday Narrative sent only to the internal distribution seen in the email thread, or also directly to owners/investors? This matters for tone and for what level of operational/resident detail is appropriate in an eventual generated draft.
12. **Two renewal views**: the narrative's inline Renewals stat block and the later Lab Analytics Renewals block both report renewal status by month — are these the same underlying data shown twice, or two different cuts that are expected to reconcile (and do they, today)?

**Governance decision needed (not a question I can guess at):** the Notice section's "Reason" field currently contains free-text personal circumstances (health, legal, financial) tied to specific residents. Before any dashboard or narrative-generation system touches this field, there needs to be an explicit decision on how it's captured, who can see it, and whether it's redacted/summarized for anything beyond the immediate onsite team.

---

## Version 2 Opportunities (not part of Version 1 — captured for later)

- Auto-derive "Current Exposure" from the Exposure Record detail instead of maintaining it as a separately hand-typed number in the Snapshot Summary.
- Standardize the renewal-decision taxonomy (today's r/R/n/N/Unknown codes) into named, self-documenting statuses.
- Reconcile the two renewal views (inline narrative stat block vs. Lab Analytics block) into one source so they can't silently drift apart.
- A live sync-status indicator between Yardi and the revenue-management engine, instead of discovering desync via a manual spot-check and a support ticket.
- Centralize the Portfolio Market Survey as one shared, dated, portfolio-wide dataset rather than a table re-pasted into each property's individual weekly email — makes the survey itself trendable over time, the way occupancy already is.
- Structured, access-controlled handling of sensitive notice/skip/eviction narrative text — a sanitized roll-up for broad distribution, full detail restricted to those who need it operationally.
- Surface forecast-model accuracy automatically (the Occ forecast sheet already backtests four models by hand) and weight the narrative's month-end projection off whichever model has actually been most accurate recently.
- One-click first-draft generation of the Monday Narrative from the same numbers already computed for the dashboard — the eventual direction stated by the user, explicitly deferred until Version 1 understanding is complete and approved.

---

## Next Step

This document is understanding, not design. Per your instruction, nothing here should be treated as an implementation plan until you've reviewed it — particularly the Unknowns section, which has real open questions (renewal-code taxonomy, AIRM/LRO identity, survey provenance, narrative-authorship split) that materially affect what Version 1 can actually automate versus what stays human-authored for now.

// Canonical shapes for the LabOS ingestion pipeline. Every SourceAdapter
// (Weekly-Summary today, Yardi later) must emit exactly this shape — nothing
// downstream (validation, normalization, load) may depend on which adapter
// produced it. Field names mirror the labos.* migrations (0024-0030) 1:1.

export type LeasingEventType =
  | "new_rental" | "move_in" | "move_out" | "notice" | "renewal" | "cancel_denial";

// resident_ref is intentionally absent from the canonical shape in Milestone 1
// (governance decision still deferred — see docs/RIVER-RUN-MILESTONE-1-BUILD-PLAN.md).
// It is never populated by the adapter, so it isn't given a field to populate.

// Confirmed business rule: a NEW RENTALS row with a non-numeric Line value
// ("-", blank) is real source data, but does not represent an official
// numbered lease for the week — it's a supplemental record (a voided deal
// still worth auditing, or a waitlist entry not tied to a physical unit).
// Scoped to new_rental only — every other event type's Line values were
// purely sequential in the real workbook, so this ambiguity doesn't apply
// there; the field still exists on every transaction for schema uniformity,
// defaulting to "counted."
export type NewRentalExclusionReason = "waitlist_placeholder" | "cancelled_or_denied" | "other_unnumbered";

export interface CanonicalLeasingTransaction {
  eventType: LeasingEventType;
  unitNumber: string;
  rent: number | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  moveDate: string | null;
  priorRent: number | null;
  leaseTerm: "ST" | "LT" | null;
  hasReason: boolean;
  sheetLineRef: string;
  lineLabel: string;                              // the raw Line column text ("1", "-", "7", ...) — preserved for audit
  isOfficialKpi: boolean;                          // false only for non-numeric-Line new_rental rows
  exclusionReason: NewRentalExclusionReason | null;
}

export type ExposureStatus =
  | "vacant_unrented" | "notice_unrented" | "notice_rented" | "applicant" | "future" | "hold";

// Applicant and Future both count as secured (excluded from exposure) — confirmed
// business rule. is_unrented is computed at normalization time from `status`, not
// carried as a separate adapter judgment call.
export interface CanonicalExposureRecord {
  unitNumber: string;
  status: ExposureStatus;
  isSkip: boolean;
  daysVacant: number | null;
  makeReadyDate: string | null;
  moveInDate: string | null;
  noticeDate: string | null;
  moveOutDate: string | null;
}

export interface CanonicalTrafficLead {
  firstContactDate: string;
  sourceChannel: string | null;
  called: boolean;
  emailed: boolean;
  toured: boolean;
  leased: boolean;
  sheetLineRef: string;
}

export type MemoryType =
  | "traffic_note" | "narrative" | "pricing_rationale" | "competitive_observation"
  | "manager_comment" | "decision_reasoning" | "market_condition";

// Operational Memory — the "why" alongside the structured "what". Milestone 1
// populates only traffic_note (Traffic Detail's Key Notes), sourceRef pointing
// back at the CanonicalTrafficLead.sheetLineRef it annotates. Content is stored
// verbatim; adapters must never summarize or otherwise modify it.
export interface CanonicalOperationalMemory {
  memoryType: MemoryType;
  sourceRef: string | null;
  content: string;
}

// Matches labos.validation_severity exactly — some adapter-detected issues
// (a missing SUMMARY section, a Unit Availability Details total mismatch)
// are Blocking per the Validation Matrix, not merely advisory.
export type ValidationSeverity = "blocking" | "warning" | "info";

export interface ParseWarning {
  ruleCode: string;
  severity: ValidationSeverity;
  message: string;
  context?: Record<string, unknown>;   // structural refs only — never resident/prospect names
}

// Same shape as ParseWarning (mirrors labos.validation_results 1:1) — named
// separately because the validation stage's output is a distinct concept
// from the adapter's own parse-time warnings, even though they merge into
// one list (see validation/rules.ts).
export type ValidationResult = ParseWarning;

// Inventory reference rows — used at normalization time to resolve
// unit_number -> floorplan_id (labos.floorplans/labos.units), not stored as
// its own lineage-scoped entity the way leasing/exposure/traffic are.
export interface CanonicalInventoryRow {
  unitNumber: string;
  typeCode: string;
  bedCount: number;
  riverSide: boolean;
  description: string | null;
}

export interface CanonicalPayload {
  reportingWeek: string;               // ISO date, read from the workbook's own content — cross-checked (V2) against config.reportingPeriodEnd, never against the file name
  propertyName: string;                // read from the workbook's own content — cross-checked (V1) against config.propertyName
  leasingTransactions: CanonicalLeasingTransaction[];
  exposureRecords: CanonicalExposureRecord[];
  // The sheet's own stated "Grand Total Count" (e.g. "3 Units" -> 3), captured
  // so V6 can reconcile it against exposureRecords.length instead of just
  // trusting our own row-count silently. Null if the sheet had no such row.
  exposureGrandTotalCount: number | null;
  trafficLeads: CanonicalTrafficLead[];
  operationalMemory: CanonicalOperationalMemory[];
  inventoryRows: CanonicalInventoryRow[];
  parseWarnings: ParseWarning[];
}

export interface SourceFileHandle {
  fileName: string;
  lastModifiedAt: string;
  driveFileId: string | null;          // null via the Milestone-1 local-file provider
  bytes: ArrayBuffer;
}

export type SourceType = "weekly_summary" | "trend_workbook" | "portfolio_survey";

export interface SourceAdapter {
  readonly sourceType: SourceType;
  // config carries property/period identity explicitly — the adapter must
  // never embed or assume a specific property. See src/labos/config.ts.
  parse(file: SourceFileHandle, config: import("./config").IngestionConfig): Promise<CanonicalPayload>;
}

// Declared, not implemented, in Milestone 1 — see the ingestion architecture's
// adapter-boundary principle. The Sync Run's derive step does not call this yet.
export interface TrendWriteBackPort {
  appendWeeklyRow(snapshot: WeeklyKpiSnapshot): Promise<void>;
}

export interface WeeklyKpiSnapshot {
  reportingWeek: string;
  newRentalsCount: number;              // official — numbered Line rows only
  newRentalsExcludedCount: number;      // supplemental — non-numeric-Line rows, preserved for audit, never counted
  moveInsCount: number;
  moveOutsCount: number;
  noticesCount: number;
  renewalsCount: number;
  cancelsDenialsCount: number;
  walkInsCount: number;
  currentExposureCount: number;
}

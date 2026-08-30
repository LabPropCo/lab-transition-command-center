import type {
  CanonicalExposureRecord, CanonicalInventoryRow, CanonicalLeasingTransaction, CanonicalOperationalMemory,
  CanonicalPayload, CanonicalTrafficLead, WeeklyKpiSnapshot,
} from "./types";

// Pure, DB-free transformation: CanonicalPayload -> DB-ready rows. Kept
// separate from the repository (which knows how to resolve unit_number ->
// unit_id and actually write rows) so the business logic here — is_unrented
// derivation, KPI aggregation — is fully unit-testable without any mock, and
// stays identical whether the repository underneath is the in-memory mock
// or the real Supabase implementation.

export interface NormalizedBatch {
  reportingWeek: string;
  propertyName: string;
  leasingTransactions: CanonicalLeasingTransaction[];   // unchanged — already DB-shaped
  exposureRecords: (CanonicalExposureRecord & { isUnrented: boolean })[];
  trafficLeads: CanonicalTrafficLead[];                 // unchanged
  operationalMemory: CanonicalOperationalMemory[];       // unchanged
  inventoryRows: CanonicalInventoryRow[];                // unchanged — repository resolves unit/floorplan ids from this
  weeklyKpiSnapshot: WeeklyKpiSnapshot;
}

const UNRENTED_STATUSES = new Set(["vacant_unrented", "notice_unrented"]);

// Confirmed exposure rule: unrented AND (already vacant OR moving out within
// the next 30 days). A null move-out date means "already vacant now" (no
// departing resident to wait on), which always counts.
function withinExposureWindow(moveOutDate: string | null, reportingWeek: string): boolean {
  if (!moveOutDate) return true;
  const cutoff = new Date(`${reportingWeek}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() + 30);
  return new Date(`${moveOutDate}T00:00:00Z`) <= cutoff;
}

export function normalizePayload(payload: CanonicalPayload): NormalizedBatch {
  const exposureRecords = payload.exposureRecords.map((e) => ({
    ...e,
    isUnrented: UNRENTED_STATUSES.has(e.status) && withinExposureWindow(e.moveOutDate, payload.reportingWeek),
  }));

  const countEvents = (type: CanonicalLeasingTransaction["eventType"]) =>
    payload.leasingTransactions.filter((t) => t.eventType === type).length;

  // new_rentals_count is the OFFICIAL count — numbered Line rows only.
  // Non-numeric-Line rows (waitlist placeholders, voided deals) are real
  // data, preserved on leasingTransactions for audit, but never counted
  // here — confirmed business rule. No other event type has this ambiguity
  // in the real workbook, so every other count stays a plain total.
  const newRentalRows = payload.leasingTransactions.filter((t) => t.eventType === "new_rental");

  const weeklyKpiSnapshot: WeeklyKpiSnapshot = {
    reportingWeek: payload.reportingWeek,
    newRentalsCount: newRentalRows.filter((t) => t.isOfficialKpi).length,
    newRentalsExcludedCount: newRentalRows.filter((t) => !t.isOfficialKpi).length,
    moveInsCount: countEvents("move_in"),
    moveOutsCount: countEvents("move_out"),
    noticesCount: countEvents("notice"),
    renewalsCount: countEvents("renewal"),
    cancelsDenialsCount: countEvents("cancel_denial"),
    walkInsCount: payload.trafficLeads.length,
    currentExposureCount: exposureRecords.filter((e) => e.isUnrented).length,
  };

  return {
    reportingWeek: payload.reportingWeek,
    propertyName: payload.propertyName,
    leasingTransactions: payload.leasingTransactions,
    exposureRecords,
    trafficLeads: payload.trafficLeads,
    operationalMemory: payload.operationalMemory,
    inventoryRows: payload.inventoryRows,
    weeklyKpiSnapshot,
  };
}

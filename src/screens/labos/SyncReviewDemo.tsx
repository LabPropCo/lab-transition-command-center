import { useEffect, useState } from "react";
import type { CanonicalPayload, SourceAdapter, SourceFileHandle } from "../../labos/types";
import { MockLabosRepository } from "../../labos/repository.mock";
import { runSync } from "../../labos/syncRun";
import { getSyncRunDetail, type SyncRunDetail } from "../../labos/api";
import { SyncReview } from "./SyncReview";

// Demo harness only — runs the real ingestion pipeline (adapter -> validate
// -> normalize -> load) against a synthetic payload shaped like the actual
// 2026.07.26 workbook's real numbers (3 official new rentals, 3 excluded,
// 5 move-ins, 1 cancel/denial, etc. — see the build plan's Acceptance
// Criteria), entirely in-browser against the in-memory mock repository. No
// real resident/prospect data, no live Supabase connection — this proves
// the review screen renders real pipeline output correctly, not that a
// production data source is wired up (it isn't, per Milestone 1's scope).
function demoPayload(): CanonicalPayload {
  return {
    reportingWeek: "2026-07-26",
    propertyName: "River Run",
    leasingTransactions: [
      { eventType: "new_rental", unitNumber: "E304", rent: 3495, effectiveDate: null, expirationDate: "2027-10-20", moveDate: null, priorRent: null, leaseTerm: "LT", hasReason: false, sheetLineRef: "SUMMARY!NEW_RENTALS#1", lineLabel: "1", isOfficialKpi: true, exclusionReason: null },
      { eventType: "new_rental", unitNumber: "E105", rent: 2025, effectiveDate: null, expirationDate: "2027-11-21", moveDate: null, priorRent: null, leaseTerm: "LT", hasReason: false, sheetLineRef: "SUMMARY!NEW_RENTALS#2", lineLabel: "2", isOfficialKpi: true, exclusionReason: null },
      { eventType: "new_rental", unitNumber: "E103", rent: 2095, effectiveDate: null, expirationDate: "2027-11-13", moveDate: null, priorRent: null, leaseTerm: "LT", hasReason: false, sheetLineRef: "SUMMARY!NEW_RENTALS#3", lineLabel: "3", isOfficialKpi: true, exclusionReason: null },
      { eventType: "new_rental", unitNumber: "D303", rent: 2937, effectiveDate: null, expirationDate: "2027-12-12", moveDate: null, priorRent: null, leaseTerm: "LT", hasReason: false, sheetLineRef: "SUMMARY!NEW_RENTALS#4", lineLabel: "-", isOfficialKpi: false, exclusionReason: "cancelled_or_denied" },
      { eventType: "new_rental", unitNumber: "WAITC1", rent: 5050, effectiveDate: null, expirationDate: "2027-03-31", moveDate: null, priorRent: null, leaseTerm: "ST", hasReason: false, sheetLineRef: "SUMMARY!NEW_RENTALS#5", lineLabel: "-", isOfficialKpi: false, exclusionReason: "waitlist_placeholder" },
      { eventType: "new_rental", unitNumber: "WAITB1", rent: 4150, effectiveDate: null, expirationDate: "2027-04-10", moveDate: null, priorRent: null, leaseTerm: "ST", hasReason: false, sheetLineRef: "SUMMARY!NEW_RENTALS#6", lineLabel: "-", isOfficialKpi: false, exclusionReason: "waitlist_placeholder" },
      { eventType: "move_in", unitNumber: "B206", rent: 2450, effectiveDate: "2026-07-20", expirationDate: "2027-10-19", moveDate: null, priorRent: null, leaseTerm: null, hasReason: false, sheetLineRef: "SUMMARY!MOVE_INS#1", lineLabel: "1", isOfficialKpi: true, exclusionReason: null },
      { eventType: "move_in", unitNumber: "A206", rent: 2370, effectiveDate: "2026-07-21", expirationDate: "2026-12-05", moveDate: null, priorRent: null, leaseTerm: null, hasReason: false, sheetLineRef: "SUMMARY!MOVE_INS#2", lineLabel: "2", isOfficialKpi: true, exclusionReason: null },
      { eventType: "move_in", unitNumber: "E105", rent: 2025, effectiveDate: "2026-07-22", expirationDate: "2027-11-21", moveDate: null, priorRent: null, leaseTerm: null, hasReason: false, sheetLineRef: "SUMMARY!MOVE_INS#3", lineLabel: "3", isOfficialKpi: true, exclusionReason: null },
      { eventType: "move_in", unitNumber: "E304", rent: 3495, effectiveDate: "2026-07-23", expirationDate: "2027-10-20", moveDate: null, priorRent: null, leaseTerm: null, hasReason: false, sheetLineRef: "SUMMARY!MOVE_INS#4", lineLabel: "4", isOfficialKpi: true, exclusionReason: null },
      { eventType: "move_in", unitNumber: "A305", rent: 2785, effectiveDate: "2026-07-24", expirationDate: "2027-10-23", moveDate: null, priorRent: null, leaseTerm: null, hasReason: false, sheetLineRef: "SUMMARY!MOVE_INS#5", lineLabel: "5", isOfficialKpi: true, exclusionReason: null },
      { eventType: "cancel_denial", unitNumber: "D303", rent: null, effectiveDate: null, expirationDate: null, moveDate: null, priorRent: null, leaseTerm: null, hasReason: true, sheetLineRef: "SUMMARY!CANCELS_DENIAL#1", lineLabel: "-", isOfficialKpi: true, exclusionReason: null },
    ],
    exposureRecords: [
      { unitNumber: "F304", status: "vacant_unrented", isSkip: false, daysVacant: 26, makeReadyDate: "2026-06-30", moveInDate: null, noticeDate: null, moveOutDate: null },
      { unitNumber: "B307", status: "vacant_unrented", isSkip: false, daysVacant: 15, makeReadyDate: "2026-07-21", moveInDate: null, noticeDate: null, moveOutDate: null },
      { unitNumber: "A104", status: "notice_unrented", isSkip: false, daysVacant: null, makeReadyDate: "2026-08-06", moveInDate: "2025-07-30", noticeDate: "2026-06-11", moveOutDate: "2026-07-29" },
      { unitNumber: "E206", status: "notice_unrented", isSkip: false, daysVacant: null, makeReadyDate: "2026-08-08", moveInDate: "2025-04-30", noticeDate: "2026-05-28", moveOutDate: "2026-07-29" },
      { unitNumber: "E103", status: "applicant", isSkip: false, daysVacant: null, makeReadyDate: "2026-08-13", moveInDate: "2026-08-14", noticeDate: null, moveOutDate: "2026-07-30" },
    ],
    exposureGrandTotalCount: 5,
    trafficLeads: [
      { firstContactDate: "2026-07-20", sourceChannel: "Property Website", called: true, emailed: false, toured: false, leased: false, sheetLineRef: "TRAFFIC_DETAIL#1" },
      { firstContactDate: "2026-07-21", sourceChannel: "Zillow", called: false, emailed: true, toured: false, leased: false, sheetLineRef: "TRAFFIC_DETAIL#2" },
    ],
    operationalMemory: [
      { memoryType: "traffic_note", sourceRef: "TRAFFIC_DETAIL#1", content: "Auto-linked Call." },
      { memoryType: "traffic_note", sourceRef: "TRAFFIC_DETAIL#2", content: "Just Checking In – Requested a follow-up call." },
    ],
    inventoryRows: [
      { unitNumber: "E304", typeCode: "C1R", bedCount: 2, riverSide: true, description: "2 BED RIVER" },
      { unitNumber: "E105", typeCode: "A1R", bedCount: 1, riverSide: true, description: "1 BED RIVER" },
      { unitNumber: "E103", typeCode: "A1R", bedCount: 1, riverSide: true, description: "1 BED RIVER" },
      { unitNumber: "F304", typeCode: "A1R", bedCount: 1, riverSide: true, description: "1 BED RIVER" },
      { unitNumber: "B307", typeCode: "B2R", bedCount: 2, riverSide: true, description: "2 BED RIVER" },
      { unitNumber: "A104", typeCode: "A1O", bedCount: 1, riverSide: false, description: "1 BED OFF RIVER" },
      { unitNumber: "E206", typeCode: "A1O", bedCount: 1, riverSide: false, description: "1 BED OFF RIVER" },
      { unitNumber: "B206", typeCode: "A1O", bedCount: 1, riverSide: false, description: "1 BED OFF RIVER" },
      { unitNumber: "A206", typeCode: "B1O", bedCount: 1, riverSide: false, description: "1 BED OFF RIVER" },
      { unitNumber: "A305", typeCode: "B2O", bedCount: 2, riverSide: false, description: "2 BED OFF RIVER" },
    ],
    parseWarnings: [
      { ruleCode: "V13_NONNUMERIC_NEW_RENTAL_LINE", severity: "warning", message: 'Unit D303 has a non-numeric Line value ("-") — excluded from new_rentals_count, classified as cancelled_or_denied' },
      { ruleCode: "V13_WAITLIST_PLACEHOLDER_EXCLUDED", severity: "info", message: "Unit WAITC1 excluded from new_rentals_count as a waitlist placeholder (not a physical unit)" },
      { ruleCode: "V13_WAITLIST_PLACEHOLDER_EXCLUDED", severity: "info", message: "Unit WAITB1 excluded from new_rentals_count as a waitlist placeholder (not a physical unit)" },
    ],
  };
}

function demoAdapter(): SourceAdapter {
  return { sourceType: "weekly_summary", parse: async () => demoPayload() };
}

function demoFile(): SourceFileHandle {
  return {
    fileName: "River Run Weekly Summary 2026.07.26.xlsx",
    lastModifiedAt: "2026-07-26T14:00:00Z",
    driveFileId: null,
    bytes: new ArrayBuffer(0),
  };
}

export function SyncReviewDemo() {
  const [detail, setDetail] = useState<SyncRunDetail | null>(null);

  useEffect(() => {
    const repo = new MockLabosRepository();
    // Property provisioning is a separate, one-time step from ingestion
    // itself — resolved here (demo harness), never inside runSync.
    repo.getOrCreateProperty("River Run").then((propertyId) =>
      runSync(repo, {
        adapter: demoAdapter(),
        file: demoFile(),
        config: {
          propertyId, propertyName: "River Run",
          reportingPeriodEnd: "2026-07-26", workbookPropertyAlias: "riverrun",
        },
        triggeredBy: "demo-harness",
      }),
    ).then((result) => {
      setDetail(getSyncRunDetail(repo, result.syncRun.id));
    });
  }, []);

  if (!detail) return <section className="screen"><p className="screen__deck">Running demo Sync Run…</p></section>;
  return <SyncReview detail={detail} />;
}

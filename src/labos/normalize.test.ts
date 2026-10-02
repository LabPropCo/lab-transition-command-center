import { describe, expect, it } from "vitest";
import type { CanonicalPayload } from "./types";
import { normalizePayload } from "./normalize";
import { leasingTx } from "./testHelpers";

function payloadWithExposure(records: CanonicalPayload["exposureRecords"]): CanonicalPayload {
  return {
    reportingWeek: "2026-07-26",
    propertyName: "River Run",
    leasingTransactions: [],
    exposureRecords: records,
    exposureGrandTotalCount: null,
    trafficLeads: [],
    operationalMemory: [],
    inventoryRows: [],
    parseWarnings: [],
  };
}

describe("normalizePayload — exposure classification", () => {
  it("counts an already-vacant unit (no move-out date) as exposed", () => {
    const { exposureRecords, weeklyKpiSnapshot } = normalizePayload(payloadWithExposure([
      { unitNumber: "F304", status: "vacant_unrented", isSkip: false, daysVacant: 26, makeReadyDate: null, moveInDate: null, noticeDate: null, moveOutDate: null },
    ]));
    expect(exposureRecords[0].isUnrented).toBe(true);
    expect(weeklyKpiSnapshot.currentExposureCount).toBe(1);
  });

  it("counts a notice_unrented unit moving out within 30 days as exposed", () => {
    const { exposureRecords } = normalizePayload(payloadWithExposure([
      { unitNumber: "A104", status: "notice_unrented", isSkip: false, daysVacant: null, makeReadyDate: null, moveInDate: null, noticeDate: "2026-06-11", moveOutDate: "2026-08-01" },
    ]));
    expect(exposureRecords[0].isUnrented).toBe(true);
  });

  it("excludes a notice_unrented unit moving out more than 30 days out", () => {
    const { exposureRecords, weeklyKpiSnapshot } = normalizePayload(payloadWithExposure([
      { unitNumber: "A104", status: "notice_unrented", isSkip: false, daysVacant: null, makeReadyDate: null, moveInDate: null, noticeDate: "2026-06-11", moveOutDate: "2026-09-30" },
    ]));
    expect(exposureRecords[0].isUnrented).toBe(false);
    expect(weeklyKpiSnapshot.currentExposureCount).toBe(0);
  });

  it("excludes Applicant status (confirmed: secured, not exposure)", () => {
    const { exposureRecords } = normalizePayload(payloadWithExposure([
      { unitNumber: "E103", status: "applicant", isSkip: false, daysVacant: null, makeReadyDate: "2026-08-13", moveInDate: "2026-08-14", noticeDate: null, moveOutDate: "2026-07-30" },
    ]));
    expect(exposureRecords[0].isUnrented).toBe(false);
  });

  it("excludes Future status (secured, not exposure)", () => {
    const { exposureRecords } = normalizePayload(payloadWithExposure([
      { unitNumber: "B107", status: "future", isSkip: false, daysVacant: 15, makeReadyDate: "2026-07-24", moveInDate: "2026-07-25", noticeDate: null, moveOutDate: null },
    ]));
    expect(exposureRecords[0].isUnrented).toBe(false);
  });

  it("excludes Hold status", () => {
    const { exposureRecords } = normalizePayload(payloadWithExposure([
      { unitNumber: "D306", status: "hold", isSkip: false, daysVacant: null, makeReadyDate: null, moveInDate: null, noticeDate: null, moveOutDate: null },
    ]));
    expect(exposureRecords[0].isUnrented).toBe(false);
  });
});

describe("normalizePayload — weekly KPI aggregation", () => {
  it("counts each leasing event type independently", () => {
    const payload = payloadWithExposure([]);
    payload.leasingTransactions = [
      leasingTx({ eventType: "new_rental", unitNumber: "E304", rent: 3495, leaseTerm: "LT", sheetLineRef: "a" }),
      leasingTx({ eventType: "move_in", unitNumber: "B206", rent: 2450, sheetLineRef: "b" }),
      leasingTx({ eventType: "move_in", unitNumber: "A206", rent: 2370, sheetLineRef: "c" }),
      leasingTx({ eventType: "cancel_denial", unitNumber: "D303", hasReason: true, sheetLineRef: "d" }),
      leasingTx({
        eventType: "new_rental", unitNumber: "WAITC1", sheetLineRef: "e",
        lineLabel: "-", isOfficialKpi: false, exclusionReason: "waitlist_placeholder",
      }),
    ];
    payload.trafficLeads = [
      { firstContactDate: "2026-07-20", sourceChannel: "Zillow", called: true, emailed: false, toured: false, leased: false, sheetLineRef: "t1" },
    ];
    const { weeklyKpiSnapshot } = normalizePayload(payload);
    expect(weeklyKpiSnapshot).toMatchObject({
      newRentalsCount: 1, newRentalsExcludedCount: 1, moveInsCount: 2, moveOutsCount: 0, noticesCount: 0,
      renewalsCount: 0, cancelsDenialsCount: 1, walkInsCount: 1, currentExposureCount: 0,
    });
  });
});

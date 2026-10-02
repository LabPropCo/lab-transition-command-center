import { describe, expect, it } from "vitest";
import type { CanonicalPayload } from "../types";
import { leasingTx, testIngestionConfig } from "../testHelpers";
import { hasBlockingResult, validateCanonicalPayload } from "./rules";

function basePayload(overrides: Partial<CanonicalPayload> = {}): CanonicalPayload {
  return {
    reportingWeek: "2026-07-26",
    propertyName: "River Run",
    leasingTransactions: [],
    exposureRecords: [],
    exposureGrandTotalCount: null,
    trafficLeads: [],
    operationalMemory: [],
    inventoryRows: [],
    parseWarnings: [],
    ...overrides,
  };
}

const fileName = "River Run Weekly Summary 2026.07.26.xlsx";
const modifiedAt = "2026-07-26T12:00:00Z";

describe("validateCanonicalPayload", () => {
  it("passes a clean payload with no blocking results", () => {
    const results = validateCanonicalPayload({
      payload: basePayload(), sourceFileName: fileName, sourceLastModifiedAt: modifiedAt, config: testIngestionConfig(),
    });
    expect(hasBlockingResult(results)).toBe(false);
  });

  it("V1 — flags the wrong property as blocking", () => {
    const results = validateCanonicalPayload({
      payload: basePayload({ propertyName: "Piedmont Apartments" }),
      sourceFileName: fileName, sourceLastModifiedAt: modifiedAt, config: testIngestionConfig(),
    });
    expect(results.some((r) => r.ruleCode === "V1_WRONG_PROPERTY" && r.severity === "blocking")).toBe(true);
  });

  it("V1 — is case-insensitive (the workbook's own casing need not match exactly)", () => {
    const results = validateCanonicalPayload({
      payload: basePayload({ propertyName: "RIVER RUN" }),
      sourceFileName: fileName, sourceLastModifiedAt: modifiedAt, config: testIngestionConfig({ propertyName: "River Run" }),
    });
    expect(results.some((r) => r.ruleCode === "V1_WRONG_PROPERTY")).toBe(false);
  });

  it("V2 — flags a reporting-period mismatch against the requested config, not the file name", () => {
    const results = validateCanonicalPayload({
      payload: basePayload({ reportingWeek: "2026-07-19" }),
      sourceFileName: fileName, sourceLastModifiedAt: modifiedAt, config: testIngestionConfig({ reportingPeriodEnd: "2026-07-26" }),
    });
    expect(results.some((r) => r.ruleCode === "V2_REPORTING_WEEK_MISMATCH" && r.severity === "blocking")).toBe(true);
  });

  it("V2 — passes when the in-sheet date matches the requested reporting period, regardless of file name", () => {
    const results = validateCanonicalPayload({
      payload: basePayload({ reportingWeek: "2026-07-26" }),
      sourceFileName: "some_export_final_v3.xlsx", sourceLastModifiedAt: modifiedAt, config: testIngestionConfig({ reportingPeriodEnd: "2026-07-26" }),
    });
    expect(results.some((r) => r.ruleCode === "V2_REPORTING_WEEK_MISMATCH")).toBe(false);
  });

  it("V14 — warns (non-blocking) when the file name's own date doesn't match the requested period", () => {
    const results = validateCanonicalPayload({
      payload: basePayload({ reportingWeek: "2026-07-26" }),
      sourceFileName: "River Run Weekly Summary 2026.07.19.xlsx", sourceLastModifiedAt: modifiedAt,
      config: testIngestionConfig({ reportingPeriodEnd: "2026-07-26" }),
    });
    const found = results.find((r) => r.ruleCode === "V14_FILENAME_PERIOD_MISMATCH");
    expect(found?.severity).toBe("warning");
    expect(hasBlockingResult(results)).toBe(false);
  });

  it("V14 — does not fire when the file name has no parseable date at all (never required)", () => {
    const results = validateCanonicalPayload({
      payload: basePayload(),
      sourceFileName: "weekly summary.xlsx", sourceLastModifiedAt: modifiedAt, config: testIngestionConfig(),
    });
    expect(results.some((r) => r.ruleCode === "V14_FILENAME_PERIOD_MISMATCH")).toBe(false);
    expect(hasBlockingResult(results)).toBe(false);
  });

  it("V5 — flags a traffic lead missing its required First Contact Date", () => {
    const results = validateCanonicalPayload({
      payload: basePayload({
        trafficLeads: [{ firstContactDate: "", sourceChannel: "Zillow", called: false, emailed: true, toured: false, leased: false, sheetLineRef: "TRAFFIC_DETAIL#1" }],
      }),
      sourceFileName: fileName, sourceLastModifiedAt: modifiedAt, config: testIngestionConfig(),
    });
    expect(results.some((r) => r.ruleCode === "V5_MISSING_FIRST_CONTACT_DATE" && r.severity === "blocking")).toBe(true);
  });

  it("V9 — warns (not blocks) on a unit missing from Inventory", () => {
    const results = validateCanonicalPayload({
      payload: basePayload({
        leasingTransactions: [leasingTx({ eventType: "new_rental", unitNumber: "Z999", rent: 2000, leaseTerm: "LT", sheetLineRef: "SUMMARY!NEW_RENTALS#1" })],
        inventoryRows: [],
      }),
      sourceFileName: fileName, sourceLastModifiedAt: modifiedAt, config: testIngestionConfig(),
    });
    const found = results.find((r) => r.ruleCode === "V9_UNIT_NOT_IN_INVENTORY");
    expect(found?.severity).toBe("warning");
    expect(hasBlockingResult(results)).toBe(false);
  });

  it("V9 — does not fire for a unit classified as a waitlist placeholder", () => {
    const results = validateCanonicalPayload({
      payload: basePayload({
        leasingTransactions: [leasingTx({
          eventType: "new_rental", unitNumber: "WAITC1", sheetLineRef: "SUMMARY!NEW_RENTALS#4",
          lineLabel: "-", isOfficialKpi: false, exclusionReason: "waitlist_placeholder",
        })],
        inventoryRows: [],
      }),
      sourceFileName: fileName, sourceLastModifiedAt: modifiedAt, config: testIngestionConfig(),
    });
    expect(results.some((r) => r.ruleCode === "V9_UNIT_NOT_IN_INVENTORY")).toBe(false);
  });

  it("V8 — warns when the source file predates its own reporting week", () => {
    const results = validateCanonicalPayload({
      payload: basePayload(),
      sourceFileName: fileName, sourceLastModifiedAt: "2026-07-20T00:00:00Z", config: testIngestionConfig(),
    });
    expect(results.some((r) => r.ruleCode === "V8_SOURCE_PREDATES_REPORTING_WEEK")).toBe(true);
  });

  it("V8 — warns when the source file is unusually stale relative to its reporting week", () => {
    const results = validateCanonicalPayload({
      payload: basePayload(),
      sourceFileName: fileName, sourceLastModifiedAt: "2026-08-15T00:00:00Z", config: testIngestionConfig(),
    });
    expect(results.some((r) => r.ruleCode === "V8_SOURCE_STALE")).toBe(true);
  });

  it("passes through adapter-level parse warnings (V4/V6/V10/V12) untouched", () => {
    const results = validateCanonicalPayload({
      payload: basePayload({
        parseWarnings: [{ ruleCode: "V4_MISSING_SECTION", severity: "warning", message: "SUMMARY section \"RENEWALS\" not found" }],
      }),
      sourceFileName: fileName, sourceLastModifiedAt: modifiedAt, config: testIngestionConfig(),
    });
    expect(results.some((r) => r.ruleCode === "V4_MISSING_SECTION")).toBe(true);
  });
});

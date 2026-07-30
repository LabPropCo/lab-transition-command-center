import { describe, expect, it } from "vitest";
import { weeklySummaryAdapter } from "./weeklySummaryAdapter";
import { testIngestionConfig } from "../testHelpers";

// Synthetic fixture only — mirrors the real workbook's structure (confirmed
// by direct inspection) but every unit number, rent, and date is fabricated.
// No resident/prospect name appears anywhere, matching what the adapter
// itself would ever emit even from a real file.
async function buildFixtureWorkbook(): Promise<ArrayBuffer> {
  const XLSX = await import("xlsx");

  const summary: (string | number)[][] = [
    ["RIVER RUN ACTIVITY - For Week Ending:", "", "", "", "7/26/26"],
    [],
    ["NEW RENTALS"],
    ["Line", "Unit #", "Type", "Rent", "M/I Date", "Exp Date", "Specials", "Names", "Lease Term ( ST, LT)"],
    ["1", "E304", "rrC1R", "3,495.00", "", "10/20/27", "Remainder of July Fr", "", "LT"],
    ["-", "D303", "rrB2R", "2,937.00", "", "12/12/27", "N/A", "", "LT"],
    ["-", "WAITC1", "WAITRRC1", "5,050.00", "12/1/26", "3/31/27", "N/A", "", "ST"],
    [],
    ["MOVE-INS"],
    ["Line", "Unit#", "Type", "Rent", "M/I Date", "Exp Date", "Names"],
    ["1", "B206", "rrA1", "2,450.00", "7/20/26", "10/19/27", ""],
    ["2", "A206", "rrB1", "2,370.00", "7/21/26", "12/05/26", ""],
    [],
    ["MOVE-OUTS"],
    ["Line", "Unit#", "Type", "Rent", "Exp Date", "M/O Date", "Reason", "Names"],
    [],
    ["NOTICE"],
    ["Line", "Unit #", "Type", "Exp Date", "M/O Date", "Reason", "Names"],
    [],
    ["RENEWALS"],
    ["Line", "Unit #", "Type", "Prior Rent ", "New Rent"],
    [],
    ["CANCELS/DENIAL"],
    ["Line", "Unit #", "Type", "Reason", "Names"],
    ["-", "D303", "rrB2R", "Fraudulent Income", ""],
  ];

  const availability: (string | number)[][] = [
    ["Unit Availability De"],
    ["River Run (riverrun)"],
    ["As Of: 07/26/2026"],
    ["Showing Pre-Leased: "],
    ["Showing Occupied: No"],
    ["Group By: None"],
    ["Unit", "Resident", "Name", "Resident", "Unit", "Resident", "Unit", "Status", "Days", "Make", "Move", "Hold", "Hold", "Notice", "Move"],
    ["", "", "", "Rent", "Rent", "Deposit", "Deposit", "", "Vacant", "Ready", "In", "", "Until", "", "Out"],
    [],
    ["River Run (riverrun)"],
    ["F304", "", "", "0.00", "4,250.00", "0.00", "0.00", "", "26", "6/30/26", "", "No", "", "", ""],
    ["Total", "", "1 Unit", "0.00", "4,250.00"],
    [],
    ["River Run (riverrun)"],
    ["A104", "t0000346", "", "3,414.00", "4,010.00", "3,414.00", "0.00", "Notice", "", "8/6/26", "7/30/25", "No", "", "6/11/26", "7/29/26"],
    ["Total", "", "1 Unit", "3,414.00", "4,010.00"],
    [],
    ["River Run (riverrun)"],
    ["E103", "t0001213", "", "2,095.00", "3,360.00", "500.00", "0.00", "Applicant", "", "8/13/26", "8/14/26", "No", "", "", "7/30/26"],
    ["Total", "", "1 Unit", "2,095.00", "3,360.00"],
    [],
    ["Total for riverrun", "", "3 Units", "5,509.00", "11,620.00"],
    ["Grand Total Count", "", "3 Units", "5,509.00", "11,620.00"],
  ];

  const traffic: (string | number)[][] = [
    ["Prospect", "First Contact Date", "Source", "Call", "Email", "Tour", "Lease", "Key Notes"],
    ["Prospect A", "7/20/26", "Property Website", "✓", "", "", "", "Auto-linked Call."],
    ["Prospect B", "7/21/26", "Zillow", "", "✓", "✓", "✓", "First contact."],
    ["", "", "", "", "", "", "", "Follow-up: confirmed tour time by text."],
  ];

  const inventory: (string | number)[][] = [
    ["Unit #", "Type", "Reference", "River", "", ""],
    ["F304", "1bdr", "A1", "R", "A1R", "1 BED RIVER"],
    ["A104", "1bdr", "A1", "O", "A1O", "1 BED OFF RIVER"],
    ["E103", "1bdr", "A1", "R", "A1R", "1 BED RIVER"],
    ["E304", "2bdr", "C1", "R", "C1R", "2 BED RIVER"],
    ["B206", "1bdr", "A1", "O", "A1O", "1 BED OFF RIVER"],
    ["A206", "1bdr", "B1", "O", "B1O", "1 BED OFF RIVER"],
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "SUMMARY");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(availability), "Unit Availability Details");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(traffic), "Traffic Detail");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inventory), "Inventory");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("weeklySummaryAdapter", () => {
  it("parses a full fixture workbook into the canonical shape", async () => {
    const bytes = await buildFixtureWorkbook();
    const payload = await weeklySummaryAdapter.parse({
      fileName: "River Run Weekly Summary 2026.07.26.xlsx",
      lastModifiedAt: new Date().toISOString(),
      driveFileId: null,
      bytes,
    }, testIngestionConfig());

    expect(payload.reportingWeek).toBe("2026-07-26");
    // Extracted verbatim from the sheet's own text ("RIVER RUN ACTIVITY -"),
    // not retitle-cased — V1's comparison against config.propertyName is
    // case-insensitive precisely because of this.
    expect(payload.propertyName).toBe("RIVER RUN");

    // SUMMARY
    expect(payload.leasingTransactions).toHaveLength(6); // 3 new-rental rows (1 numbered + 2 excluded) + 2 move-ins + 1 cancel/denial
    const newRentals = payload.leasingTransactions.filter((t) => t.eventType === "new_rental");
    expect(newRentals).toHaveLength(3);

    const numberedRental = newRentals.find((t) => t.unitNumber === "E304")!;
    expect(numberedRental.rent).toBe(3495);
    expect(numberedRental.leaseTerm).toBe("LT");
    expect(numberedRental.lineLabel).toBe("1");
    expect(numberedRental.isOfficialKpi).toBe(true);
    expect(numberedRental.exclusionReason).toBeNull();

    // "-"-Line row that also appears in CANCELS/DENIAL -> classified cancelled_or_denied,
    // excluded from the official count, but still present in the payload for audit.
    const cancelledRental = newRentals.find((t) => t.unitNumber === "D303")!;
    expect(cancelledRental.lineLabel).toBe("-");
    expect(cancelledRental.isOfficialKpi).toBe(false);
    expect(cancelledRental.exclusionReason).toBe("cancelled_or_denied");
    expect(payload.parseWarnings.some((w) => w.ruleCode === "V13_NONNUMERIC_NEW_RENTAL_LINE" && (w.context as { unitNumber: string })?.unitNumber === "D303")).toBe(true);

    // WAIT-prefixed "-"-Line row -> classified waitlist_placeholder, info not warning,
    // and does NOT also trigger V9 (it's not a real physical unit).
    const waitlistRental = newRentals.find((t) => t.unitNumber === "WAITC1")!;
    expect(waitlistRental.isOfficialKpi).toBe(false);
    expect(waitlistRental.exclusionReason).toBe("waitlist_placeholder");
    expect(payload.parseWarnings.some((w) => w.ruleCode === "V13_WAITLIST_PLACEHOLDER_EXCLUDED" && w.severity === "info")).toBe(true);
    // V9 (unit not in Inventory) is computed in the separate validation stage,
    // not by the adapter — see validation/rules.test.ts's dedicated coverage
    // that it correctly does NOT fire for waitlist placeholders.

    const moveIns = payload.leasingTransactions.filter((t) => t.eventType === "move_in");
    expect(moveIns).toHaveLength(2);
    expect(moveIns.map((t) => t.unitNumber)).toEqual(["B206", "A206"]);
    expect(moveIns.every((t) => t.isOfficialKpi)).toBe(true); // scoped to new_rental only
    const cancel = payload.leasingTransactions.find((t) => t.eventType === "cancel_denial")!;
    expect(cancel.unitNumber).toBe("D303");
    expect(cancel.hasReason).toBe(true);

    // No resident/prospect name anywhere in the canonical payload.
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/Names/);
    expect(serialized).not.toContain("t0000346");
    expect(serialized).not.toContain("t0001213");

    // Unit Availability Details — title/metadata rows correctly excluded,
    // only the 3 real unit rows present.
    expect(payload.exposureRecords).toHaveLength(3);
    const vacant = payload.exposureRecords.find((e) => e.unitNumber === "F304")!;
    expect(vacant.status).toBe("vacant_unrented");
    const notice = payload.exposureRecords.find((e) => e.unitNumber === "A104")!;
    expect(notice.status).toBe("notice_unrented");
    const applicant = payload.exposureRecords.find((e) => e.unitNumber === "E103")!;
    expect(applicant.status).toBe("applicant");
    // E103's row has both a move-in and a move-out date -> V12 warning fires.
    expect(payload.parseWarnings.some((w) => w.ruleCode === "V12_SIMULTANEOUS_MOVE_IN_OUT")).toBe(true);

    // Traffic Detail — continuation row merged into the preceding lead's note.
    expect(payload.trafficLeads).toHaveLength(2);
    const memoB = payload.operationalMemory.find((m) => m.sourceRef === "TRAFFIC_DETAIL#2")!;
    expect(memoB.content).toBe("First contact.\nFollow-up: confirmed tour time by text.");
    expect(payload.operationalMemory.every((m) => m.memoryType === "traffic_note")).toBe(true);

    // Inventory
    expect(payload.inventoryRows).toHaveLength(6);
    expect(payload.inventoryRows.find((r) => r.unitNumber === "E304")).toMatchObject({ typeCode: "C1R", bedCount: 2, riverSide: true });
  });

  it("flags a missing SUMMARY section rather than silently continuing", async () => {
    const XLSX = await import("xlsx");
    const bytes = await buildFixtureWorkbook();
    const wb = XLSX.read(bytes, { type: "array" });
    // Simulate a structurally-drifted workbook: rename a section label.
    const ws = wb.Sheets["SUMMARY"];
    const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
    const renewalsIdx = rows.findIndex((r) => r[0] === "RENEWALS");
    rows[renewalsIdx][0] = "RENEWAL"; // typo/rename drift
    wb.Sheets["SUMMARY"] = XLSX.utils.aoa_to_sheet(rows);
    const driftedBytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const payload = await weeklySummaryAdapter.parse({
      fileName: "drifted.xlsx", lastModifiedAt: new Date().toISOString(), driveFileId: null, bytes: driftedBytes,
    }, testIngestionConfig());
    expect(payload.parseWarnings.some((w) => w.ruleCode === "V4_MISSING_SECTION")).toBe(true);
  });

  it("parses the same workbook structure for a differently named property, with zero adapter code changes", async () => {
    const XLSX = await import("xlsx");
    const bytes = await buildFixtureWorkbook();
    const wb = XLSX.read(bytes, { type: "array" });

    // Retarget every property-specific literal in the fixture to a different
    // property — same structure, different identity — to prove the adapter
    // has no embedded assumption about "River Run" specifically.
    const summaryRows: string[][] = XLSX.utils.sheet_to_json(wb.Sheets["SUMMARY"], { header: 1, raw: false, defval: "" });
    summaryRows[0][0] = "TEST GARDENS ACTIVITY - For Week Ending:";
    wb.Sheets["SUMMARY"] = XLSX.utils.aoa_to_sheet(summaryRows);

    const availabilityRows: string[][] = XLSX.utils.sheet_to_json(wb.Sheets["Unit Availability Details"], { header: 1, raw: false, defval: "" });
    for (const row of availabilityRows) {
      if (row[0] === "River Run (riverrun)") row[0] = "Test Gardens (testgardens)";
      if (row[0] === "Total for riverrun") row[0] = "Total for testgardens";
    }
    wb.Sheets["Unit Availability Details"] = XLSX.utils.aoa_to_sheet(availabilityRows);
    const retargetedBytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const payload = await weeklySummaryAdapter.parse(
      { fileName: "Test Gardens Weekly Summary 2026.07.26.xlsx", lastModifiedAt: new Date().toISOString(), driveFileId: null, bytes: retargetedBytes },
      testIngestionConfig({ propertyName: "Test Gardens", workbookPropertyAlias: "testgardens" }),
    );

    expect(payload.propertyName).toBe("TEST GARDENS"); // verbatim from the sheet, same casing behavior as River Run
    expect(payload.exposureRecords).toHaveLength(3); // identical structural parse as the River Run fixture
    expect(payload.leasingTransactions.length).toBeGreaterThan(0);
  });
});

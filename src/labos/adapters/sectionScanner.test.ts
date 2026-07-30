import { describe, expect, it } from "vitest";
import { scanSummarySections, SUMMARY_SECTION_LABELS } from "./sectionScanner";

// Synthetic fixtures only — fabricated unit numbers/rents, no real resident
// names anywhere, per the standing governance rule.

function lightWeekRows(): string[][] {
  return [
    ["RIVER RUN ACTIVITY -", "", "", "", "7/26/26"],
    [],
    ["NEW RENTALS"],
    ["Line", "Unit #", "Type", "Rent", "M/I Date", "Exp Date", "Specials", "Names", "Lease Term ( ST, LT)"],
    ["1", "Z101", "rrA1", "2,000.00", "7/1/26", "6/30/27", "N/A", "", "LT"],
    [],
    ["MOVE-INS"],
    ["Line", "Unit#", "Type", "Rent", "M/I Date", "Exp Date", "Names"],
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
    ["1", "Z102", "rrB2R", "Fraudulent Income", ""],
  ];
}

function heavyWeekRows(): string[][] {
  // Same structure, but MOVE-OUTS and NOTICE have several rows each — proves
  // the scanner doesn't depend on fixed row offsets from a lighter week.
  return [
    ["RIVER RUN ACTIVITY -", "", "", "", "8/2/26"],
    [],
    ["NEW RENTALS"],
    ["Line", "Unit #", "Type", "Rent", "M/I Date", "Exp Date", "Specials", "Names", "Lease Term ( ST, LT)"],
    ["1", "Z201", "rrA1", "2,050.00", "8/1/26", "7/31/27", "N/A", "", "LT"],
    ["2", "Z202", "rrB2", "2,900.00", "8/2/26", "8/1/27", "N/A", "", "LT"],
    [],
    ["MOVE-INS"],
    ["Line", "Unit#", "Type", "Rent", "M/I Date", "Exp Date", "Names"],
    ["1", "Z203", "rrA1", "2,000.00", "8/1/26", "7/31/27", ""],
    [],
    ["MOVE-OUTS"],
    ["Line", "Unit#", "Type", "Rent", "Exp Date", "M/O Date", "Reason", "Names"],
    ["1", "Z204", "rrA1", "1,950.00", "7/31/27", "8/1/26", "", ""],
    ["2", "Z205", "rrB2", "2,800.00", "8/5/26", "8/2/26", "", ""],
    ["3", "Z206", "rrC1", "3,100.00", "8/6/26", "8/3/26", "", ""],
    [],
    ["NOTICE"],
    ["Line", "Unit #", "Type", "Exp Date", "M/O Date", "Reason", "Names"],
    ["1", "Z207", "rrA1", "9/1/26", "9/1/26", "", ""],
    ["2", "Z208", "rrB2", "9/2/26", "9/2/26", "", ""],
    [],
    ["RENEWALS"],
    ["Line", "Unit #", "Type", "Prior Rent ", "New Rent"],
    ["1", "Z209", "rrA1", "2,000.00", "2,100.00"],
    [],
    ["CANCELS/DENIAL"],
    ["Line", "Unit #", "Type", "Reason", "Names"],
  ];
}

describe("scanSummarySections", () => {
  it("finds all six sections in a light week (several empty sections)", () => {
    const { sections, missingLabels } = scanSummarySections(lightWeekRows());
    expect(missingLabels).toEqual([]);
    expect(sections.map((s) => s.label)).toEqual(SUMMARY_SECTION_LABELS as unknown as string[]);

    const newRentals = sections.find((s) => s.label === "NEW RENTALS")!;
    expect(newRentals.dataRows).toHaveLength(1);
    expect(newRentals.dataRows[0][1]).toBe("Z101");

    const moveIns = sections.find((s) => s.label === "MOVE-INS")!;
    expect(moveIns.dataRows).toHaveLength(0);

    const cancels = sections.find((s) => s.label === "CANCELS/DENIAL")!;
    expect(cancels.dataRows).toHaveLength(1);
    expect(cancels.dataRows[0][1]).toBe("Z102");
  });

  it("finds all six sections in a heavy week (multi-row sections shift everything down)", () => {
    const { sections, missingLabels } = scanSummarySections(heavyWeekRows());
    expect(missingLabels).toEqual([]);

    const moveOuts = sections.find((s) => s.label === "MOVE-OUTS")!;
    expect(moveOuts.dataRows).toHaveLength(3);
    expect(moveOuts.dataRows.map((r) => r[1])).toEqual(["Z204", "Z205", "Z206"]);

    const notice = sections.find((s) => s.label === "NOTICE")!;
    expect(notice.dataRows).toHaveLength(2);

    // The section AFTER a multi-row one must still be found at its shifted position.
    const renewals = sections.find((s) => s.label === "RENEWALS")!;
    expect(renewals.dataRows).toHaveLength(1);
    expect(renewals.dataRows[0][1]).toBe("Z209");

    const cancels = sections.find((s) => s.label === "CANCELS/DENIAL")!;
    expect(cancels.dataRows).toHaveLength(0);
  });

  it("reports a missing section label rather than silently continuing", () => {
    const truncated = lightWeekRows();
    const renewalsLabelIndex = truncated.findIndex((r) => firstCellText(r) === "RENEWALS");
    // Delete the blank separator before RENEWALS, its label row, and its
    // header row, so the section is entirely absent from the sheet.
    truncated.splice(renewalsLabelIndex - 1, 2);

    const { missingLabels } = scanSummarySections(truncated);
    expect(missingLabels).toEqual(["RENEWALS"]);
  });
});

function firstCellText(row: string[]): string {
  return (row[0] ?? "").toString().trim();
}

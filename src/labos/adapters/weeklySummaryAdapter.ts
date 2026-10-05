import type {
  CanonicalExposureRecord, CanonicalInventoryRow, CanonicalLeasingTransaction,
  CanonicalOperationalMemory, CanonicalPayload, CanonicalTrafficLead, ExposureStatus,
  LeasingEventType, NewRentalExclusionReason, ParseWarning, SourceAdapter, SourceFileHandle,
} from "../types";
import type { IngestionConfig } from "../config";
import { scanSummarySections, type SummarySection, type SummarySectionLabel } from "./sectionScanner";

// Unlike VendorImport.tsx's sheet_to_json usage elsewhere in this repo, blank
// rows are NOT dropped here (no `blankrows: false`) — the section scanner and
// the Unit Availability Details group structure both depend on blank rows
// being present as real separators, not silently removed.
//
// Sheet-name lookup is case-insensitive: the real workbook names two of its
// four sheets in all caps ("TRAFFIC DETAIL", "INVENTORY") while the other two
// are mixed-case ("SUMMARY" happens to be all-caps too, but "Unit
// Availability Details" is not) — an exact-case lookup silently returned
// empty results for the all-caps sheets until this was caught by running
// against the real file.
async function sheetRows(workbook: unknown, sheetName: string): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const wb = workbook as { Sheets: Record<string, unknown> };
  const actualName = Object.keys(wb.Sheets).find((n) => n.toLowerCase() === sheetName.toLowerCase());
  const ws = actualName ? wb.Sheets[actualName] : undefined;
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws as never, { header: 1, raw: false, defval: "" }) as string[][];
}

function parseMoney(cell: string): number | null {
  const cleaned = (cell ?? "").replace(/[$,]/g, "").trim();
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Source dates are M/D/YY (e.g. "7/26/26") — always interpreted as 20YY,
// matching every reporting week this system will ever ingest.
function parseSourceDate(cell: string): string | null {
  const trimmed = (cell ?? "").trim();
  if (trimmed === "" || trimmed === "-") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const [, mo, d, yy] = m;
  const year = 2000 + Number(yy);
  return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

const SECTION_EVENT_TYPE: Record<SummarySectionLabel, LeasingEventType> = {
  "NEW RENTALS": "new_rental",
  "MOVE-INS": "move_in",
  "MOVE-OUTS": "move_out",
  "NOTICE": "notice",
  "RENEWALS": "renewal",
  "CANCELS/DENIAL": "cancel_denial",
};

// Confirmed business rule, NEW RENTALS only: a non-numeric Line value is
// real data but not an official numbered lease for the week. Classified for
// audit rather than just excluded — WAIT-prefixed unit codes aren't
// physical units at all (waitlist placeholders); anything also appearing in
// CANCELS/DENIAL this same run was a voided deal; anything else is unclassified.
function classifyNewRentalExclusion(unitNumber: string, cancelledUnits: Set<string>): NewRentalExclusionReason {
  if (/^WAIT/i.test(unitNumber)) return "waitlist_placeholder";
  if (cancelledUnits.has(unitNumber)) return "cancelled_or_denied";
  return "other_unnumbered";
}

function parseSummarySection(
  section: SummarySection,
  warnings: ParseWarning[],
  cancelledUnits: Set<string>,
): CanonicalLeasingTransaction[] {
  const eventType = SECTION_EVENT_TYPE[section.label];
  const out: CanonicalLeasingTransaction[] = [];

  section.dataRows.forEach((row, i) => {
    const lineLabel = (row[0] ?? "").trim();
    const unitNumber = (row[1] ?? "").trim();
    const sheetLineRef = `SUMMARY!${section.label.replace(/[^A-Z]/g, "_")}#${i + 1}`;

    // A genuinely blank row (no unit number at all) is not data — excluded,
    // recorded as an info notice (V10). This is distinct from a populated
    // row with a non-numeric Line (handled below, new_rental only).
    if (unitNumber === "") {
      warnings.push({
        ruleCode: "V10_PLACEHOLDER_ROW_EXCLUDED",
        severity: "info",
        message: `Excluded blank row in ${section.label}`,
        context: { sheetLineRef },
      });
      return;
    }

    let isOfficialKpi = true;
    let exclusionReason: NewRentalExclusionReason | null = null;
    if (eventType === "new_rental" && !/^\d+$/.test(lineLabel)) {
      isOfficialKpi = false;
      exclusionReason = classifyNewRentalExclusion(unitNumber, cancelledUnits);
      if (exclusionReason === "waitlist_placeholder") {
        warnings.push({
          ruleCode: "V13_WAITLIST_PLACEHOLDER_EXCLUDED", severity: "info",
          message: `Unit ${unitNumber} excluded from new_rentals_count as a waitlist placeholder (not a physical unit)`,
          context: { unitNumber, sheetLineRef },
        });
      } else {
        warnings.push({
          ruleCode: "V13_NONNUMERIC_NEW_RENTAL_LINE", severity: "warning",
          message: `Unit ${unitNumber} has a non-numeric Line value ("${lineLabel}") — excluded from new_rentals_count, classified as ${exclusionReason}`,
          context: { unitNumber, sheetLineRef, lineLabel },
        });
      }
    }

    if (eventType === "renewal") {
      out.push({
        eventType, unitNumber, sheetLineRef, lineLabel, isOfficialKpi, exclusionReason,
        rent: parseMoney(row[4] ?? ""),          // New Rent
        priorRent: parseMoney(row[3] ?? ""),     // Prior Rent
        effectiveDate: null, expirationDate: null, moveDate: null,
        leaseTerm: null, hasReason: false,
      });
      return;
    }

    // Column layout differs slightly per section (see build-plan field-mapping
    // table) — Reason appears only on Move-Outs/Notice/Cancels; Names is never
    // mapped (governance).
    const reasonIndex = eventType === "move_out" ? 6 : eventType === "notice" ? 5 : eventType === "cancel_denial" ? 3 : -1;
    const hasReason = reasonIndex >= 0 && (row[reasonIndex] ?? "").trim() !== "";

    const leaseTermRaw = eventType === "new_rental" ? (row[8] ?? "").trim() : "";
    const leaseTerm = leaseTermRaw === "ST" || leaseTermRaw === "LT" ? leaseTermRaw : null;
    if (leaseTermRaw && !leaseTerm) {
      warnings.push({
        ruleCode: "UNRECOGNIZED_LEASE_TERM", severity: "warning",
        message: `Unrecognized lease term "${leaseTermRaw}"`, context: { sheetLineRef },
      });
    }

    out.push({
      eventType, unitNumber, sheetLineRef, hasReason, leaseTerm, lineLabel, isOfficialKpi, exclusionReason,
      rent: eventType === "cancel_denial" ? null : parseMoney(row[3] ?? ""),
      priorRent: null,
      effectiveDate: eventType === "new_rental" || eventType === "move_in" ? parseSourceDate(row[4] ?? "") : null,
      expirationDate: (eventType === "new_rental" || eventType === "move_in") ? parseSourceDate(row[5] ?? "")
        : eventType === "move_out" ? parseSourceDate(row[4] ?? "") : eventType === "notice" ? parseSourceDate(row[3] ?? "") : null,
      moveDate: eventType === "move_out" ? parseSourceDate(row[5] ?? "") : eventType === "notice" ? parseSourceDate(row[4] ?? "") : null,
    });
  });

  return out;
}

// Everything above the first per-group "<Property> (<alias>)" marker is sheet
// title/filter metadata (title, "As Of:", "Showing ...", "Group By:", and the
// two-row column header itself) — none of it is unit data, but several of
// those rows have non-blank, non-marker text in column A, so they need their
// own explicit skip rather than relying on the blank/marker checks alone.
// This structural shape (title/filter block, then repeated "<Property>
// (<alias>)" group markers, then "Total"/"Grand Total Count" rows) is a
// property-agnostic feature of this workbook FORMAT — only the literal
// property name and alias text are property-specific, and those come from
// config, never hardcoded here.
const NON_UNIT_ROW_PREFIXES = [
  "Unit Availability", "As Of:", "Showing Pre-Leased", "Showing Occupied", "Group By:",
];

function isStructuralRow(col0: string, config: IngestionConfig): boolean {
  const groupMarker = `${config.propertyName} (${config.workbookPropertyAlias})`.toLowerCase();
  const totalForMarker = `total for ${config.workbookPropertyAlias}`.toLowerCase();
  const lower = col0.toLowerCase();
  if (col0 === "" || col0 === "Unit" || col0 === "Total" || lower === totalForMarker || col0 === "Grand Total Count") return true;
  if (lower.startsWith(groupMarker)) return true;
  return NON_UNIT_ROW_PREFIXES.some((p) => col0.startsWith(p));
}

// Confirmed business rule: a row showing both a Move-In and a Move-Out date
// means the outgoing resident vacates, the unit turns, and the incoming
// resident (whatever status the row shows — Applicant/Future) moves in. V12
// stays a warning, not an assumption baked in silently, so a genuinely
// unexpected future pattern is still visible.
function classifyExposureStatus(rawStatus: string): { status: ExposureStatus; isSkip: boolean; unrecognized: boolean } {
  const skipMatch = /\(skip\)/i.test(rawStatus);
  const base = rawStatus.replace(/\(skip\)/i, "").trim().toLowerCase();
  const map: Record<string, ExposureStatus> = {
    "": "vacant_unrented",
    "notice": "notice_unrented",
    "applicant": "applicant",
    "future": "future",
    "hold": "hold",
  };
  const status = map[base];
  return status
    ? { status, isSkip: skipMatch, unrecognized: false }
    : { status: "vacant_unrented", isSkip: skipMatch, unrecognized: true };
}

function parseUnitAvailability(
  rows: string[][], warnings: ParseWarning[], config: IngestionConfig,
): { records: CanonicalExposureRecord[]; grandTotalCount: number | null } {
  const out: CanonicalExposureRecord[] = [];
  let grandTotalCount: number | null = null;

  for (const row of rows) {
    const col0 = (row[0] ?? "").trim();
    if (col0 === "Grand Total Count") {
      const m = /(\d+)/.exec(row[2] ?? "");
      grandTotalCount = m ? Number(m[1]) : null;
      continue;
    }
    if (isStructuralRow(col0, config)) continue;

    const rawStatus = (row[7] ?? "").trim();
    const { status, isSkip, unrecognized } = classifyExposureStatus(rawStatus);
    const moveInDate = parseSourceDate(row[10] ?? "");
    const moveOutDate = parseSourceDate(row[14] ?? "");

    if (unrecognized) {
      warnings.push({
        ruleCode: "UNRECOGNIZED_EXPOSURE_STATUS", severity: "warning",
        message: `Unrecognized status "${rawStatus}" on unit ${col0} — defaulted to vacant_unrented`,
        context: { unitNumber: col0 },
      });
    }
    if (moveInDate && moveOutDate) {
      warnings.push({
        ruleCode: "V12_SIMULTANEOUS_MOVE_IN_OUT", severity: "warning",
        message: `Unit ${col0} shows both a move-in and a move-out date on one row (expected: outgoing vacates, unit turns, incoming moves in)`,
        context: { unitNumber: col0, moveInDate, moveOutDate },
      });
    }

    out.push({
      unitNumber: col0, status, isSkip,
      daysVacant: row[8] && row[8].trim() !== "" ? Number(row[8]) : null,
      makeReadyDate: parseSourceDate(row[9] ?? ""),
      moveInDate, moveOutDate,
      noticeDate: parseSourceDate(row[13] ?? ""),
    });
  }

  if (out.length === 0) {
    warnings.push({
      ruleCode: "V6_NO_EXPOSURE_ROWS", severity: "warning",
      message: "No unit rows found in Unit Availability Details",
    });
  }
  if (grandTotalCount !== null && grandTotalCount !== out.length) {
    warnings.push({
      ruleCode: "V6_EXPOSURE_TOTAL_MISMATCH", severity: "blocking",
      message: `Sheet's own Grand Total Count (${grandTotalCount}) does not match parsed unit rows (${out.length})`,
    });
  }
  return { records: out, grandTotalCount };
}

function parseTrafficDetail(
  rows: string[][],
): { leads: CanonicalTrafficLead[]; memory: CanonicalOperationalMemory[] } {
  const leads: CanonicalTrafficLead[] = [];
  const memory: CanonicalOperationalMemory[] = [];
  let leadIndex = 0;

  // rows[0] is the header row (Prospect, First Contact Date, Source, Call,
  // Email, Tour, Lease, Key Notes) — data starts at rows[1].
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const prospectCell = (row[0] ?? "").trim();
    const notesCell = (row[7] ?? "").trim();

    const isContinuation = prospectCell === "" && (row[1] ?? "").trim() === "" && notesCell !== "";
    if (isContinuation && memory.length > 0) {
      // Merge verbatim into the previous lead's memory entry — never
      // summarized or otherwise modified.
      memory[memory.length - 1].content += `\n${notesCell}`;
      continue;
    }
    if (prospectCell === "") continue; // fully blank row

    leadIndex++;
    const sheetLineRef = `TRAFFIC_DETAIL#${leadIndex}`;
    leads.push({
      firstContactDate: parseSourceDate(row[1] ?? "") ?? "",
      sourceChannel: (row[2] ?? "").trim() || null,
      called: (row[3] ?? "").trim() === "✓",
      emailed: (row[4] ?? "").trim() === "✓",
      toured: (row[5] ?? "").trim() === "✓",
      leased: (row[6] ?? "").trim() === "✓",
      sheetLineRef,
    });
    if (notesCell !== "") {
      memory.push({ memoryType: "traffic_note", sourceRef: sheetLineRef, content: notesCell });
    } else {
      // Placeholder so a later continuation row (rare, but seen in the real
      // data) has something to append to even if the lead's own row had no notes.
      memory.push({ memoryType: "traffic_note", sourceRef: sheetLineRef, content: "" });
    }
  }

  // Drop any placeholder memory entries that never got real content.
  return { leads, memory: memory.filter((m) => m.content.trim() !== "") };
}

function parseInventory(rows: string[][]): CanonicalInventoryRow[] {
  const bedCountFromType = (type: string): number => {
    const m = /(\d+)\s*bdr/i.exec(type);
    return m ? Number(m[1]) : 0;
  };
  return rows.slice(1)
    .filter((row) => (row[0] ?? "").trim() !== "")
    .map((row) => ({
      unitNumber: (row[0] ?? "").trim(),
      typeCode: (row[4] ?? row[2] ?? "").trim(),   // combined code (e.g. 'A1R'), falling back to the base reference code
      bedCount: bedCountFromType((row[1] ?? "").trim()),
      riverSide: (row[3] ?? "").trim().toUpperCase() === "R",
      description: (row[5] ?? "").trim() || null,
    }));
}

// SUMMARY!row0 reads e.g. "RIVER RUN ACTIVITY - For Week Ending:" — the
// property name is genuinely extracted from the workbook's own content
// here, never assumed, so V1 (workbook belongs to the expected property) is
// a real check rather than comparing a hardcoded value against itself.
// Everything from " ACTIVITY" onward (including whatever boilerplate
// follows the dash — confirmed to vary/extend beyond just "ACTIVITY -" in
// the real file) is the workbook FORMAT's own convention (property-
// agnostic); only the leading text varies by property, so only that's kept.
function extractPropertyName(headerCell: string): string {
  const m = /^(.+?)\s+ACTIVITY\b/i.exec(headerCell.trim());
  return (m ? m[1] : headerCell).trim();
}

export const weeklySummaryAdapter: SourceAdapter = {
  sourceType: "weekly_summary",

  async parse(file: SourceFileHandle, config: IngestionConfig): Promise<CanonicalPayload> {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(file.bytes, { type: "array" });

    const summaryRows = await sheetRows(workbook, "SUMMARY");
    const availabilityRows = await sheetRows(workbook, "Unit Availability Details");
    const trafficRows = await sheetRows(workbook, "Traffic Detail");
    const inventoryRows = await sheetRows(workbook, "Inventory");

    const parseWarnings: ParseWarning[] = [];

    // Reporting week from SUMMARY!row0's date cell (col index 4, e.g. "7/26/26") —
    // read from the workbook's own content, cross-checked against
    // config.reportingPeriodEnd downstream (V2), never inferred from the file name.
    const reportingWeek = parseSourceDate(summaryRows[0]?.[4] ?? "") ?? "";
    const propertyName = extractPropertyName(summaryRows[0]?.[0] ?? "");

    const { sections, missingLabels } = scanSummarySections(summaryRows);
    for (const label of missingLabels) {
      parseWarnings.push({
        ruleCode: "V4_MISSING_SECTION", severity: "warning",
        message: `SUMMARY section "${label}" not found`,
      });
    }

    // Built before parsing NEW RENTALS so a "-"-Line row there can be
    // classified as cancelled_or_denied when the same unit shows up here —
    // independent of section iteration order.
    const cancelsSection = sections.find((s) => s.label === "CANCELS/DENIAL");
    const cancelledUnits = new Set(
      (cancelsSection?.dataRows ?? []).map((row) => (row[1] ?? "").trim()).filter((u) => u !== ""),
    );

    const leasingTransactions = sections.flatMap((s) => parseSummarySection(s, parseWarnings, cancelledUnits));
    const { records: exposureRecords, grandTotalCount: exposureGrandTotalCount } = parseUnitAvailability(availabilityRows, parseWarnings, config);
    const { leads: trafficLeads, memory: operationalMemory } = parseTrafficDetail(trafficRows);
    const inventory = parseInventory(inventoryRows);

    if (inventoryRows.length === 0) {
      parseWarnings.push({ ruleCode: "V_INVENTORY_MISSING", severity: "warning", message: "Inventory sheet missing or empty" });
    }

    return {
      reportingWeek,
      propertyName,
      leasingTransactions,
      exposureRecords,
      exposureGrandTotalCount,
      trafficLeads,
      operationalMemory,
      inventoryRows: inventory,
      parseWarnings,
    };
  },
};

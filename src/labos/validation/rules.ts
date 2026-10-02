import type { CanonicalPayload, ValidationResult } from "../types";
import type { IngestionConfig } from "../config";

// Reconciles two sources into the full Validation Matrix (V1-V14):
//  - parse-time issues the adapter already detected (V4 missing section,
//    V6 exposure-total mismatch, V10 placeholder rows, V12 simultaneous
//    move-in/move-out) are passed through as-is;
//  - payload-level checks that need the whole payload, the caller's
//    IngestionConfig, or the source file's own metadata, are computed here
//    (V1, V2, V5, V8, V9, V11, V14).
// V7 (duplicate reporting-week load) is NOT here — it needs the repository
// to know what's already been loaded, so it lives in the Sync Run
// orchestrator, not this pure function.
//
// config.propertyName/reportingPeriodEnd are the authoritative expectation —
// the workbook's own content is validated against them (V1, V2). The file
// name is never treated as authoritative for either; V14 only uses it for a
// non-blocking human-error sanity check.

export interface ValidationInput {
  payload: CanonicalPayload;
  sourceFileName: string;
  sourceLastModifiedAt: string;   // ISO timestamp
  config: IngestionConfig;
}

const FILE_NAME_DATE = /(\d{4})\.(\d{2})\.(\d{2})/;
const FORBIDDEN_IDENTITY_KEYS = ['"residentRef"', '"prospectRef"', '"residentName"', '"prospectName"'];

export function validateCanonicalPayload(input: ValidationInput): ValidationResult[] {
  const { payload, sourceFileName, sourceLastModifiedAt, config } = input;
  const results: ValidationResult[] = [...payload.parseWarnings];

  if (payload.propertyName.toLowerCase() !== config.propertyName.toLowerCase()) {
    results.push({
      ruleCode: "V1_WRONG_PROPERTY", severity: "blocking",
      message: `Workbook is for "${payload.propertyName}", expected "${config.propertyName}"`,
    });
  }

  if (!payload.reportingWeek) {
    results.push({
      ruleCode: "V2_REPORTING_WEEK_MISSING", severity: "blocking",
      message: "Could not determine reporting week from the SUMMARY sheet",
    });
  } else if (payload.reportingWeek !== config.reportingPeriodEnd) {
    results.push({
      ruleCode: "V2_REPORTING_WEEK_MISMATCH", severity: "blocking",
      message: `Workbook's in-sheet date (${payload.reportingWeek}) does not match the requested reporting period (${config.reportingPeriodEnd})`,
    });
  }

  // Non-blocking sanity check only — the file name is never authoritative,
  // but a human picking the wrong file is a real, worth-catching mistake.
  const fileNameMatch = FILE_NAME_DATE.exec(sourceFileName);
  if (fileNameMatch) {
    const fileNameDate = `${fileNameMatch[1]}-${fileNameMatch[2]}-${fileNameMatch[3]}`;
    if (fileNameDate !== config.reportingPeriodEnd) {
      results.push({
        ruleCode: "V14_FILENAME_PERIOD_MISMATCH", severity: "warning",
        message: `File name date (${fileNameDate}) does not match the requested reporting period (${config.reportingPeriodEnd}) — confirm this is the intended file`,
      });
    }
  }

  for (const lead of payload.trafficLeads) {
    if (!lead.firstContactDate) {
      results.push({
        ruleCode: "V5_MISSING_FIRST_CONTACT_DATE", severity: "blocking",
        message: `Traffic lead ${lead.sheetLineRef} is missing a required First Contact Date`,
        context: { sheetLineRef: lead.sheetLineRef },
      });
    }
  }

  const knownUnits = new Set(payload.inventoryRows.map((r) => r.unitNumber));
  // Waitlist placeholders were already classified (and warned about, via
  // V13_WAITLIST_PLACEHOLDER_EXCLUDED) as not being physical units — they
  // must not also trigger V9, which is specifically about units purporting
  // to be real leases.
  const referencedUnits = new Set([
    ...payload.leasingTransactions.filter((t) => t.exclusionReason !== "waitlist_placeholder").map((t) => t.unitNumber),
    ...payload.exposureRecords.map((e) => e.unitNumber),
  ]);
  for (const unit of referencedUnits) {
    if (!knownUnits.has(unit)) {
      results.push({
        ruleCode: "V9_UNIT_NOT_IN_INVENTORY", severity: "warning",
        message: `Unit ${unit} not found in Inventory — will be loaded with no floorplan`,
        context: { unitNumber: unit },
      });
    }
  }

  // Heuristic staleness check — not an exact business rule, just a useful signal.
  if (payload.reportingWeek) {
    const reportingDate = new Date(`${payload.reportingWeek}T00:00:00Z`);
    const modifiedDate = new Date(sourceLastModifiedAt);
    const diffDays = (modifiedDate.getTime() - reportingDate.getTime()) / 86_400_000;
    if (diffDays < 0) {
      results.push({
        ruleCode: "V8_SOURCE_PREDATES_REPORTING_WEEK", severity: "warning",
        message: `Source file's last-modified date is before its own reporting week (${diffDays.toFixed(1)} days earlier)`,
      });
    } else if (diffDays > 7) {
      results.push({
        ruleCode: "V8_SOURCE_STALE", severity: "warning",
        message: `Source file's last-modified date is ${diffDays.toFixed(1)} days after its reporting week — confirm this is really this week's file`,
      });
    }
  }

  // Defense-in-depth, not content scanning: Key Notes text is approved to be
  // stored verbatim and may reference names within it — this only guards
  // against a resident/prospect *identity field* ever appearing on the
  // canonical payload itself, which the types already forbid at compile time.
  const serialized = JSON.stringify(payload);
  for (const key of FORBIDDEN_IDENTITY_KEYS) {
    if (serialized.includes(key)) {
      results.push({
        ruleCode: "V11_IDENTITY_FIELD_PRESENT", severity: "blocking",
        message: `Canonical payload unexpectedly contains a resident/prospect identity field (${key})`,
      });
    }
  }

  return results;
}

export function hasBlockingResult(results: ValidationResult[]): boolean {
  return results.some((r) => r.severity === "blocking");
}

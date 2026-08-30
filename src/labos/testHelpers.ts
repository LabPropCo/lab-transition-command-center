import type { CanonicalLeasingTransaction } from "./types";
import type { IngestionConfig } from "./config";

// Shared test fixture for IngestionConfig — deliberately NOT named after any
// specific real property beyond matching what the existing River Run
// fixtures already assume, so tests that need a *different* property
// (proving the adapter has no embedded assumption) pass their own overrides.
export function testIngestionConfig(overrides: Partial<IngestionConfig> = {}): IngestionConfig {
  return {
    propertyId: "property-test-1",
    propertyName: "River Run",
    reportingPeriodEnd: "2026-07-26",
    workbookPropertyAlias: "riverrun",
    ...overrides,
  };
}

// Shared test fixture builder — every field defaults to the common case
// (a normal, officially-counted transaction) so individual tests only
// specify what's actually relevant to what they're proving.
export function leasingTx(overrides: Partial<CanonicalLeasingTransaction> & Pick<CanonicalLeasingTransaction, "eventType" | "unitNumber" | "sheetLineRef">): CanonicalLeasingTransaction {
  return {
    rent: null,
    effectiveDate: null,
    expirationDate: null,
    moveDate: null,
    priorRent: null,
    leaseTerm: null,
    hasReason: false,
    lineLabel: "1",
    isOfficialKpi: true,
    exclusionReason: null,
    ...overrides,
  };
}

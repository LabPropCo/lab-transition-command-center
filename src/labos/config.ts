// Explicit property/period context for one ingestion run. Nothing in the
// adapter or Sync Run orchestrator may embed a property identity or
// reporting period — both must come from here, supplied by the caller
// (a CLI flag, a future Sync Now UI selection, a scheduled job's own
// config). There is no default; a config must always be constructed
// explicitly, and there is no fallback if a required field is missing.
export interface IngestionConfig {
  // The property's real database identity — resolved ahead of time (e.g. via
  // LabosRepository.getOrCreateProperty during a one-time provisioning step,
  // not auto-created as a side effect of ingestion itself).
  propertyId: string;

  // The property's human-readable name, as it should appear in the source
  // workbook. Used to validate the workbook actually belongs to this
  // property (V1) — a real check now that the adapter extracts the
  // workbook's own stated property name rather than assuming it.
  propertyName: string;

  // The reporting week/period this run is expected to ingest (ISO date).
  // Authoritative — the workbook's own in-sheet date is validated against
  // this (V2), not the other way around, and the file name is never parsed
  // for meaning (only kept for the audit trail's file_name column).
  reportingPeriodEnd: string;

  // Yardi's internal property code as it appears inside the workbook's own
  // repeated group-marker text (e.g. "River Run (riverrun)" -> "riverrun").
  // This is a genuine workbook-specific identifier — it doesn't follow a
  // predictable transformation of propertyName for every property, so it's
  // supplied explicitly rather than derived.
  workbookPropertyAlias: string;
}

import type { ValidationResult } from "./types";
import type { NormalizedBatch } from "./normalize";

// The database boundary. Every method the Sync Run orchestrator needs lives
// here — orchestration and business logic (normalize.ts, validation/rules.ts,
// syncRun.ts) depend ONLY on this interface, never on supabase-js or any
// other concrete storage detail. repository.mock.ts (in-memory, used for all
// testing right now) and repository.supabase.ts (the real implementation,
// type-checked but not yet executed against a live database — see
// docs/RIVER-RUN-MILESTONE-1-BUILD-PLAN.md's Database Verification
// Checklist) both implement this same contract, so swapping one for the
// other never touches orchestration code.

export type SyncRunStatus =
  | "pending" | "discovering" | "parsing" | "validating" | "blocked"
  | "normalizing" | "loading" | "completed" | "failed";

export interface SyncRunRecord {
  id: string;
  propertyId: string;
  reportingWeek: string;
  status: SyncRunStatus;
  triggeredBy: string;
  triggeredAt: string;
  completedAt: string | null;
  supersededBy: string | null;
}

export type SourceType = "weekly_summary" | "trend_workbook" | "portfolio_survey";

export interface SourceFileInput {
  sourceType: SourceType;
  fileName: string;
  driveFileId: string | null;
  lastModifiedAt: string | null;
  contentHash: string | null;
}

export interface EntityCounts {
  leasingTransactions: number;
  exposureRecords: number;
  trafficLeads: number;
  operationalMemory: number;
}

// Which specific database operations a Sync Run needs, and why — checked
// via Postgres's own privilege-introspection functions (has_schema_privilege
// /has_table_privilege against current_user), never inferred from which key
// or credential type was used to construct the repository. The database's
// actual grants/RLS state is the only source of truth here.
export interface CapabilityCheck {
  checkName: string;
  granted: boolean;
}

export interface CapabilityCheckResult {
  authorized: boolean;
  checks: CapabilityCheck[];
  missing: string[];
}

export interface LabosRepository {
  // Must be called — and must report authorized — before any Sync Run is
  // created. A failed preflight must never leave a partially-created Sync
  // Run behind; see syncRun.ts, which calls this before createSyncRun.
  checkIngestionCapability(): Promise<CapabilityCheckResult>;

  getOrCreateProperty(name: string): Promise<string>;

  findActiveSyncRun(propertyId: string, reportingWeek: string): Promise<SyncRunRecord | null>;
  createSyncRun(input: { propertyId: string; reportingWeek: string; triggeredBy: string }): Promise<SyncRunRecord>;
  updateSyncRunStatus(id: string, status: SyncRunStatus): Promise<void>;
  supersedeSyncRun(oldRunId: string, newRunId: string, confirmedBy: string): Promise<void>;

  recordSourceFile(syncRunId: string, file: SourceFileInput): Promise<void>;
  recordValidationResults(syncRunId: string, results: ValidationResult[]): Promise<void>;

  // Idempotent: safe to call twice for the same syncRunId (re-running a
  // crashed load must not double-insert — enforced via (sync_run_id,
  // sheet_line_ref) uniqueness in the real schema, and equivalently in the mock).
  loadEntities(syncRunId: string, propertyId: string, batch: NormalizedBatch): Promise<EntityCounts>;

  countEntitiesForSyncRun(syncRunId: string): Promise<EntityCounts>;

  // Rollback path for partial-failure recovery — removes every row tagged
  // with this syncRunId across all entity tables. Never touches another run.
  deleteAllEntitiesForSyncRun(syncRunId: string): Promise<void>;
}

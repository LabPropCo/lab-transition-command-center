import type { CanonicalPayload, SourceAdapter, SourceFileHandle, WeeklyKpiSnapshot } from "./types";
import type { IngestionConfig } from "./config";
import { normalizePayload } from "./normalize";
import { hasBlockingResult, validateCanonicalPayload } from "./validation/rules";
import type {
  CapabilityCheck, EntityCounts, LabosRepository, SyncRunRecord, SyncRunStatus,
} from "./repository";

// The Sync Run state machine (docs/RIVER-RUN-INGESTION-ARCHITECTURE.md
// Section 3a; docs/RIVER-RUN-MILESTONE-1-BUILD-PLAN.md Deliverable 7):
//
//   preflight -+-> (unauthorized: throw, nothing created)
//              |
//              +-> pending -> discovering -> parsing -> validating -+-> blocked   (stop; nothing loaded)
//                                                                    +-> normalizing -> loading -> completed
//                                                                                                    |
//              (any unhandled exception at any stage) -----------------------------------------> failed
//
// Every transition is written through the repository as it happens, so even
// a crash mid-run leaves a real audit trail of how far it got — this
// function never buffers status changes to write "at the end."

// Structured and actionable on purpose — not a generic "permission denied."
// Names exactly which checks failed, so whoever's debugging a deployment
// knows immediately whether it's a missing grant, a missing schema exposure,
// or the migration itself not having been applied yet.
export class IngestionAuthorizationError extends Error {
  readonly missing: string[];
  readonly checks: CapabilityCheck[];
  constructor(missing: string[], checks: CapabilityCheck[]) {
    super(
      `Cannot start Sync Run: insufficient database privileges — missing: ${missing.join(", ") || "(no capability checks were returned at all)"}. `
      + "Verify the repository was constructed with a properly-authorized service-role client, that the labos schema's grants "
      + "(migration 0030) and the capability-check function (migration 0031) have both been applied to this database.",
    );
    this.name = "IngestionAuthorizationError";
    this.missing = missing;
    this.checks = checks;
  }
}

export interface RunSyncInput {
  adapter: SourceAdapter;
  file: SourceFileHandle;
  // Property/period identity, supplied explicitly by the caller — never
  // inferred from the file name, never defaulted. config.propertyId must
  // already be a real, provisioned property id (see LabosRepository.
  // getOrCreateProperty, called by the caller ahead of time, not by runSync).
  config: IngestionConfig;
  triggeredBy: string;
  // Presence = explicit confirmation to supersede an existing completed run
  // for the same reporting week. Absence + an existing run = blocked (V7),
  // never a silent overwrite.
  overwriteConfirmedBy?: string;
}

export interface RunSyncResult {
  syncRun: SyncRunRecord;
  validationResults: import("./types").ValidationResult[];
  entityCounts: EntityCounts | null;
  weeklyKpiSnapshot: WeeklyKpiSnapshot | null;
  summary: string;
}

export async function runSync(repo: LabosRepository, input: RunSyncInput): Promise<RunSyncResult> {
  // Preflight FIRST, before anything is created — an unauthorized caller
  // must never leave even a partial Sync Run row behind.
  const capability = await repo.checkIngestionCapability();
  if (!capability.authorized) {
    throw new IngestionAuthorizationError(capability.missing, capability.checks);
  }

  const { config } = input;
  const propertyId = config.propertyId;

  const syncRun = await repo.createSyncRun({ propertyId, reportingWeek: config.reportingPeriodEnd, triggeredBy: input.triggeredBy });

  await setStatus(repo, syncRun, "discovering");
  await repo.recordSourceFile(syncRun.id, {
    sourceType: input.adapter.sourceType,
    fileName: input.file.fileName,
    driveFileId: input.file.driveFileId,
    lastModifiedAt: input.file.lastModifiedAt,
    contentHash: null,
  });

  let payload: CanonicalPayload;
  try {
    await setStatus(repo, syncRun, "parsing");
    payload = await input.adapter.parse(input.file, config);
  } catch (err) {
    await setStatus(repo, syncRun, "failed");
    throw err;
  }

  await setStatus(repo, syncRun, "validating");
  const validationResults = validateCanonicalPayload({
    payload,
    sourceFileName: input.file.fileName,
    sourceLastModifiedAt: input.file.lastModifiedAt ?? new Date().toISOString(),
    config,
  });

  // V7 needs the repository (what's already been loaded), so it's computed
  // here rather than inside the pure validation function.
  const activeRun = await repo.findActiveSyncRun(propertyId, payload.reportingWeek);
  if (activeRun && !input.overwriteConfirmedBy) {
    validationResults.push({
      ruleCode: "V7_DUPLICATE_REPORTING_WEEK", severity: "blocking",
      message: `An active completed Sync Run already exists for ${payload.reportingWeek} (run ${activeRun.id}) — explicit overwrite confirmation required to supersede it`,
      context: { existingSyncRunId: activeRun.id },
    });
  }

  await repo.recordValidationResults(syncRun.id, validationResults);

  if (hasBlockingResult(validationResults)) {
    await setStatus(repo, syncRun, "blocked");
    const blockedRun = { ...syncRun, status: "blocked" as const };
    return {
      syncRun: blockedRun, validationResults, entityCounts: null, weeklyKpiSnapshot: null,
      summary: summarize(blockedRun, validationResults, null, null),
    };
  }

  await setStatus(repo, syncRun, "normalizing");
  const batch = normalizePayload(payload);

  let entityCounts: EntityCounts;
  try {
    await setStatus(repo, syncRun, "loading");
    entityCounts = await repo.loadEntities(syncRun.id, propertyId, batch);
  } catch (err) {
    // Partial-failure rollback: never leave a half-loaded run looking active.
    await repo.deleteAllEntitiesForSyncRun(syncRun.id);
    await setStatus(repo, syncRun, "failed");
    throw err;
  }

  if (activeRun && input.overwriteConfirmedBy) {
    await repo.supersedeSyncRun(activeRun.id, syncRun.id, input.overwriteConfirmedBy);
  }

  await setStatus(repo, syncRun, "completed");
  const completedRun = { ...syncRun, status: "completed" as const };
  return {
    syncRun: completedRun, validationResults, entityCounts,
    weeklyKpiSnapshot: batch.weeklyKpiSnapshot,
    summary: summarize(completedRun, validationResults, entityCounts, batch.weeklyKpiSnapshot),
  };
}

async function setStatus(repo: LabosRepository, run: SyncRunRecord, status: SyncRunStatus): Promise<void> {
  await repo.updateSyncRunStatus(run.id, status);
  run.status = status;
}

function summarize(
  run: SyncRunRecord, results: import("./types").ValidationResult[],
  counts: EntityCounts | null, kpi: WeeklyKpiSnapshot | null,
): string {
  const blocking = results.filter((r) => r.severity === "blocking").length;
  const warnings = results.filter((r) => r.severity === "warning").length;
  const info = results.filter((r) => r.severity === "info").length;
  const lines = [
    `Sync Run ${run.id} — reporting week ${run.reportingWeek} — ${run.status.toUpperCase()}`,
    `Validation: ${blocking} blocking, ${warnings} warning, ${info} info`,
  ];
  if (counts) {
    lines.push(
      `Loaded: ${counts.leasingTransactions} leasing transactions, ${counts.exposureRecords} exposure records, `
      + `${counts.trafficLeads} traffic leads, ${counts.operationalMemory} operational memory entries`,
    );
  } else {
    lines.push("Nothing loaded — run stopped at validation.");
  }
  if (kpi) {
    lines.push(
      `KPIs: new rentals ${kpi.newRentalsCount} (official) + ${kpi.newRentalsExcludedCount} (excluded, audit-only), `
      + `move-ins ${kpi.moveInsCount}, move-outs ${kpi.moveOutsCount}, notices ${kpi.noticesCount}, `
      + `renewals ${kpi.renewalsCount}, cancels/denials ${kpi.cancelsDenialsCount}, walk-ins ${kpi.walkInsCount}, `
      + `current exposure ${kpi.currentExposureCount}`,
    );
  }
  return lines.join("\n");
}

import type { MockLabosRepository } from "./repository.mock";
import type { SyncRunRecord, SyncRunStatus } from "./repository";
import type { ValidationResult, WeeklyKpiSnapshot } from "./types";

// Thin read layer for the Phase 5 Sync Review screen. Deliberately reads the
// mock repository's own state directly rather than inventing a general
// "LabosReadRepository" interface — this is Milestone 1's minimal internal
// control surface, not the eventual Property Dashboard's data layer. That
// generalization is a real future need, not something to build ahead of a
// second consumer actually needing it.

export interface ExcludedNewRental {
  unitNumber: string;
  lineLabel: string;
  exclusionReason: string | null;
  rent: number | null;
}

export interface SyncRunDetail {
  syncRun: SyncRunRecord | null;
  sourceFile: { fileName: string; lastModifiedAt: string | null; sourceType: string } | null;
  validationResults: ValidationResult[];
  entityCounts: { leasingTransactions: number; exposureRecords: number; trafficLeads: number; operationalMemory: number };
  weeklyKpiSnapshot: WeeklyKpiSnapshot | null;
  excludedNewRentals: ExcludedNewRental[];
  auditHistory: { syncRunId: string; status: SyncRunStatus; triggeredBy: string; triggeredAt: string; supersededBy: string | null }[];
}

export function getSyncRunDetail(repo: MockLabosRepository, syncRunId: string): SyncRunDetail {
  const syncRun = repo.syncRuns.get(syncRunId) ?? null;
  const sourceFileRow = repo.sourceFiles.find((f) => f.syncRunId === syncRunId);
  const validationResults = repo.validationResults
    .filter((r) => r.syncRunId === syncRunId)
    .map(({ syncRunId: _drop, ...r }) => r);

  const leasingRows = repo.leasingTransactions.filter((r) => r.syncRunId === syncRunId);
  const excludedNewRentals: ExcludedNewRental[] = leasingRows
    .filter((r) => r.eventType === "new_rental" && !r.isOfficialKpi)
    .map((r) => ({ unitNumber: r.unitNumber, lineLabel: r.lineLabel, exclusionReason: r.exclusionReason, rent: r.rent }));

  const kpiRow = repo.weeklyKpiSnapshots.find((k) => k.syncRunId === syncRunId);

  // Audit history: every run (superseded or active) for the same property + week.
  const auditHistory = syncRun
    ? [...repo.syncRuns.values()]
        .filter((r) => r.propertyId === syncRun.propertyId && r.reportingWeek === syncRun.reportingWeek)
        .sort((a, b) => a.triggeredAt.localeCompare(b.triggeredAt))
        .map((r) => ({ syncRunId: r.id, status: r.status, triggeredBy: r.triggeredBy, triggeredAt: r.triggeredAt, supersededBy: r.supersededBy }))
    : [];

  return {
    syncRun,
    sourceFile: sourceFileRow
      ? { fileName: sourceFileRow.fileName, lastModifiedAt: sourceFileRow.lastModifiedAt, sourceType: sourceFileRow.sourceType }
      : null,
    validationResults,
    entityCounts: {
      leasingTransactions: leasingRows.length,
      exposureRecords: repo.exposureRecords.filter((r) => r.syncRunId === syncRunId).length,
      trafficLeads: repo.trafficLeads.filter((r) => r.syncRunId === syncRunId).length,
      operationalMemory: repo.operationalMemory.filter((r) => r.syncRunId === syncRunId).length,
    },
    weeklyKpiSnapshot: kpiRow
      ? {
          reportingWeek: kpiRow.reportingWeek, newRentalsCount: kpiRow.newRentalsCount,
          newRentalsExcludedCount: kpiRow.newRentalsExcludedCount, moveInsCount: kpiRow.moveInsCount,
          moveOutsCount: kpiRow.moveOutsCount, noticesCount: kpiRow.noticesCount, renewalsCount: kpiRow.renewalsCount,
          cancelsDenialsCount: kpiRow.cancelsDenialsCount, walkInsCount: kpiRow.walkInsCount,
          currentExposureCount: kpiRow.currentExposureCount,
        }
      : null,
    excludedNewRentals,
    auditHistory,
  };
}

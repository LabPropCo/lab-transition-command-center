import type { ValidationResult } from "./types";
import type { NormalizedBatch } from "./normalize";
import type {
  CapabilityCheckResult, EntityCounts, LabosRepository, SourceFileInput, SyncRunRecord, SyncRunStatus,
} from "./repository";

const FULLY_AUTHORIZED: CapabilityCheckResult = {
  authorized: true,
  checks: [
    "schema_usage", "sync_runs_select", "sync_runs_insert", "sync_runs_update",
    "leasing_transactions_insert", "operational_memory_insert",
  ].map((checkName) => ({ checkName, granted: true })),
  missing: [],
};

// In-memory implementation of LabosRepository — used for all Milestone 1
// testing. No network, no real database, nothing here proves the actual
// Postgres migrations execute correctly (see the Database Verification
// Checklist in docs/RIVER-RUN-MILESTONE-1-BUILD-PLAN.md for what remains
// unproven until the migrations are applied to a real test database). What
// this DOES prove: every piece of orchestration/business logic that sits on
// top of the repository interface — idempotency, rollback, state
// transitions, audit-trail writes — behaves correctly against the exact
// contract the real Supabase implementation must also honor.

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

interface StoredExposureRecord {
  syncRunId: string; unitNumber: string; status: string; isSkip: boolean;
  daysVacant: number | null; makeReadyDate: string | null; moveInDate: string | null;
  noticeDate: string | null; moveOutDate: string | null; isUnrented: boolean;
}
interface StoredLeasingTransaction {
  syncRunId: string; sheetLineRef: string; unitNumber: string; eventType: string;
  rent: number | null; effectiveDate: string | null; expirationDate: string | null;
  moveDate: string | null; priorRent: number | null; leaseTerm: string | null; hasReason: boolean;
  lineLabel: string; isOfficialKpi: boolean; exclusionReason: string | null;
}
interface StoredTrafficLead {
  syncRunId: string; sheetLineRef: string; firstContactDate: string; sourceChannel: string | null;
  called: boolean; emailed: boolean; toured: boolean; leased: boolean;
}
interface StoredOperationalMemory {
  syncRunId: string; memoryType: string; sourceRef: string | null; content: string;
}
interface StoredWeeklyKpiSnapshot {
  syncRunId: string; reportingWeek: string;
  newRentalsCount: number; newRentalsExcludedCount: number; moveInsCount: number; moveOutsCount: number; noticesCount: number;
  renewalsCount: number; cancelsDenialsCount: number; walkInsCount: number; currentExposureCount: number;
}

export class MockLabosRepository implements LabosRepository {
  properties = new Map<string, string>();                    // name -> id
  units = new Map<string, string>();                         // `${propertyId}:${unitNumber}` -> id
  floorplans = new Map<string, string>();                    // `${propertyId}:${typeCode}` -> id
  syncRuns = new Map<string, SyncRunRecord>();
  sourceFiles: (SourceFileInput & { syncRunId: string })[] = [];
  validationResults: (ValidationResult & { syncRunId: string })[] = [];
  leasingTransactions: StoredLeasingTransaction[] = [];
  exposureRecords: StoredExposureRecord[] = [];
  trafficLeads: StoredTrafficLead[] = [];
  operationalMemory: StoredOperationalMemory[] = [];
  weeklyKpiSnapshots: StoredWeeklyKpiSnapshot[] = [];

  // Test-configurable — defaults to fully authorized so every existing test
  // exercises the real pipeline without having to think about the preflight.
  // Tests that specifically prove denial behavior override this directly.
  simulatedCapability: CapabilityCheckResult = FULLY_AUTHORIZED;

  async checkIngestionCapability(): Promise<CapabilityCheckResult> {
    return this.simulatedCapability;
  }

  async getOrCreateProperty(name: string): Promise<string> {
    const existing = this.properties.get(name);
    if (existing) return existing;
    const id = nextId("property");
    this.properties.set(name, id);
    return id;
  }

  async findActiveSyncRun(propertyId: string, reportingWeek: string): Promise<SyncRunRecord | null> {
    for (const run of this.syncRuns.values()) {
      if (run.propertyId === propertyId && run.reportingWeek === reportingWeek
        && run.status === "completed" && run.supersededBy === null) {
        return run;
      }
    }
    return null;
  }

  async createSyncRun(input: { propertyId: string; reportingWeek: string; triggeredBy: string }): Promise<SyncRunRecord> {
    const run: SyncRunRecord = {
      id: nextId("sync-run"),
      propertyId: input.propertyId,
      reportingWeek: input.reportingWeek,
      status: "pending",
      triggeredBy: input.triggeredBy,
      triggeredAt: new Date().toISOString(),
      completedAt: null,
      supersededBy: null,
    };
    this.syncRuns.set(run.id, run);
    return run;
  }

  async updateSyncRunStatus(id: string, status: SyncRunStatus): Promise<void> {
    const run = this.syncRuns.get(id);
    if (!run) throw new Error(`Unknown sync run ${id}`);
    run.status = status;
    if (status === "completed" || status === "failed" || status === "blocked") {
      run.completedAt = new Date().toISOString();
    }
  }

  async supersedeSyncRun(oldRunId: string, newRunId: string): Promise<void> {
    const old = this.syncRuns.get(oldRunId);
    if (!old) throw new Error(`Unknown sync run ${oldRunId}`);
    old.supersededBy = newRunId;
  }

  async recordSourceFile(syncRunId: string, file: SourceFileInput): Promise<void> {
    this.sourceFiles.push({ ...file, syncRunId });
  }

  async recordValidationResults(syncRunId: string, results: ValidationResult[]): Promise<void> {
    for (const r of results) this.validationResults.push({ ...r, syncRunId });
  }

  private resolveUnit(propertyId: string, unitNumber: string, typeCode: string | null): string {
    const unitKey = `${propertyId}:${unitNumber}`;
    let unitId = this.units.get(unitKey);
    if (!unitId) {
      unitId = nextId("unit");
      this.units.set(unitKey, unitId);
    }
    if (typeCode) {
      const floorplanKey = `${propertyId}:${typeCode}`;
      if (!this.floorplans.has(floorplanKey)) this.floorplans.set(floorplanKey, nextId("floorplan"));
    }
    return unitId;
  }

  async loadEntities(syncRunId: string, propertyId: string, batch: NormalizedBatch): Promise<EntityCounts> {
    const typeCodeByUnit = new Map(batch.inventoryRows.map((r) => [r.unitNumber, r.typeCode]));
    for (const row of batch.inventoryRows) this.resolveUnit(propertyId, row.unitNumber, row.typeCode);
    for (const t of batch.leasingTransactions) this.resolveUnit(propertyId, t.unitNumber, typeCodeByUnit.get(t.unitNumber) ?? null);
    for (const e of batch.exposureRecords) this.resolveUnit(propertyId, e.unitNumber, typeCodeByUnit.get(e.unitNumber) ?? null);

    // Idempotent: keyed upsert, matching the real schema's unique constraints
    // exactly, so a retried load of the same sync run never double-inserts.
    for (const t of batch.leasingTransactions) {
      const idx = this.leasingTransactions.findIndex((r) => r.syncRunId === syncRunId && r.sheetLineRef === t.sheetLineRef);
      const row: StoredLeasingTransaction = { syncRunId, ...t };
      if (idx >= 0) this.leasingTransactions[idx] = row; else this.leasingTransactions.push(row);
    }
    for (const e of batch.exposureRecords) {
      const idx = this.exposureRecords.findIndex((r) => r.syncRunId === syncRunId && r.unitNumber === e.unitNumber);
      const row: StoredExposureRecord = { syncRunId, ...e };
      if (idx >= 0) this.exposureRecords[idx] = row; else this.exposureRecords.push(row);
    }
    for (const l of batch.trafficLeads) {
      const idx = this.trafficLeads.findIndex((r) => r.syncRunId === syncRunId && r.sheetLineRef === l.sheetLineRef);
      const row: StoredTrafficLead = { syncRunId, ...l };
      if (idx >= 0) this.trafficLeads[idx] = row; else this.trafficLeads.push(row);
    }
    for (const m of batch.operationalMemory) {
      const idx = this.operationalMemory.findIndex((r) => r.syncRunId === syncRunId && r.memoryType === m.memoryType && r.sourceRef === m.sourceRef);
      const row: StoredOperationalMemory = { syncRunId, ...m };
      if (idx >= 0) this.operationalMemory[idx] = row; else this.operationalMemory.push(row);
    }
    const kpiIdx = this.weeklyKpiSnapshots.findIndex((r) => r.syncRunId === syncRunId);
    const kpiRow: StoredWeeklyKpiSnapshot = { syncRunId, ...batch.weeklyKpiSnapshot };
    if (kpiIdx >= 0) this.weeklyKpiSnapshots[kpiIdx] = kpiRow; else this.weeklyKpiSnapshots.push(kpiRow);

    return this.countEntitiesForSyncRun(syncRunId);
  }

  async countEntitiesForSyncRun(syncRunId: string): Promise<EntityCounts> {
    return {
      leasingTransactions: this.leasingTransactions.filter((r) => r.syncRunId === syncRunId).length,
      exposureRecords: this.exposureRecords.filter((r) => r.syncRunId === syncRunId).length,
      trafficLeads: this.trafficLeads.filter((r) => r.syncRunId === syncRunId).length,
      operationalMemory: this.operationalMemory.filter((r) => r.syncRunId === syncRunId).length,
    };
  }

  async deleteAllEntitiesForSyncRun(syncRunId: string): Promise<void> {
    this.leasingTransactions = this.leasingTransactions.filter((r) => r.syncRunId !== syncRunId);
    this.exposureRecords = this.exposureRecords.filter((r) => r.syncRunId !== syncRunId);
    this.trafficLeads = this.trafficLeads.filter((r) => r.syncRunId !== syncRunId);
    this.operationalMemory = this.operationalMemory.filter((r) => r.syncRunId !== syncRunId);
    this.weeklyKpiSnapshots = this.weeklyKpiSnapshots.filter((r) => r.syncRunId !== syncRunId);
  }
}

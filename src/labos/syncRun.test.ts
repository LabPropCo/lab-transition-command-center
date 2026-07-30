import { beforeEach, describe, expect, it } from "vitest";
import type { CanonicalPayload, SourceAdapter, SourceFileHandle } from "./types";
import { MockLabosRepository } from "./repository.mock";
import { IngestionAuthorizationError, runSync } from "./syncRun";
import { leasingTx, testIngestionConfig } from "./testHelpers";

function cleanPayload(reportingWeek: string): CanonicalPayload {
  return {
    reportingWeek,
    propertyName: "River Run",
    leasingTransactions: [
      leasingTx({ eventType: "new_rental", unitNumber: "E304", rent: 3495, leaseTerm: "LT", sheetLineRef: "SUMMARY!NEW_RENTALS#1" }),
      leasingTx({
        eventType: "new_rental", unitNumber: "WAITC1", sheetLineRef: "SUMMARY!NEW_RENTALS#2",
        lineLabel: "-", isOfficialKpi: false, exclusionReason: "waitlist_placeholder",
      }),
    ],
    exposureRecords: [
      { unitNumber: "F304", status: "vacant_unrented", isSkip: false, daysVacant: 26, makeReadyDate: null, moveInDate: null, noticeDate: null, moveOutDate: null },
    ],
    exposureGrandTotalCount: 1,
    trafficLeads: [
      { firstContactDate: "2026-07-20", sourceChannel: "Zillow", called: true, emailed: false, toured: false, leased: false, sheetLineRef: "TRAFFIC_DETAIL#1" },
    ],
    operationalMemory: [
      { memoryType: "traffic_note", sourceRef: "TRAFFIC_DETAIL#1", content: "Auto-linked Call." },
    ],
    inventoryRows: [
      { unitNumber: "E304", typeCode: "C1R", bedCount: 2, riverSide: true, description: "2 BED RIVER" },
      { unitNumber: "F304", typeCode: "A1R", bedCount: 1, riverSide: true, description: "1 BED RIVER" },
    ],
    parseWarnings: [],
  };
}

function fakeAdapter(payload: CanonicalPayload): SourceAdapter {
  return { sourceType: "weekly_summary", parse: async () => payload };
}

function fileHandle(fileName: string): SourceFileHandle {
  return { fileName, lastModifiedAt: "2026-07-26T12:00:00Z", driveFileId: null, bytes: new ArrayBuffer(0) };
}

describe("runSync — state transitions", () => {
  let repo: MockLabosRepository;
  beforeEach(() => { repo = new MockLabosRepository(); });

  it("takes a clean payload all the way to completed", async () => {
    const result = await runSync(repo, {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    });
    expect(result.syncRun.status).toBe("completed");
    expect(result.entityCounts).toEqual({ leasingTransactions: 2, exposureRecords: 1, trafficLeads: 1, operationalMemory: 1 });
    expect(result.summary).toContain("COMPLETED");

    // Excluded rows remain visible for audit — not dropped, just not counted.
    const rows = repo.leasingTransactions.filter((r) => r.syncRunId === result.syncRun.id);
    const counted = rows.find((r) => r.unitNumber === "E304")!;
    const excluded = rows.find((r) => r.unitNumber === "WAITC1")!;
    expect(counted.isOfficialKpi).toBe(true);
    expect(excluded.isOfficialKpi).toBe(false);
    expect(excluded.exclusionReason).toBe("waitlist_placeholder");

    const kpi = repo.weeklyKpiSnapshots.find((k) => k.syncRunId === result.syncRun.id)!;
    expect(kpi.newRentalsCount).toBe(1);
    expect(kpi.newRentalsExcludedCount).toBe(1);
  });

  it("stops at blocked on a validation-breaking payload, loads nothing", async () => {
    const badPayload = cleanPayload("2026-07-19"); // mismatches testIngestionConfig()'s default reportingPeriodEnd (2026-07-26) -> V2
    const result = await runSync(repo, {
      adapter: fakeAdapter(badPayload),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    });
    expect(result.syncRun.status).toBe("blocked");
    expect(result.entityCounts).toBeNull();
    expect(result.validationResults.some((r) => r.ruleCode === "V2_REPORTING_WEEK_MISMATCH")).toBe(true);
    const counts = await repo.countEntitiesForSyncRun(result.syncRun.id);
    expect(counts.leasingTransactions).toBe(0);
  });

  it("records the audit trail — source file and validation results — even when blocked", async () => {
    const badPayload = cleanPayload("2026-07-19");
    const result = await runSync(repo, {
      adapter: fakeAdapter(badPayload),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    });
    expect(repo.sourceFiles.some((f) => f.syncRunId === result.syncRun.id && f.fileName.includes("2026.07.26"))).toBe(true);
    expect(repo.validationResults.filter((r) => r.syncRunId === result.syncRun.id).length).toBeGreaterThan(0);
  });

  it("writes Operational Memory verbatim, linked to the traffic lead it annotates", async () => {
    const result = await runSync(repo, {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    });
    const memory = repo.operationalMemory.find((m) => m.syncRunId === result.syncRun.id)!;
    expect(memory.content).toBe("Auto-linked Call.");
    expect(memory.sourceRef).toBe("TRAFFIC_DETAIL#1");
  });
});

describe("runSync — idempotency and overwrite", () => {
  let repo: MockLabosRepository;
  beforeEach(() => { repo = new MockLabosRepository(); });

  it("blocks a second run for the same reporting week without explicit overwrite confirmation", async () => {
    const first = await runSync(repo, {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    });
    expect(first.syncRun.status).toBe("completed");

    const second = await runSync(repo, {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-2",
    });
    expect(second.syncRun.status).toBe("blocked");
    expect(second.validationResults.some((r) => r.ruleCode === "V7_DUPLICATE_REPORTING_WEEK")).toBe(true);

    // No duplicate rows anywhere — only the first run's data exists.
    const firstCounts = await repo.countEntitiesForSyncRun(first.syncRun.id);
    const secondCounts = await repo.countEntitiesForSyncRun(second.syncRun.id);
    expect(firstCounts.leasingTransactions).toBe(2);
    expect(secondCounts.leasingTransactions).toBe(0);
  });

  it("supersedes the prior run when overwrite is explicitly confirmed, never deleting it", async () => {
    const first = await runSync(repo, {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    });

    const second = await runSync(repo, {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-2",
      overwriteConfirmedBy: "admin-1",
    });

    expect(second.syncRun.status).toBe("completed");
    const supersededFirst = repo.syncRuns.get(first.syncRun.id)!;
    expect(supersededFirst.supersededBy).toBe(second.syncRun.id);
    expect(repo.syncRuns.has(first.syncRun.id)).toBe(true); // never deleted, only marked superseded

    // The active run for that week is now the second one.
    const active = await repo.findActiveSyncRun(testIngestionConfig().propertyId, "2026-07-26");
    expect(active?.id).toBe(second.syncRun.id);
  });
});

describe("runSync — partial-failure rollback and recovery", () => {
  it("rolls back everything already written if loadEntities fails partway, and marks the run failed", async () => {
    class PartiallyFailingRepository extends MockLabosRepository {
      async loadEntities(
        syncRunId: string, _propertyId: string, batch: Parameters<MockLabosRepository["loadEntities"]>[2],
      ): ReturnType<MockLabosRepository["loadEntities"]> {
        // Simulate a real partial write (leasing transactions land) before a
        // failure hits (e.g. a network error inserting traffic leads).
        this.leasingTransactions.push({ syncRunId, ...batch.leasingTransactions[0] });
        throw new Error("simulated write failure");
      }
    }
    const repo = new PartiallyFailingRepository();

    await expect(runSync(repo, {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    })).rejects.toThrow("simulated write failure");

    const syncRunId = [...repo.syncRuns.keys()][0];
    expect(repo.syncRuns.get(syncRunId)!.status).toBe("failed");
    const counts = await repo.countEntitiesForSyncRun(syncRunId);
    expect(counts.leasingTransactions).toBe(0); // rolled back, not left half-loaded
  });

  it("allows a safe rerun for the same week after a failed run", async () => {
    class FailsOnceRepository extends MockLabosRepository {
      private failed = false;
      async loadEntities(...args: Parameters<MockLabosRepository["loadEntities"]>) {
        if (!this.failed) { this.failed = true; throw new Error("transient failure"); }
        return super.loadEntities(...args);
      }
    }
    const repo = new FailsOnceRepository();
    const input = {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    };

    await expect(runSync(repo, input)).rejects.toThrow("transient failure");
    const retry = await runSync(repo, input); // fresh Sync Run, not a retry of the same one
    expect(retry.syncRun.status).toBe("completed");
    expect(retry.entityCounts).toEqual({ leasingTransactions: 2, exposureRecords: 1, trafficLeads: 1, operationalMemory: 1 });
  });
});

describe("runSync — authorization preflight", () => {
  it("proceeds normally when the preflight reports fully authorized (the default)", async () => {
    const repo = new MockLabosRepository();
    const result = await runSync(repo, {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    });
    expect(result.syncRun.status).toBe("completed");
  });

  it("fails clearly on missing schema access, before creating any Sync Run", async () => {
    const repo = new MockLabosRepository();
    repo.simulatedCapability = {
      authorized: false,
      checks: [{ checkName: "schema_usage", granted: false }],
      missing: ["schema_usage"],
    };

    await expect(runSync(repo, {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    })).rejects.toThrow(IngestionAuthorizationError);

    expect(repo.syncRuns.size).toBe(0);
  });

  it("fails clearly on an RLS/table-write denial (schema reachable, insert not granted)", async () => {
    const repo = new MockLabosRepository();
    repo.simulatedCapability = {
      authorized: false,
      checks: [
        { checkName: "schema_usage", granted: true },
        { checkName: "sync_runs_select", granted: true },
        { checkName: "sync_runs_insert", granted: false },
        { checkName: "leasing_transactions_insert", granted: false },
      ],
      missing: ["sync_runs_insert", "leasing_transactions_insert"],
    };

    let thrown: unknown;
    try {
      await runSync(repo, {
        adapter: fakeAdapter(cleanPayload("2026-07-26")),
        file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
        config: testIngestionConfig(), triggeredBy: "user-1",
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(IngestionAuthorizationError);
    expect((thrown as InstanceType<typeof IngestionAuthorizationError>).missing).toEqual(["sync_runs_insert", "leasing_transactions_insert"]);
    expect(repo.syncRuns.size).toBe(0);
  });

  it("fails before any entity writes begin — the adapter is never even invoked", async () => {
    const repo = new MockLabosRepository();
    repo.simulatedCapability = { authorized: false, checks: [], missing: ["schema_usage"] };
    let adapterCalled = false;
    const spyAdapter: SourceAdapter = {
      sourceType: "weekly_summary",
      parse: async () => { adapterCalled = true; return cleanPayload("2026-07-26"); },
    };

    await expect(runSync(repo, {
      adapter: spyAdapter,
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    })).rejects.toThrow(IngestionAuthorizationError);

    expect(adapterCalled).toBe(false);
    expect(repo.leasingTransactions).toHaveLength(0);
    expect(repo.exposureRecords).toHaveLength(0);
  });

  it("leaves no partially-created Sync Run after a failed preflight", async () => {
    const repo = new MockLabosRepository();
    repo.simulatedCapability = { authorized: false, checks: [], missing: ["schema_usage"] };

    await expect(runSync(repo, {
      adapter: fakeAdapter(cleanPayload("2026-07-26")),
      file: fileHandle("River Run Weekly Summary 2026.07.26.xlsx"),
      config: testIngestionConfig(), triggeredBy: "user-1",
    })).rejects.toThrow();

    expect(repo.syncRuns.size).toBe(0);
    expect(repo.sourceFiles).toHaveLength(0);
    expect(repo.validationResults).toHaveLength(0);
  });
});

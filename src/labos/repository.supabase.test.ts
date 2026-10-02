import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedBatch } from "./normalize";
import { SupabaseLabosRepository } from "./repository.supabase";
import { leasingTx } from "./testHelpers";

// A minimal fake of supabase-js's chainable query builder. Every chain
// method records what was called and returns `this`; awaiting the builder
// at any point (directly, or after .single()/.maybeSingle()) resolves via
// the test-supplied handler, which sees the full accumulated call
// description. This proves repository.supabase.ts issues the RIGHT calls
// (table names, onConflict keys, column mapping, error propagation) — it
// does NOT prove Postgres actually executes them; see the Database
// Verification Checklist for what remains unproven until the real
// migrations are applied to a test project.

export interface FakeCall {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  payload?: unknown;
  onConflict?: string;
  filters: { method: string; args: unknown[] }[];
  wantsCount: boolean;
}

type Handler = (call: FakeCall) => { data?: unknown; error?: unknown; count?: number };

class FakeBuilder implements PromiseLike<{ data: unknown; error: unknown; count?: number }> {
  private call: FakeCall;
  constructor(private readonly handler: Handler, table: string, op: FakeCall["op"], payload?: unknown, onConflict?: string) {
    this.call = { table, op, payload, onConflict, filters: [], wantsCount: false };
  }
  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.call.wantsCount = true;
    return this;
  }
  eq(...args: unknown[]) { this.call.filters.push({ method: "eq", args }); return this; }
  is(...args: unknown[]) { this.call.filters.push({ method: "is", args }); return this; }
  single() { return this; }
  maybeSingle() { return this; }
  then<TResult1, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: unknown; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result = this.handler(this.call);
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count }).then(onfulfilled, onrejected);
  }
}

type RpcHandler = (fn: string) => { data?: unknown; error?: unknown };

function fakeClient(handler: Handler, calls: FakeCall[], rpcHandler?: RpcHandler): SupabaseClient {
  const schemaObj = {
    rpc(fn: string) {
      const result = rpcHandler ? rpcHandler(fn) : { data: [] };
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
    from(table: string) {
      return {
        select: (cols?: string, opts?: { count?: string; head?: boolean }) => {
          const b = new FakeBuilder(handler, table, "select");
          calls.push((b as unknown as { call: FakeCall }).call);
          return b.select(cols, opts);
        },
        insert: (payload: unknown) => {
          const b = new FakeBuilder(handler, table, "insert", payload);
          calls.push((b as unknown as { call: FakeCall }).call);
          return b;
        },
        update: (payload: unknown) => {
          const b = new FakeBuilder(handler, table, "update", payload);
          calls.push((b as unknown as { call: FakeCall }).call);
          return b;
        },
        upsert: (payload: unknown, opts?: { onConflict?: string }) => {
          const b = new FakeBuilder(handler, table, "upsert", payload, opts?.onConflict);
          calls.push((b as unknown as { call: FakeCall }).call);
          return b;
        },
        delete: () => {
          const b = new FakeBuilder(handler, table, "delete");
          calls.push((b as unknown as { call: FakeCall }).call);
          return b;
        },
      };
    },
  };
  return { schema: () => schemaObj } as unknown as SupabaseClient;
}

function emptyBatch(overrides: Partial<NormalizedBatch> = {}): NormalizedBatch {
  return {
    reportingWeek: "2026-07-26",
    propertyName: "River Run",
    leasingTransactions: [],
    exposureRecords: [],
    trafficLeads: [],
    operationalMemory: [],
    inventoryRows: [],
    weeklyKpiSnapshot: {
      reportingWeek: "2026-07-26", newRentalsCount: 0, newRentalsExcludedCount: 0, moveInsCount: 0, moveOutsCount: 0,
      noticesCount: 0, renewalsCount: 0, cancelsDenialsCount: 0, walkInsCount: 0, currentExposureCount: 0,
    },
    ...overrides,
  };
}

describe("SupabaseLabosRepository", () => {
  it("getOrCreateProperty inserts when no existing row is found", async () => {
    const calls: FakeCall[] = [];
    let selectCount = 0;
    const client = fakeClient((call) => {
      if (call.table === "properties" && call.op === "select") { selectCount++; return { data: null }; }
      if (call.table === "properties" && call.op === "insert") return { data: { id: "prop-1" } };
      throw new Error(`unexpected call: ${call.table}/${call.op}`);
    }, calls);

    const repo = new SupabaseLabosRepository(client);
    const id = await repo.getOrCreateProperty("River Run");
    expect(id).toBe("prop-1");
    expect(selectCount).toBe(1);
    expect(calls.some((c) => c.table === "properties" && c.op === "insert")).toBe(true);
  });

  it("getOrCreateProperty returns the existing id without inserting", async () => {
    const calls: FakeCall[] = [];
    const client = fakeClient((call) => {
      if (call.table === "properties" && call.op === "select") return { data: { id: "prop-existing" } };
      throw new Error(`unexpected call: ${call.table}/${call.op}`);
    }, calls);

    const repo = new SupabaseLabosRepository(client);
    const id = await repo.getOrCreateProperty("River Run");
    expect(id).toBe("prop-existing");
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("loadEntities upserts leasing_transactions/exposure_records/traffic_leads with the correct onConflict keys", async () => {
    const calls: FakeCall[] = [];
    const client = fakeClient((call) => {
      if (call.table === "floorplans" || call.table === "units") return { data: [] };
      return { data: null, count: 0 };
    }, calls);
    const repo = new SupabaseLabosRepository(client);

    await repo.loadEntities("run-1", "prop-1", emptyBatch({
      leasingTransactions: [leasingTx({ eventType: "new_rental", unitNumber: "E304", rent: 3495, leaseTerm: "LT", sheetLineRef: "a" })],
      exposureRecords: [{ unitNumber: "F304", status: "vacant_unrented", isSkip: false, daysVacant: 1, makeReadyDate: null, moveInDate: null, noticeDate: null, moveOutDate: null, isUnrented: true }],
      trafficLeads: [{ firstContactDate: "2026-07-20", sourceChannel: "Zillow", called: true, emailed: false, toured: false, leased: false, sheetLineRef: "t1" }],
      operationalMemory: [{ memoryType: "traffic_note", sourceRef: "t1", content: "Auto-linked Call." }],
    }));

    const leasingCall = calls.find((c) => c.table === "leasing_transactions" && c.op === "upsert")!;
    expect(leasingCall.onConflict).toBe("sync_run_id,sheet_line_ref");

    const exposureCall = calls.find((c) => c.table === "exposure_records" && c.op === "upsert")!;
    expect(exposureCall.onConflict).toBe("sync_run_id,unit_id");

    const trafficCall = calls.find((c) => c.table === "traffic_leads" && c.op === "upsert")!;
    expect(trafficCall.onConflict).toBe("sync_run_id,sheet_line_ref");

    // Operational memory is append-only (no unique constraint) — a plain insert, not an upsert.
    const memoryCall = calls.find((c) => c.table === "operational_memory")!;
    expect(memoryCall.op).toBe("insert");

    const kpiCall = calls.find((c) => c.table === "weekly_kpi_snapshots")!;
    expect(kpiCall.op).toBe("upsert");
    expect(kpiCall.onConflict).toBe("sync_run_id");
  });

  it("propagates a database error instead of swallowing it", async () => {
    const calls: FakeCall[] = [];
    const client = fakeClient((call) => {
      if (call.table === "properties" && call.op === "select") return { data: null };
      if (call.table === "properties" && call.op === "insert") return { error: { message: "unique_violation" } };
      throw new Error("unexpected");
    }, calls);
    const repo = new SupabaseLabosRepository(client);
    await expect(repo.getOrCreateProperty("River Run")).rejects.toMatchObject({ message: "unique_violation" });
  });

  it("deleteAllEntitiesForSyncRun issues a delete against every entity table", async () => {
    const calls: FakeCall[] = [];
    const client = fakeClient(() => ({ data: null }), calls);
    const repo = new SupabaseLabosRepository(client);
    await repo.deleteAllEntitiesForSyncRun("run-1");
    const deletedTables = calls.filter((c) => c.op === "delete").map((c) => c.table);
    expect(deletedTables.sort()).toEqual(
      ["exposure_records", "leasing_transactions", "operational_memory", "traffic_leads", "weekly_kpi_snapshots"].sort(),
    );
  });

  it("checkIngestionCapability reports authorized when every check is granted", async () => {
    const calls: FakeCall[] = [];
    const client = fakeClient(() => ({ data: null }), calls, (fn) => {
      expect(fn).toBe("check_ingestion_capability");
      return {
        data: [
          { check_name: "schema_usage", granted: true },
          { check_name: "sync_runs_insert", granted: true },
        ],
      };
    });
    const repo = new SupabaseLabosRepository(client);
    const result = await repo.checkIngestionCapability();
    expect(result.authorized).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("checkIngestionCapability reports the specific missing privileges when some are denied", async () => {
    const calls: FakeCall[] = [];
    const client = fakeClient(() => ({ data: null }), calls, () => ({
      data: [
        { check_name: "schema_usage", granted: true },
        { check_name: "sync_runs_insert", granted: false },
        { check_name: "operational_memory_insert", granted: false },
      ],
    }));
    const repo = new SupabaseLabosRepository(client);
    const result = await repo.checkIngestionCapability();
    expect(result.authorized).toBe(false);
    expect(result.missing).toEqual(["sync_runs_insert", "operational_memory_insert"]);
  });

  it("checkIngestionCapability reports unauthorized (not a thrown error) when the RPC itself is unreachable", async () => {
    const calls: FakeCall[] = [];
    const client = fakeClient(() => ({ data: null }), calls, () => ({
      error: { message: 'function labos.check_ingestion_capability() does not exist' },
    }));
    const repo = new SupabaseLabosRepository(client);
    const result = await repo.checkIngestionCapability();
    expect(result.authorized).toBe(false);
    expect(result.missing[0]).toContain("rpc_unreachable");
  });

  it("refuses to construct in a browser context", () => {
    const calls: FakeCall[] = [];
    const client = fakeClient(() => ({ data: null }), calls);
    (globalThis as { window?: unknown }).window = {};
    try {
      expect(() => new SupabaseLabosRepository(client)).toThrow(/cannot be instantiated in a browser context/i);
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
  });
});

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ValidationResult } from "./types";
import type { NormalizedBatch } from "./normalize";
import type {
  CapabilityCheck, CapabilityCheckResult, EntityCounts, LabosRepository, SourceFileInput, SyncRunRecord, SyncRunStatus,
} from "./repository";

// The real implementation of LabosRepository, against the labos schema
// defined in migrations 0024-0031. IMPORTANT: this has been type-checked and
// unit-tested against a mocked Supabase client (repository.supabase.test.ts)
// but has NEVER been executed against a real database — the migrations
// themselves have not been applied anywhere yet. See the Database
// Verification Checklist in docs/RIVER-RUN-MILESTONE-1-BUILD-PLAN.md for
// exactly what remains unproven and how to prove it once you're ready to
// apply the migrations to a real test project.
//
// Requires a service-role-keyed client for ingestion writes — every write
// here assumes RLS is bypassed the same way the existing invite-user Edge
// Function's service-role client already does. This is NOT verified by
// inspecting the key itself (that's not something this class can or should
// do) — checkIngestionCapability() below verifies it the correct way, by
// asking Postgres what the caller can actually do.
//
// Trusted-runtime boundary: this class must only ever be instantiated in a
// server-side/administrative context (a CLI script today; an Edge Function
// or equivalent later) — never in the browser bundle. The guard below is a
// real, executable backstop for that, not just a comment: if this module is
// ever evaluated in a browser context (accidentally imported into a
// screen/component), construction fails immediately rather than silently
// shipping a service-role-shaped class into client code.
function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "SupabaseLabosRepository cannot be instantiated in a browser context. "
      + "Ingestion writes must run in a trusted server-side/administrative runtime "
      + "(CLI script or Edge Function), never client-side.",
    );
  }
}

export class SupabaseLabosRepository implements LabosRepository {
  constructor(private readonly client: SupabaseClient) {
    assertServerRuntime();
  }

  private table(name: string) {
    return this.client.schema("labos").from(name);
  }

  async checkIngestionCapability(): Promise<CapabilityCheckResult> {
    const { data, error } = await this.client.schema("labos").rpc("check_ingestion_capability");
    if (error) {
      // The RPC itself being unreachable (missing grant, schema not exposed,
      // function doesn't exist yet) IS a capability failure, not a crash —
      // report it the same structured way rather than throwing a raw
      // Postgres/PostgREST error out of a preflight check.
      return {
        authorized: false,
        checks: [],
        missing: [`rpc_unreachable: ${error.message}`],
      };
    }
    const rows = (data ?? []) as { check_name: string; granted: boolean }[];
    const checks: CapabilityCheck[] = rows.map((r) => ({ checkName: r.check_name, granted: r.granted }));
    const missing = checks.filter((c) => !c.granted).map((c) => c.checkName);
    return { authorized: missing.length === 0 && checks.length > 0, checks, missing };
  }

  async getOrCreateProperty(name: string): Promise<string> {
    const { data: existing, error: selectError } = await this.table("properties").select("id").eq("name", name).maybeSingle();
    if (selectError) throw selectError;
    if (existing) return (existing as { id: string }).id;

    const { data: inserted, error: insertError } = await this.table("properties").insert({ name }).select("id").single();
    if (insertError) throw insertError;
    return (inserted as { id: string }).id;
  }

  async findActiveSyncRun(propertyId: string, reportingWeek: string): Promise<SyncRunRecord | null> {
    const { data, error } = await this.table("sync_runs").select("*")
      .eq("property_id", propertyId).eq("reporting_week", reportingWeek)
      .eq("status", "completed").is("superseded_by", null).maybeSingle();
    if (error) throw error;
    return data ? mapSyncRunRow(data as SyncRunRow) : null;
  }

  async createSyncRun(input: { propertyId: string; reportingWeek: string; triggeredBy: string }): Promise<SyncRunRecord> {
    const { data, error } = await this.table("sync_runs").insert({
      property_id: input.propertyId, reporting_week: input.reportingWeek,
      triggered_by: input.triggeredBy, status: "pending",
    }).select("*").single();
    if (error) throw error;
    return mapSyncRunRow(data as SyncRunRow);
  }

  async updateSyncRunStatus(id: string, status: SyncRunStatus): Promise<void> {
    const patch: Record<string, unknown> = { status };
    if (status === "completed" || status === "failed" || status === "blocked") {
      patch.completed_at = new Date().toISOString();
    }
    const { error } = await this.table("sync_runs").update(patch).eq("id", id);
    if (error) throw error;
  }

  async supersedeSyncRun(oldRunId: string, newRunId: string, confirmedBy: string): Promise<void> {
    const { error } = await this.table("sync_runs").update({
      superseded_by: newRunId, overwrite_confirmed_by: confirmedBy, overwrite_confirmed_at: new Date().toISOString(),
    }).eq("id", oldRunId);
    if (error) throw error;
  }

  async recordSourceFile(syncRunId: string, file: SourceFileInput): Promise<void> {
    const { error } = await this.table("source_files").insert({
      sync_run_id: syncRunId, source_type: file.sourceType, drive_file_id: file.driveFileId,
      file_name: file.fileName, last_modified_at: file.lastModifiedAt, content_hash: file.contentHash,
    });
    if (error) throw error;
  }

  async recordValidationResults(syncRunId: string, results: ValidationResult[]): Promise<void> {
    if (results.length === 0) return;
    const { error } = await this.table("validation_results").insert(
      results.map((r) => ({
        sync_run_id: syncRunId, rule_code: r.ruleCode, severity: r.severity, message: r.message, context: r.context ?? null,
      })),
    );
    if (error) throw error;
  }

  private async resolveUnitsAndFloorplans(
    propertyId: string, inventoryRows: NormalizedBatch["inventoryRows"], referencedUnitNumbers: string[],
  ): Promise<Map<string, string>> {
    const floorplanIdByTypeCode = new Map<string, string>();
    if (inventoryRows.length > 0) {
      const { data: floorplans, error } = await this.table("floorplans").upsert(
        inventoryRows.map((r) => ({
          property_id: propertyId, type_code: r.typeCode, bed_count: r.bedCount,
          river_side: r.riverSide, description: r.description,
        })),
        { onConflict: "property_id,type_code" },
      ).select("id,type_code");
      if (error) throw error;
      for (const row of (floorplans ?? []) as { id: string; type_code: string }[]) {
        floorplanIdByTypeCode.set(row.type_code, row.id);
      }
    }

    const typeCodeByUnit = new Map(inventoryRows.map((r) => [r.unitNumber, r.typeCode]));
    const allUnitNumbers = new Set([...inventoryRows.map((r) => r.unitNumber), ...referencedUnitNumbers]);
    const unitRows = [...allUnitNumbers].map((unitNumber) => ({
      property_id: propertyId,
      unit_number: unitNumber,
      floorplan_id: floorplanIdByTypeCode.get(typeCodeByUnit.get(unitNumber) ?? "") ?? null,
    }));
    if (unitRows.length === 0) return new Map();

    const { data: units, error: unitsError } = await this.table("units")
      .upsert(unitRows, { onConflict: "property_id,unit_number" })
      .select("id,unit_number");
    if (unitsError) throw unitsError;

    return new Map((units ?? []).map((row: { id: string; unit_number: string }) => [row.unit_number, row.id]));
  }

  async loadEntities(syncRunId: string, propertyId: string, batch: NormalizedBatch): Promise<EntityCounts> {
    const referencedUnitNumbers = [
      ...batch.leasingTransactions.map((t) => t.unitNumber),
      ...batch.exposureRecords.map((e) => e.unitNumber),
    ];
    const unitIdByNumber = await this.resolveUnitsAndFloorplans(propertyId, batch.inventoryRows, referencedUnitNumbers);

    if (batch.leasingTransactions.length > 0) {
      const { error } = await this.table("leasing_transactions").upsert(
        batch.leasingTransactions.map((t) => ({
          sync_run_id: syncRunId, property_id: propertyId, unit_id: unitIdByNumber.get(t.unitNumber) ?? null,
          event_type: t.eventType, rent: t.rent, effective_date: t.effectiveDate, expiration_date: t.expirationDate,
          move_date: t.moveDate, prior_rent: t.priorRent, lease_term: t.leaseTerm, has_reason: t.hasReason,
          sheet_line_ref: t.sheetLineRef, line_label: t.lineLabel, is_official_kpi: t.isOfficialKpi,
          exclusion_reason: t.exclusionReason,
        })),
        { onConflict: "sync_run_id,sheet_line_ref" },
      );
      if (error) throw error;
    }

    if (batch.exposureRecords.length > 0) {
      const { error } = await this.table("exposure_records").upsert(
        batch.exposureRecords.map((e) => ({
          sync_run_id: syncRunId, property_id: propertyId, unit_id: unitIdByNumber.get(e.unitNumber) ?? null,
          status: e.status, is_skip: e.isSkip, days_vacant: e.daysVacant, make_ready_date: e.makeReadyDate,
          move_in_date: e.moveInDate, notice_date: e.noticeDate, move_out_date: e.moveOutDate, is_unrented: e.isUnrented,
        })),
        { onConflict: "sync_run_id,unit_id" },
      );
      if (error) throw error;
    }

    if (batch.trafficLeads.length > 0) {
      const { error } = await this.table("traffic_leads").upsert(
        batch.trafficLeads.map((l) => ({
          sync_run_id: syncRunId, property_id: propertyId, first_contact_date: l.firstContactDate,
          source_channel: l.sourceChannel, called: l.called, emailed: l.emailed, toured: l.toured, leased: l.leased,
          sheet_line_ref: l.sheetLineRef,
        })),
        { onConflict: "sync_run_id,sheet_line_ref" },
      );
      if (error) throw error;
    }

    // No unique constraint on operational_memory (append-only, immutable
    // content) — a plain insert, not an upsert.
    if (batch.operationalMemory.length > 0) {
      const { error } = await this.table("operational_memory").insert(
        batch.operationalMemory.map((m) => ({
          sync_run_id: syncRunId, property_id: propertyId, reporting_week: batch.reportingWeek,
          memory_type: m.memoryType, source_ref: m.sourceRef, content: m.content,
        })),
      );
      if (error) throw error;
    }

    const { error: kpiError } = await this.table("weekly_kpi_snapshots").upsert({
      sync_run_id: syncRunId, property_id: propertyId, reporting_week: batch.reportingWeek,
      new_rentals_count: batch.weeklyKpiSnapshot.newRentalsCount,
      new_rentals_excluded_count: batch.weeklyKpiSnapshot.newRentalsExcludedCount,
      move_ins_count: batch.weeklyKpiSnapshot.moveInsCount,
      move_outs_count: batch.weeklyKpiSnapshot.moveOutsCount,
      notices_count: batch.weeklyKpiSnapshot.noticesCount,
      renewals_count: batch.weeklyKpiSnapshot.renewalsCount,
      cancels_denials_count: batch.weeklyKpiSnapshot.cancelsDenialsCount,
      walk_ins_count: batch.weeklyKpiSnapshot.walkInsCount,
      current_exposure_count: batch.weeklyKpiSnapshot.currentExposureCount,
    }, { onConflict: "sync_run_id" });
    if (kpiError) throw kpiError;

    return this.countEntitiesForSyncRun(syncRunId);
  }

  async countEntitiesForSyncRun(syncRunId: string): Promise<EntityCounts> {
    const tables = ["leasing_transactions", "exposure_records", "traffic_leads", "operational_memory"] as const;
    const [lt, er, tl, om] = await Promise.all(
      tables.map((t) => this.table(t).select("id", { count: "exact", head: true }).eq("sync_run_id", syncRunId)),
    );
    for (const r of [lt, er, tl, om]) if (r.error) throw r.error;
    return {
      leasingTransactions: lt.count ?? 0,
      exposureRecords: er.count ?? 0,
      trafficLeads: tl.count ?? 0,
      operationalMemory: om.count ?? 0,
    };
  }

  async deleteAllEntitiesForSyncRun(syncRunId: string): Promise<void> {
    const tables = ["leasing_transactions", "exposure_records", "traffic_leads", "operational_memory", "weekly_kpi_snapshots"];
    for (const t of tables) {
      const { error } = await this.table(t).delete().eq("sync_run_id", syncRunId);
      if (error) throw error;
    }
  }
}

interface SyncRunRow {
  id: string; property_id: string; reporting_week: string; status: SyncRunStatus;
  triggered_by: string; triggered_at: string; completed_at: string | null; superseded_by: string | null;
}

function mapSyncRunRow(row: SyncRunRow): SyncRunRecord {
  return {
    id: row.id, propertyId: row.property_id, reportingWeek: row.reporting_week, status: row.status,
    triggeredBy: row.triggered_by, triggeredAt: row.triggered_at,
    completedAt: row.completed_at, supersededBy: row.superseded_by,
  };
}

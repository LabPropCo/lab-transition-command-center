import type { SyncRunDetail } from "../../labos/api";
import "../../styles/labos-sync-review.css";

// Phase 5 (Milestone 1) — a minimal, read-only operational control surface
// proving the ingestion pipeline is reliable. Not the Property Dashboard:
// no narrative, no trend charts, just exactly what a Sync Run did, in a form
// someone can actually check before trusting the numbers it produced.

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function severityClass(severity: string): string {
  return `sync-review__severity sync-review__severity--${severity}`;
}

export function SyncReview({ detail }: { detail: SyncRunDetail }) {
  const { syncRun, sourceFile, validationResults, entityCounts, weeklyKpiSnapshot, excludedNewRentals, auditHistory } = detail;

  if (!syncRun) {
    return (
      <section className="screen">
        <h1 className="screen__title">Sync Review</h1>
        <p className="screen__deck">No Sync Run found.</p>
      </section>
    );
  }

  const blocking = validationResults.filter((r) => r.severity === "blocking");
  const warnings = validationResults.filter((r) => r.severity === "warning");
  const info = validationResults.filter((r) => r.severity === "info");

  return (
    <section className="screen">
      <h1 className="screen__title">Sync Review</h1>
      <p className="screen__deck">
        Reporting week {syncRun.reportingWeek} — status <strong>{syncRun.status.toUpperCase()}</strong>
      </p>

      <div className="sync-review__section">
        <div className="sync-review__section-title">Source</div>
        <table className="wi__table">
          <tbody>
            <tr className="wi__row"><td className="wi__td wi__muted">File</td><td className="wi__td">{sourceFile?.fileName ?? "—"}</td></tr>
            <tr className="wi__row"><td className="wi__td wi__muted">Last modified</td><td className="wi__td">{fmt(sourceFile?.lastModifiedAt ?? null)}</td></tr>
            <tr className="wi__row"><td className="wi__td wi__muted">Triggered by</td><td className="wi__td">{syncRun.triggeredBy}</td></tr>
            <tr className="wi__row"><td className="wi__td wi__muted">Triggered at</td><td className="wi__td">{fmt(syncRun.triggeredAt)}</td></tr>
            <tr className="wi__row"><td className="wi__td wi__muted">Completed at</td><td className="wi__td">{fmt(syncRun.completedAt)}</td></tr>
          </tbody>
        </table>
      </div>

      {weeklyKpiSnapshot && (
        <div className="sync-review__section">
          <div className="sync-review__section-title">Official KPIs</div>
          <div className="sync-review__kpi-grid">
            <div className="sync-review__kpi-card">
              <div className="sync-review__kpi-label">New Rentals</div>
              <div className="sync-review__kpi-value">{weeklyKpiSnapshot.newRentalsCount}</div>
              {weeklyKpiSnapshot.newRentalsExcludedCount > 0 && (
                <div className="sync-review__kpi-excluded">+ {weeklyKpiSnapshot.newRentalsExcludedCount} excluded (below)</div>
              )}
            </div>
            <div className="sync-review__kpi-card"><div className="sync-review__kpi-label">Move-Ins</div><div className="sync-review__kpi-value">{weeklyKpiSnapshot.moveInsCount}</div></div>
            <div className="sync-review__kpi-card"><div className="sync-review__kpi-label">Move-Outs</div><div className="sync-review__kpi-value">{weeklyKpiSnapshot.moveOutsCount}</div></div>
            <div className="sync-review__kpi-card"><div className="sync-review__kpi-label">Notices</div><div className="sync-review__kpi-value">{weeklyKpiSnapshot.noticesCount}</div></div>
            <div className="sync-review__kpi-card"><div className="sync-review__kpi-label">Renewals</div><div className="sync-review__kpi-value">{weeklyKpiSnapshot.renewalsCount}</div></div>
            <div className="sync-review__kpi-card"><div className="sync-review__kpi-label">Cancels/Denials</div><div className="sync-review__kpi-value">{weeklyKpiSnapshot.cancelsDenialsCount}</div></div>
            <div className="sync-review__kpi-card"><div className="sync-review__kpi-label">Walk-Ins</div><div className="sync-review__kpi-value">{weeklyKpiSnapshot.walkInsCount}</div></div>
            <div className="sync-review__kpi-card"><div className="sync-review__kpi-label">Current Exposure</div><div className="sync-review__kpi-value">{weeklyKpiSnapshot.currentExposureCount}</div></div>
          </div>
        </div>
      )}

      {excludedNewRentals.length > 0 && (
        <div className="sync-review__section">
          <div className="sync-review__section-title">Excluded New Rentals — audit only, not counted</div>
          <div className="wi__tablewrap">
            <table className="wi__table">
              <thead><tr><th className="wi__th">Unit</th><th className="wi__th">Line</th><th className="wi__th">Rent</th><th className="wi__th">Classification</th></tr></thead>
              <tbody>
                {excludedNewRentals.map((r) => (
                  <tr key={r.unitNumber} className="wi__row">
                    <td className="wi__td">{r.unitNumber}</td>
                    <td className="wi__td wi__muted">{r.lineLabel}</td>
                    <td className="wi__td">{r.rent != null ? `$${r.rent.toLocaleString()}` : "—"}</td>
                    <td className="wi__td"><span className="sync-review__reason">{r.exclusionReason}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="sync-review__section">
        <div className="sync-review__section-title">Entity Counts (loaded)</div>
        <table className="wi__table">
          <tbody>
            <tr className="wi__row"><td className="wi__td wi__muted">Leasing transactions</td><td className="wi__td">{entityCounts.leasingTransactions}</td></tr>
            <tr className="wi__row"><td className="wi__td wi__muted">Exposure records</td><td className="wi__td">{entityCounts.exposureRecords}</td></tr>
            <tr className="wi__row"><td className="wi__td wi__muted">Traffic leads</td><td className="wi__td">{entityCounts.trafficLeads}</td></tr>
            <tr className="wi__row"><td className="wi__td wi__muted">Operational memory entries</td><td className="wi__td">{entityCounts.operationalMemory}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="sync-review__section">
        <div className="sync-review__section-title">
          Validation — {blocking.length} blocking, {warnings.length} warning, {info.length} info
        </div>
        <div className="wi__tablewrap">
          <table className="wi__table">
            <thead><tr><th className="wi__th">Severity</th><th className="wi__th">Rule</th><th className="wi__th">Message</th></tr></thead>
            <tbody>
              {validationResults.map((r, i) => (
                <tr key={i} className="wi__row">
                  <td className="wi__td"><span className={severityClass(r.severity)}>{r.severity}</span></td>
                  <td className="wi__td wi__muted">{r.ruleCode}</td>
                  <td className="wi__td">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {validationResults.length === 0 && <div className="wi__empty">No validation results.</div>}
        </div>
      </div>

      <div className="sync-review__section">
        <div className="sync-review__section-title">Output Status</div>
        <table className="wi__table">
          <tbody>
            <tr className="wi__row"><td className="wi__td wi__muted">Dashboard read model</td><td className="wi__td">Not built yet (later milestone)</td></tr>
            <tr className="wi__row"><td className="wi__td wi__muted">Trend workbook write-back</td><td className="wi__td">Not implemented (interface only, per scope)</td></tr>
            <tr className="wi__row"><td className="wi__td wi__muted">Monday Narrative draft</td><td className="wi__td">Not built yet (later milestone)</td></tr>
          </tbody>
        </table>
      </div>

      <div className="sync-review__section">
        <div className="sync-review__section-title">Audit History — {syncRun.reportingWeek}</div>
        <div className="wi__tablewrap">
          <table className="wi__table">
            <thead><tr><th className="wi__th">Sync Run</th><th className="wi__th">Status</th><th className="wi__th">Triggered By</th><th className="wi__th">Triggered At</th><th className="wi__th">Superseded By</th></tr></thead>
            <tbody>
              {auditHistory.map((h) => (
                <tr key={h.syncRunId} className={"wi__row" + (h.syncRunId === syncRun.id ? " methodology__archived" : "")}>
                  <td className="wi__td wi__muted">{h.syncRunId}</td>
                  <td className="wi__td">{h.status}</td>
                  <td className="wi__td">{h.triggeredBy}</td>
                  <td className="wi__td">{fmt(h.triggeredAt)}</td>
                  <td className="wi__td wi__muted">{h.supersededBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

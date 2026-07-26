import { useEffect, useMemo, useState } from "react";
import { useTransition } from "../transitions/TransitionProvider";
import { listWorkItems } from "../work-items/api";
import type { WorkItem } from "../work-items/types";
import {
  computeDashboardMetrics,
  computePriorityItems,
  computeOwnerExposure,
  computeStalledWorkstreams,
} from "../lib/metrics";
import "../styles/dashboard.css";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(new Date().toDateString());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// How many days an already-overdue item has been overdue. Only ever called on
// items isOverdue() has already confirmed have a valid, past due date.
function daysOverdue(iso: string): number {
  const due = new Date(iso + "T00:00:00");
  const today = new Date(new Date().toDateString());
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
}

// A self-contained figure + label, never a fragment: whatever the sign of
// `d`, the pairing always reads as a complete statement on its own.
function goLiveCountdown(d: number): { value: number; label: string } {
  if (d > 0) return { value: d, label: d === 1 ? "Day remaining" : "Days remaining" };
  if (d === 0) return { value: 0, label: "Transition is today" };
  const since = Math.abs(d);
  return { value: since, label: since === 1 ? "Day since transition" : "Days since transition" };
}

// Why a blocked item matters, from fields that already exist on it — never a
// fabricated priority score.
function stakes(w: WorkItem): string {
  if (w.criticalPath && w.goLiveGate) return "Critical path · Go-live gate";
  return w.criticalPath ? "Critical path" : "Go-live gate";
}

// Spells small integers for the one prose sentence on the page — numerals
// stay in the rows and the supporting-evidence strip below.
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function numberToWords(n: number): string {
  if (n < 0 || !Number.isFinite(n)) return String(n);
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return TENS[tens] + (ones ? "-" + ONES[ones] : "");
  }
  return String(n); // beyond realistic scale for this app — fall back rather than guess
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

export function Dashboard() {
  const { selected, propertyFilter } = useTransition();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!selected) { setItems([]); setLoading(false); return; }
    let active = true;
    setLoading(true); setErr("");
    listWorkItems(selected.id)
      .then((rows) => { if (active) { setItems(rows); setLoading(false); } })
      .catch((e) => { if (active) { setErr(e instanceof Error ? e.message : "Failed to load"); setLoading(false); } });
    return () => { active = false; };
  }, [selected]);

  // Same property-scope semantics as the Work Items screen: "all" = every
  // item, "shared" = transition-level only, else a specific property id.
  const scoped = useMemo(() => items.filter((w) => {
    if (propertyFilter === "shared") return w.scopeType === "transition";
    if (propertyFilter !== "all") return w.propertyId === propertyFilter;
    return true;
  }), [items, propertyFilter]);

  const metrics = useMemo(() => computeDashboardMetrics(scoped), [scoped]);
  const priorityItems = useMemo(() => computePriorityItems(scoped), [scoped]);
  const ownerExposure = useMemo(() => computeOwnerExposure(scoped), [scoped]);
  const stalledWorkstreams = useMemo(() => computeStalledWorkstreams(metrics.workstreams), [metrics]);

  const goLiveDays = selected ? daysUntil(selected.targetGoLive) : null;
  const countdown = goLiveDays !== null ? goLiveCountdown(goLiveDays) : null;
  const ready = !loading && !err && metrics.totalCount > 0;
  const maxExposure = ownerExposure[0]?.overdueCount ?? 0;

  // The one sentence leadership needs before the meeting. Picks the single
  // most operationally significant true pattern already computed above —
  // never a fixed template, never a judgment the data can't support.
  const focus = useMemo(() => {
    if (!ready) return null;
    const topOwner = ownerExposure[0];
    const secondOwner = ownerExposure[1];
    if (topOwner) {
      // Only name one owner when they clearly lead the pack — a 12-vs-10
      // split is still concentration, but it's shared, not one person's.
      const topIsDominant = !secondOwner || topOwner.overdueCount >= secondOwner.overdueCount * 1.5;
      if (topIsDominant) {
        return `${cap(numberToWords(topOwner.overdueCount))} overdue item${topOwner.overdueCount === 1 ? "" : "s"} ${topOwner.overdueCount === 1 ? "is" : "are"} concentrated with ${topOwner.owner}.`;
      }
      const combined = topOwner.overdueCount + secondOwner.overdueCount;
      return `${cap(numberToWords(combined))} overdue items are concentrated with ${topOwner.owner} and ${secondOwner.owner}.`;
    }
    if (stalledWorkstreams.length > 0) {
      const names = stalledWorkstreams.map((w) => w.workstream).join(" and ");
      const runway = goLiveDays !== null && goLiveDays > 0 ? ` with ${goLiveDays} day${goLiveDays === 1 ? "" : "s"} remaining` : "";
      return `${cap(numberToWords(stalledWorkstreams.length))} workstream${stalledWorkstreams.length === 1 ? "" : "s"} — ${names} — ${stalledWorkstreams.length === 1 ? "has" : "have"} not started${runway}.`;
    }
    if (metrics.overdueCount > 0) {
      return `${cap(numberToWords(metrics.overdueCount))} item${metrics.overdueCount === 1 ? "" : "s"} ${metrics.overdueCount === 1 ? "is" : "are"} overdue across the critical path and go-live gates.`;
    }
    return `${metrics.readinessPercent}% complete${goLiveDays !== null && goLiveDays > 0 ? ` with ${goLiveDays} day${goLiveDays === 1 ? "" : "s"} remaining` : ""}.`;
  }, [ready, ownerExposure, stalledWorkstreams, metrics, goLiveDays]);

  return (
    <section className="screen dash">
      <div className="dash__hero">
        <p className="dash__eyebrow">{selected?.name ?? "Leadership Brief"}</p>
        {countdown && (
          <div className="dash__countdown">
            <span className="dash__countdown-value">{countdown.value}</span>
            <span className="dash__countdown-label">{countdown.label}</span>
          </div>
        )}
        {focus && <p className="dash__focus">{focus}</p>}
      </div>

      {err && <p className="dash__err">{err}</p>}
      {loading && !err && <p className="dash__loading">Loading…</p>}

      {!loading && !err && metrics.totalCount === 0 && (
        <div className="dash__empty">
          <div className="dash__empty-head">No work items yet</div>
          <p className="dash__empty-body">
            {selected
              ? "This transition hasn't been provisioned with work items yet, or none match the current property filter."
              : "Select a transition to see its brief."}
          </p>
        </div>
      )}

      {ready && (
        <div className="dash__body">
          <section className="dash__block">
            <h2 className="dash__block-title">Decisions blocking progress</h2>
            {priorityItems.length === 0 ? (
              <p className="dash__quiet">Nothing overdue on the critical path or a go-live gate.</p>
            ) : (
              <ol className="dash__list">
                {priorityItems.map((w) => {
                  const overdue = w.dueDate ? daysOverdue(w.dueDate) : null;
                  return (
                    <li className="dash__row" key={w.id}>
                      <span className="dash__row-desc">{w.description}</span>
                      <span className="dash__row-meta">
                        {stakes(w)} · {w.owner ?? "Unassigned"} · {overdue !== null ? `${overdue} day${overdue === 1 ? "" : "s"} overdue` : "overdue"}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {ownerExposure.length > 0 && (
            <section className="dash__block">
              <h2 className="dash__block-title">Where help is needed</h2>
              <div className="dash__ownerlist">
                {ownerExposure.map((o) => (
                  <div className="dash__ownerrow" key={o.owner}>
                    <span className="dash__ownername">{o.owner}</span>
                    <div className="dash__ownertrack">
                      <div className="dash__ownerfill" style={{ width: `${(o.overdueCount / maxExposure) * 100}%` }} />
                    </div>
                    <span className="dash__ownercount">{o.overdueCount} overdue</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="dash__stats">
            <div className="dash__stat">
              <div className="dash__stat-value">{metrics.goLiveGate.completed}/{metrics.goLiveGate.total}</div>
              <div className="dash__stat-label">Go-live gates</div>
            </div>
            <div className="dash__stat">
              <div className="dash__stat-value">{metrics.criticalPath.completed}/{metrics.criticalPath.total}</div>
              <div className="dash__stat-label">Critical path</div>
            </div>
            <div className="dash__stat">
              <div className="dash__stat-value">{metrics.readinessPercent}%</div>
              <div className="dash__stat-label">Complete</div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

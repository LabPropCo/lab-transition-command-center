import { useEffect, useMemo, useRef, useState } from "react";
import { useTransition } from "../transitions/TransitionProvider";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";
import { DEMO_MODE } from "../demo/config";
import { listWorkItemsForTransitions, getCurrentUserDisplayName, updateWorkItem, listActiveOwners } from "../work-items/api";
import type { WorkItem, WorkItemPatch } from "../work-items/types";
import type { WorkOwner } from "../types";
import { computeMyActions, computeWaitingOn, computeMyRecentCompletions, isOverdue, type MyActionsGroups } from "../lib/metrics";
import { blockedReason } from "../work-items/constants";
import { WorkItemDetail } from "../components/WorkItemDetail";
import { SCREENS } from "../lib/nav";
import "../styles/myactions.css";

// The four sections a summary stat can scroll to. Executive Attention
// Required and Go-Live Gates don't have their own stat (the stat row is
// unchanged from v1.0 on purpose — this release re-orders and re-labels
// what's underneath it, not the visual footprint above it).
type ScrollTarget = "overdue" | "dueThisWeek" | "criticalPath" | "blocked";

// The section a row lives in never needs to repeat its own reason for
// being there — e.g. a row already under Critical Path doesn't also need
// a "Critical Path" tag. Everywhere else, a flag it happens to also carry
// is genuinely new information, so it's shown. "allBlocked" isn't a real
// section (see MyActionsGroups) — rows rendered from it are tagged with
// the neutral "blocked" SectionKey instead, so a Critical Path or Go-Live
// Gate item still shows its tag there.
type SectionKey = keyof Omit<MyActionsGroups, "counts" | "allBlocked">;

function daysOverdue(iso: string): number {
  const due = new Date(iso + "T00:00:00");
  const today = new Date(new Date().toDateString());
  return Math.round((today.getTime() - due.getTime()) / 86_400_000);
}

// No year: this page is a near-term workspace (this week / active work),
// not an archive — the year is never the ambiguous part of a due date
// someone's looking at today.
function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

// One line, worst-first: overdue duration beats a plain due date, and a
// missing due date is stated plainly rather than left blank.
function dueLabel(w: WorkItem): string {
  if (!w.dueDate) return "No due date";
  if (isOverdue(w)) {
    const d = daysOverdue(w.dueDate);
    return `${d} day${d === 1 ? "" : "s"} overdue`;
  }
  return `Due ${formatDate(w.dueDate)}`;
}

// Only what helps decide what to work on next. Critical Path / Go-Live
// Gate are shown unless the row's own section already says so. "Waiting
// on X" tells you whose court the ball is in — genuinely decision-
// relevant, unlike "Not Started"/"In Progress", which aren't, so those are
// never shown at all. "Blocked" and "Executive Priority" never appear as
// bare tags: both are entirely determined by fields already used to place
// the row in its section (isBlocked(w), priority === "Critical"), so a
// tag would either repeat the section header it's already under, or — for
// Executive Attention Required specifically — could never fire anywhere
// else, since any Critical-priority item is always sectioned there first.
// A blocked row with a known party (Client/Vendor/Prior Manager) still
// gets its "Waiting On X" tag regardless of section, since that's new
// information (the reason), not a repeat of the section header; plain
// "Blocked" contributes no tag at all, since blockedReason() returns null
// for it and none is fabricated.
//
// Design note (not implemented — see the Blocked v1 design discussion):
// a fuller Blocked row would eventually add who specifically it's waiting
// on and since when. Neither is tracked at that granularity today — the
// status field only names a party/role (Client, Vendor, ...), not a
// person, and "since when" would mean querying audit_log for the most
// recent transition into a blocked status, which isn't wired up yet. This
// function already returns a flat array of independent strings, so
// either addition is just one more entry here whenever that's built —
// nothing about this shape needs to change to accommodate it.
function flagLabels(w: WorkItem, section: SectionKey): string[] {
  const flags: string[] = [];
  if (w.criticalPath && section !== "criticalPath") flags.push("Critical Path");
  if (w.goLiveGate && section !== "goLiveGates") flags.push("Go-Live Gate");
  const reason = blockedReason(w.status);
  if (reason) flags.push(`Waiting On ${reason}`);
  return flags;
}

interface ActionRowProps {
  item: WorkItem;
  section: SectionKey;
  scopeLabel: string;
  onOpen: () => void;
}

function ActionRow({ item, section, scopeLabel, onOpen }: ActionRowProps) {
  return (
    <li className="ma__row" onClick={onOpen}>
      <div className="ma__row-title">{item.description}</div>
      <div className="ma__row-scope">{scopeLabel}</div>
      <div className="ma__row-meta">{[dueLabel(item), ...flagLabels(item, section)].join(" · ")}</div>
    </li>
  );
}

const SECTION_TITLES: Record<Exclude<SectionKey, "activeWork">, string> = {
  executiveAttention: "Executive attention required",
  criticalPath: "Critical path",
  goLiveGates: "Go-live gates",
  blocked: "Blocked",
  overdue: "Overdue",
  dueThisWeek: "Due this week",
};

export function MyActions() {
  const { transitions } = useTransition();
  const { user } = useAuth();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [properties, setProperties] = useState<Map<string, string>>(new Map());
  const [owners, setOwners] = useState<WorkOwner[]>([]);
  const [displayName, setDisplayName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [transitionFilter, setTransitionFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pulsing, setPulsing] = useState<ScrollTarget | null>(null);
  // Blocked is the one stat that can't just scroll to a section: section
  // precedence means a blocked item that's also Critical-priority or
  // critical-path lives elsewhere, so its own section never holds every
  // blocked item. Clicking it instead toggles a temporary flat view of
  // everything blocked (groups.allBlocked) in place of the normal grouped
  // list — nothing is duplicated permanently, and precedence is untouched.
  const [showAllBlocked, setShowAllBlocked] = useState(false);

  const transitionIds = useMemo(() => transitions.map((t) => t.id), [transitions]);
  const transitionNames = useMemo(() => new Map(transitions.map((t) => [t.id, t.name])), [transitions]);

  const sectionRefs = {
    overdue: useRef<HTMLElement>(null),
    dueThisWeek: useRef<HTMLElement>(null),
    criticalPath: useRef<HTMLElement>(null),
    blocked: useRef<HTMLElement>(null),
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (transitionIds.length === 0) { setItems([]); setLoading(false); return; }
      setLoading(true); setErr("");
      try {
        const [rows, myName] = await Promise.all([
          listWorkItemsForTransitions(transitionIds),
          getCurrentUserDisplayName(),
        ]);
        if (!active) return;
        setItems(rows);
        setDisplayName(myName ?? "");
        setLoading(false);
      } catch (e) {
        if (active) { setErr(e instanceof Error ? e.message : "Failed to load"); setLoading(false); }
      }
    })();
    return () => { active = false; };
  }, [transitionIds, user?.id]);

  // Property names across every transition (not just one) — My Actions
  // aggregates by design, so it can't rely on TransitionProvider's
  // single-selected-transition property list.
  useEffect(() => {
    let active = true;
    (async () => {
      if (transitionIds.length === 0) { setProperties(new Map()); return; }
      if (DEMO_MODE) {
        const s = await import("../demo/store");
        const lists = await Promise.all(transitionIds.map((id) => s.demoProperties(id)));
        if (active) setProperties(new Map(lists.flat().map((p) => [p.id, p.name])));
        return;
      }
      if (!supabase) return;
      const { data, error } = await supabase
        .from("properties").select("id,name").in("transition_id", transitionIds);
      if (!active) return;
      if (error) { console.error("[my-actions] properties load failed", error); return; }
      setProperties(new Map((data ?? []).map((p: { id: string; name: string }) => [p.id, p.name])));
    })();
    return () => { active = false; };
  }, [transitionIds]);

  useEffect(() => {
    let active = true;
    listActiveOwners().then((o) => { if (active) setOwners(o); }).catch((e) => console.error("[my-actions] owners load failed", e));
    return () => { active = false; };
  }, []);

  const scoped = useMemo(
    () => (transitionFilter === "all" ? items : items.filter((w) => w.transitionId === transitionFilter)),
    [items, transitionFilter],
  );

  // The full personal-workspace computation lives in metrics.ts and returns
  // plain counts + arrays, not JSX — a future daily-briefing surface (e.g.
  // "Good morning, Jessica") could read the exact same `groups` shape (plus
  // the Dashboard's own executive-assessment status for this transition)
  // without any of this screen's rendering logic. Not built yet; the data
  // it would need already is.
  const groups = useMemo(
    () => (displayName ? computeMyActions(scoped, displayName) : null),
    [scoped, displayName],
  );
  const waitingOn = useMemo(
    () => (displayName ? computeWaitingOn(scoped, displayName) : []),
    [scoped, displayName],
  );
  const recentCompletions = useMemo(
    () => (displayName ? computeMyRecentCompletions(scoped, displayName) : []),
    [scoped, displayName],
  );

  const scopeLabel = (w: WorkItem): string => {
    const transitionName = transitionNames.get(w.transitionId) ?? "";
    if (w.scopeType === "transition" || !w.propertyId) return transitionName;
    return `${transitionName} · ${properties.get(w.propertyId) ?? "Property"}`;
  };

  async function applyPatch(id: string, patch: WorkItemPatch) {
    const prev = items;
    try {
      const updated = await updateWorkItem(id, patch);
      setItems((list) => list.map((w) => (w.id === id ? updated : w)));
      return updated;
    } catch (e) {
      setItems(prev);
      setErr(e instanceof Error ? e.message : "Update failed — you may not have edit access.");
      throw e;
    }
  }

  function handleStatClick(target: ScrollTarget) {
    if (!groups) return;
    if (target === "blocked") {
      if (groups.allBlocked.length === 0) {
        setPulsing("blocked");
        window.setTimeout(() => setPulsing((p) => (p === "blocked" ? null : p)), 600);
        return;
      }
      setShowAllBlocked((v) => !v);
      return;
    }
    if (showAllBlocked) setShowAllBlocked(false);
    const ref = sectionRefs[target];
    if (groups.counts[target] === 0 || !ref.current) {
      setPulsing(target);
      window.setTimeout(() => setPulsing((p) => (p === target ? null : p)), 600);
      return;
    }
    ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderSection(key: Exclude<SectionKey, "activeWork">, list: WorkItem[]) {
    if (list.length === 0) return null;
    const ref = key in sectionRefs ? sectionRefs[key as ScrollTarget] : undefined;
    return (
      <section className="ma__group" key={key} ref={ref}>
        <h2 className="ma__group-title">{SECTION_TITLES[key]}</h2>
        <ol className="ma__list">
          {list.map((w) => (
            <ActionRow key={w.id} item={w} section={key} scopeLabel={scopeLabel(w)} onOpen={() => setOpenId(w.id)} />
          ))}
        </ol>
      </section>
    );
  }

  const open = items.find((w) => w.id === openId) ?? null;
  const totalMine = groups
    ? groups.executiveAttention.length + groups.criticalPath.length + groups.goLiveGates.length
      + groups.blocked.length + groups.overdue.length + groups.dueThisWeek.length + groups.activeWork.length
    : 0;
  const s = SCREENS.myactions;
  const urgentEmpty = groups
    ? groups.executiveAttention.length === 0 && groups.criticalPath.length === 0
      && groups.goLiveGates.length === 0 && groups.blocked.length === 0 && groups.overdue.length === 0
    : false;

  return (
    <section className="screen ma">
      <div className="ma__hero">
        <h1 className="screen__title">{s.title}</h1>
        <p className="screen__deck">{s.deck}</p>
        {transitions.length > 1 && (
          <select className="ma__filter" value={transitionFilter} onChange={(e) => setTransitionFilter(e.target.value)}>
            <option value="all">All transitions</option>
            {transitions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      {err && <p className="ma__err">{err}</p>}
      {loading && !err && <p className="ma__loading">Loading…</p>}

      {!loading && !err && groups && (
        totalMine === 0 ? (
          <p className="ma__empty">You have no active work assigned right now.</p>
        ) : (
          <>
            <div className="ma__stats">
              <button type="button" className={"ma__stat" + (pulsing === "overdue" ? " ma__stat--pulse" : "")} onClick={() => handleStatClick("overdue")}>
                <div className="ma__stat-value">{groups.counts.overdue}</div>
                <div className="ma__stat-label">Overdue</div>
              </button>
              <button type="button" className={"ma__stat" + (pulsing === "dueThisWeek" ? " ma__stat--pulse" : "")} onClick={() => handleStatClick("dueThisWeek")}>
                <div className="ma__stat-value">{groups.counts.dueThisWeek}</div>
                <div className="ma__stat-label">Due this week</div>
              </button>
              <button type="button" className={"ma__stat" + (pulsing === "criticalPath" ? " ma__stat--pulse" : "")} onClick={() => handleStatClick("criticalPath")}>
                <div className="ma__stat-value">{groups.counts.criticalPath}</div>
                <div className="ma__stat-label">Critical path</div>
              </button>
              <button
                type="button"
                className={"ma__stat" + (pulsing === "blocked" ? " ma__stat--pulse" : "") + (showAllBlocked ? " ma__stat--active" : "")}
                onClick={() => handleStatClick("blocked")}
              >
                <div className="ma__stat-value">{groups.allBlocked.length}</div>
                <div className="ma__stat-label">Blocked</div>
              </button>
            </div>

            <div className="ma__layout">
              <div className="ma__body">
                {showAllBlocked ? (
                  <section className="ma__group">
                    <div className="ma__blocked-head">
                      <h2 className="ma__group-title">All blocked work</h2>
                      <button type="button" className="ma__blocked-back" onClick={() => setShowAllBlocked(false)}>
                        Back to full list
                      </button>
                    </div>
                    <p className="ma__quiet">
                      Every item currently blocked, including ones grouped above by a higher priority — nothing here is duplicated in those sections.
                    </p>
                    <ol className="ma__list">
                      {groups.allBlocked.map((w) => (
                        <ActionRow key={w.id} item={w} section="blocked" scopeLabel={scopeLabel(w)} onOpen={() => setOpenId(w.id)} />
                      ))}
                    </ol>
                  </section>
                ) : (
                  <>
                    {urgentEmpty
                      ? <p className="ma__quiet ma__quiet--lead">Nothing requires urgent attention right now.</p>
                      : (
                        <>
                          {renderSection("executiveAttention", groups.executiveAttention)}
                          {renderSection("criticalPath", groups.criticalPath)}
                          {renderSection("goLiveGates", groups.goLiveGates)}
                          {renderSection("blocked", groups.blocked)}
                          {renderSection("overdue", groups.overdue)}
                        </>
                      )}

                    <section className="ma__group" ref={sectionRefs.dueThisWeek}>
                      <h2 className="ma__group-title">Due this week</h2>
                      {groups.dueThisWeek.length === 0 ? (
                        <p className="ma__quiet">You're caught up for this week.</p>
                      ) : (
                        <ol className="ma__list">
                          {groups.dueThisWeek.map((w) => (
                            <ActionRow key={w.id} item={w} section="dueThisWeek" scopeLabel={scopeLabel(w)} onOpen={() => setOpenId(w.id)} />
                          ))}
                        </ol>
                      )}
                    </section>

                    {groups.activeWork.length > 0 && (
                      <section className="ma__group">
                        <h2 className="ma__group-title">Active work</h2>
                        <ol className="ma__list">
                          {groups.activeWork.map((w) => (
                            <ActionRow key={w.id} item={w} section="activeWork" scopeLabel={scopeLabel(w)} onOpen={() => setOpenId(w.id)} />
                          ))}
                        </ol>
                      </section>
                    )}
                  </>
                )}
              </div>

              {/* A small operator sidebar, not a second dashboard — each
                  widget hides itself entirely when it has nothing to show,
                  rather than adding an empty-state message of its own; the
                  point is context that supports execution, not more things
                  to read. */}
              {(waitingOn.length > 0 || recentCompletions.length > 0) && (
                <aside className="ma__sidebar">
                  {waitingOn.length > 0 && (
                    <section className="ma__side-block">
                      <h2 className="ma__side-title">Waiting on</h2>
                      <ul className="ma__side-list">
                        {waitingOn.map((g) => (
                          <li className="ma__side-row" key={g.party}>
                            <span>{g.party}</span>
                            <span className="ma__side-count">{g.count}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {recentCompletions.length > 0 && (
                    <section className="ma__side-block">
                      <h2 className="ma__side-title">Recently completed</h2>
                      <ul className="ma__side-list ma__side-list--quiet">
                        {recentCompletions.map((w) => (
                          <li className="ma__side-row ma__side-row--quiet" key={w.id}>{w.description}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                </aside>
              )}
            </div>
          </>
        )
      )}

      {open && (
        <WorkItemDetail
          item={open}
          allItems={items}
          transitionName={transitionNames.get(open.transitionId) ?? ""}
          propertyName={open.propertyId ? properties.get(open.propertyId) ?? "Property" : "Shared"}
          owners={owners}
          onClose={() => setOpenId(null)}
          onSave={(patch) => applyPatch(open.id, patch)}
        />
      )}
    </section>
  );
}

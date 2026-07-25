import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { DEMO_MODE } from "../demo/config";
import type { Transition, Property } from "../types";

// "all" = everything, "shared" = transition-level only, else a property id.
export type PropertyFilter = "all" | "shared" | string;

interface TransitionState {
  transitions: Transition[];
  selected: Transition | null;
  selectTransition: (id: string) => void;
  properties: Property[];
  propertyFilter: PropertyFilter;
  setPropertyFilter: (f: PropertyFilter) => void;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const Ctx = createContext<TransitionState | undefined>(undefined);
const LS_KEY = "tcc.selectedTransitionId";

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapT = (r: any): Transition => ({
  id: r.id, name: r.name, ownershipGroup: r.ownership_group,
  companyName: r.company_name ?? r.ownership_group ?? null,
  targetGoLive: r.target_go_live_date, currentPhase: r.current_phase, overallStatus: r.overall_status,
  communityDirectorId: r.community_director_id ?? null, communityDirectorName: r.community_director_name ?? null,
  transitionManager: r.transition_manager ?? null,
  regionalManager: r.regional_manager ?? null, defaultPropertyId: r.default_property_id ?? null,
  primaryColor: r.primary_color ?? null, secondaryColor: r.secondary_color ?? null,
  logoUrl: r.logo_url ?? null, notes: r.notes ?? null, active: r.active,
});
const mapP = (r: any): Property => ({
  id: r.id, transitionId: r.transition_id, name: r.name, client: r.client ?? "",
  transitionDate: r.transition_date ?? "", goLive: r.go_live ?? "", units: r.units ?? undefined,
  address: r.address ?? null, city: r.city ?? null, state: r.state ?? null, zip: r.zip ?? null,
  propertyType: r.property_type ?? null, notes: r.notes ?? null, active: r.active ?? true,
});

// Turn a PostgREST/Supabase error into something a human can act on. The most
// common one right after a migration that ADDS a table is a stale schema cache.
function explain(err: any): string {
  const code = err?.code ?? "";
  const msg = String(err?.message ?? err ?? "Unknown error");
  if (code === "PGRST205" || /schema cache/i.test(msg)) {
    return "The API can't see the new tables yet — PostgREST's schema cache is stale " +
      "after the migration. In Supabase, run  NOTIFY pgrst, 'reload schema';  in the SQL " +
      "editor (or Settings -> API -> Reload schema), then click Retry.";
  }
  if (code === "42501" || /permission denied/i.test(msg)) {
    return "Permission denied reading transitions. Check that the `authenticated` role has " +
      "SELECT on public.transitions and that RLS policies are in place. (" + msg + ")";
  }
  if (code === "42P01" || /relation .* does not exist/i.test(msg)) {
    return "The transitions table doesn't exist - was migration 0004 applied to this project? (" + msg + ")";
  }
  return msg;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TransitionProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(localStorage.getItem(LS_KEY));
  const [propertyFilter, setPropertyFilter] = useState<PropertyFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // bump to force a reload
  const runId = useRef(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // Load the transitions the user may access. Retries once on failure, because a
  // freshly-migrated schema cache or a just-restored token can make the first
  // attempt fail transiently. Errors are surfaced, never swallowed.
  useEffect(() => {
    const myRun = ++runId.current;
    let cancelled = false;

    (async () => {
      setLoading(true); setError(null);

      if (DEMO_MODE) {
        const s = await import("../demo/store");
        if (cancelled || myRun !== runId.current) return;
        setTransitions(s.demoTransitions()); setLoading(false); return;
      }

      // Wait until auth is settled and we actually have a token to send.
      if (authLoading) return;
      if (!supabase || !session) {
        if (!cancelled) { setTransitions([]); setLoading(false); }
        return;
      }

      let lastErr: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await sleep(1200);
        const { data, error: qErr } = await supabase
          .from("transitions")
          .select("id,name,ownership_group,company_name,target_go_live_date,current_phase,overall_status,community_director_id,community_director_name,transition_manager,regional_manager,default_property_id,primary_color,secondary_color,logo_url,notes,active")
          .eq("active", true)
          .order("name");
        if (cancelled || myRun !== runId.current) return;
        if (!qErr) {
          setTransitions((data ?? []).map(mapT));
          setError(null); setLoading(false);
          return;
        }
        lastErr = qErr;
        // eslint-disable-next-line no-console
        console.error("[transitions] load failed (attempt " + (attempt + 1) + ")", qErr);
      }
      if (!cancelled && myRun === runId.current) {
        setTransitions([]); setError(explain(lastErr)); setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // Re-run when auth settles, when the access token changes (refresh/restore),
    // and on an explicit reload().
  }, [authLoading, session?.access_token, nonce]);

  const selected = useMemo(
    () => transitions.find((t) => t.id === selectedId) ?? transitions[0] ?? null,
    [transitions, selectedId],
  );

  // Load the selected transition's properties (errors surfaced too).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selected) { setProperties([]); return; }
      if (DEMO_MODE) {
        const s = await import("../demo/store");
        if (!cancelled) setProperties(s.demoProperties(selected.id));
        return;
      }
      if (!supabase || !session) return;
      const { data, error: qErr } = await supabase
        .from("properties")
        .select("id,transition_id,name,client,transition_date,go_live,units,address,city,state,zip,property_type,notes,active")
        .eq("transition_id", selected.id).order("name");
      if (cancelled) return;
      if (qErr) {
        // eslint-disable-next-line no-console
        console.error("[properties] load failed", qErr);
        setError((e) => e ?? explain(qErr));
        return;
      }
      setProperties((data ?? []).map(mapP));
    })();
    return () => { cancelled = true; };
  }, [selected, session?.access_token]);

  const value = useMemo<TransitionState>(() => ({
    transitions, selected, properties, propertyFilter, loading, error, reload,
    selectTransition: (id) => { setSelectedId(id); localStorage.setItem(LS_KEY, id); setPropertyFilter("all"); },
    setPropertyFilter,
  }), [transitions, selected, properties, propertyFilter, loading, error, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTransition(): TransitionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTransition must be used within TransitionProvider");
  return v;
}

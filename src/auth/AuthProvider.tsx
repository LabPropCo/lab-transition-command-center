import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseReady } from "../lib/supabase";
import { DEV_BYPASS_ENABLED, runDevBypass } from "./devBypass";
import { DEMO_MODE } from "../demo/config";

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  configured: boolean;
  bypassError: string | null;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [bypassError, setBypassError] = useState<string | null>(null);

  useEffect(() => {
    // Demo mode: synthesize a session, never touch Supabase.
    if (DEMO_MODE) {
      setSession({ user: { id: "demo-admin", email: "demo@thelab.local" } } as unknown as Session);
      setLoading(false);
      return;
    }

    let unsub = () => {};

    (async () => {
      // Dev auth bypass: attempt a REAL sign-in and keep `loading` true until it
      // resolves, so the OTP login page never renders while we're signing in.
      if (DEV_BYPASS_ENABLED) {
        const existing = supabase ? (await supabase.auth.getSession()).data.session : null;
        if (existing) {
          setSession(existing);
        } else {
          const res = await runDevBypass(supabase);
          if (!res.ok) setBypassError(res.error ?? "Dev auth bypass failed.");
          if (supabase) setSession((await supabase.auth.getSession()).data.session);
        }
        setLoading(false);
        if (supabase) {
          const l = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
          unsub = () => l.data.subscription.unsubscribe();
        }
        return;
      }

      // Normal flow.
      if (!supabase) { setLoading(false); return; }
      setSession((await supabase.auth.getSession()).data.session);
      setLoading(false);
      const l = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
      unsub = () => l.data.subscription.unsubscribe();
    })();

    return () => unsub();
  }, []);

  const value = useMemo<AuthState>(() => ({
    session,
    user: session?.user ?? null,
    loading,
    configured: supabaseReady,
    bypassError,
    signOut: async () => { await supabase?.auth.signOut(); },
  }), [session, loading, bypassError]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}

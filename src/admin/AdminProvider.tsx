import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { DEMO_MODE } from "../demo/config";

interface AdminState { isAdmin: boolean; loading: boolean; }
const Ctx = createContext<AdminState | undefined>(undefined);

export function AdminProvider({ children }: { children: ReactNode }) {
  const { session, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    (async () => {
      if (DEMO_MODE) { setIsAdmin(true); setLoading(false); return; }
      if (authLoading) return;
      if (!supabase || !session) { setIsAdmin(false); setLoading(false); return; }
      const { data } = await supabase
        .from("profiles").select("is_platform_admin").eq("id", session.user.id).maybeSingle();
      if (!on) return;
      setIsAdmin(Boolean(data?.is_platform_admin));
      setLoading(false);
    })();
    return () => { on = false; };
  }, [authLoading, session?.access_token]);

  const value = useMemo(() => ({ isAdmin, loading }), [isAdmin, loading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAdmin(): AdminState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdmin must be used within AdminProvider");
  return v;
}

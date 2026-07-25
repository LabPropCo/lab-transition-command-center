import { Navigate, Outlet } from "react-router-dom";
import { useAdmin } from "./AdminProvider";

export function RequireAdmin() {
  const { isAdmin, loading } = useAdmin();
  if (loading) return <div className="screen"><p className="screen__deck">Checking access…</p></div>;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

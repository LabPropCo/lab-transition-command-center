import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider } from "../auth/AuthProvider";
import { TransitionProvider } from "../transitions/TransitionProvider";
import { RequireAuth } from "./RequireAuth";
import { AppShell } from "./AppShell";
import { Login } from "../screens/Login";
import { Screen } from "../screens/Screen";
import { Dashboard } from "../screens/Dashboard";
import { WorkItems } from "../screens/WorkItems";
import { AdminProvider } from "../admin/AdminProvider";
import { RequireAdmin } from "../admin/RequireAdmin";
import { AdminDashboard } from "../screens/admin/AdminDashboard";
import { TransitionSettings } from "../screens/admin/TransitionSettings";
import { MethodologyLibrary } from "../screens/admin/MethodologyLibrary";
import { Properties } from "../screens/admin/Properties";
import { NotFound } from "../screens/NotFound";
import { SCREENS } from "../lib/nav";
import { DevBanner } from "../components/DevBanner";

// AuthProvider wraps everything (login needs it too). PropertyProvider sits
// inside the authed area. M1 routes stay flat; /p/:propertyId/ nesting is a
// deferred deep-link refinement — RLS, not the URL, enforces scoping.
function RootProviders(): ReactNode {
  return (
    <AuthProvider>
      <DevBanner />
      <Outlet />
    </AuthProvider>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootProviders />,
    children: [
      { path: "/login", element: <Login /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: (
              <TransitionProvider>
                <AdminProvider>
                  <AppShell />
                </AdminProvider>
              </TransitionProvider>
            ),
            children: [
              { index: true, element: <Navigate to="/dashboard" replace /> },
              // Admin area (platform-admin only). Additive routes; existing routes unchanged.
              {
                path: "admin",
                element: <RequireAdmin />,
                children: [
                  { index: true, element: <AdminDashboard /> },
                  { path: "transition-settings", element: <TransitionSettings /> },
                  { path: "methodology", element: <MethodologyLibrary /> },
                  { path: "properties", element: <Properties /> },
                ],
              },
              // The rest of the app's screens (admin handled above).
              ...Object.values(SCREENS).filter((s) => s.key !== "admin").map((s) => ({
                path: s.path.replace(/^\//, ""),
                element: s.key === "work-items" ? <WorkItems />
                  : s.key === "dashboard" ? <Dashboard />
                  : <Screen k={s.key} />,
              })),
              { path: "*", element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]);

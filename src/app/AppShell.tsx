import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import { TopBar } from "../components/TopBar";
import { useTransition } from "../transitions/TransitionProvider";
import "../styles/app.css";

export function AppShell() {
  const { selected } = useTransition();
  useEffect(() => {
    document.title = selected ? `${selected.name} · The Lab` : "The Lab · Transition Command Center";
  }, [selected]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <TopBar />
        <main>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

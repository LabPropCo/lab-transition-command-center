import { Link } from "react-router-dom";
import { useTransition } from "../../transitions/TransitionProvider";
import "../../styles/admin.css";

export function AdminDashboard() {
  const { selected, properties } = useTransition();
  return (
    <section className="screen">
      <h1 className="screen__title">Admin</h1>
      <p className="screen__deck">Manage transition metadata, the methodology, people, and data.</p>

      <div className="admin__cards">
        <Link to="/admin/transition-settings" className="admin__card">
          <div className="admin__card-title">Transition Settings</div>
          <div className="admin__card-deck">Name, company, go-live date, managers, branding, and notes.</div>
          <div className="admin__card-meta">{selected?.name ?? "—"}</div>
        </Link>

        <Link to="/admin/methodology" className="admin__card">
          <div className="admin__card-title">Methodology Library</div>
          <div className="admin__card-deck">Master work items, versioning, and transition synchronization.</div>
          <div className="admin__card-meta">Edit methodology</div>
        </Link>
        <Link to="/admin/properties" className="admin__card">
          <div className="admin__card-title">Properties</div>
          <div className="admin__card-deck">{properties.length} in this transition — rename, edit, add, activate.</div>
          <div className="admin__card-meta">Manage properties</div>
        </Link>
        <div className="admin__card admin__card--soon" aria-disabled>
          <div className="admin__card-title">Users</div>
          <div className="admin__card-deck">Invite, roles, and transition/property assignment.</div>
          <div className="admin__card-meta">Next phase</div>
        </div>
      </div>
    </section>
  );
}

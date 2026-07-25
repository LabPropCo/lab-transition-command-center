import { useTransition } from "../transitions/TransitionProvider";
import { useAuth } from "../auth/AuthProvider";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + "T00:00:00").getTime() - today.getTime()) / 86_400_000);
}

export function TopBar() {
  const { transitions, selected, selectTransition, properties, propertyFilter, setPropertyFilter, loading, error, reload } = useTransition();
  const { user, signOut } = useAuth();
  const d = selected ? daysUntil(selected.targetGoLive) : null;
  const countdown = d === null ? "" : d > 0 ? `${d} days to go-live` : d === 0 ? "Go-live today" : `Live · day ${Math.abs(d)}`;

  // Distinguish the states that used to all collapse to "No transition".
  let heading: React.ReactNode;
  if (loading) {
    heading = <div className="topbar__prop topbar__prop--muted">Loading transition…</div>;
  } else if (error) {
    heading = <div className="topbar__prop topbar__prop--err">Couldn’t load transitions</div>;
  } else if (transitions.length > 1) {
    heading = (
      <select className="topbar__tsel" value={selected?.id ?? ""} onChange={(e) => selectTransition(e.target.value)}>
        {transitions.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    );
  } else if (selected) {
    heading = <div className="topbar__prop">{selected.name}</div>;
  } else {
    heading = <div className="topbar__prop topbar__prop--muted">No transitions available</div>;
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar__left">
          {selected?.logoUrl ? <img className="topbar__logo" src={selected.logoUrl} alt="" /> : null}
          {heading}
          <div className="topbar__client">
            {selected?.companyName ?? selected?.ownershipGroup ?? ""}{selected && properties.length ? ` · ${properties.length} properties` : ""}
          </div>
        </div>

        <div className="topbar__right">
          {!loading && !error && properties.length > 0 && (
            <select className="switcher" aria-label="Filter by property"
              value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)}>
              <option value="all">All properties</option>
              <option value="shared">Shared (transition-wide)</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {countdown && <span className="chip"><span className="chip__dot" aria-hidden />{countdown}</span>}
          <div className="topbar__user" title={user?.email ?? ""}>
            <span className="topbar__email">{user?.email}</span>
            <button className="topbar__signout" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </header>

      {error && (
        <div className="loadbar" role="alert">
          <span className="loadbar__msg">{error}</span>
          <button className="loadbar__retry" onClick={reload}>Retry</button>
        </div>
      )}
    </>
  );
}

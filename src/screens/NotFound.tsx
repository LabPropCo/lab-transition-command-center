import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <section className="screen">
      <h1 className="screen__title">Page not found</h1>
      <p className="screen__deck">That screen doesn't exist. Head back to the dashboard.</p>
      <div className="placeholder">
        <div className="placeholder__head">Nothing here</div>
        <p className="placeholder__body">
          The link may be out of date. <Link to="/dashboard">Return to the dashboard</Link>.
        </p>
      </div>
    </section>
  );
}

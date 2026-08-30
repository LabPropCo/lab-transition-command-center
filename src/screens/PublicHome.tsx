import "../styles/public-home.css";

// The public homepage at thelabpropco.com — the only unauthenticated route
// besides /login. The hero is a complete composition of four connected
// layers (header, positioning, property evidence, operating loop), and the
// operating loop becomes a recurring structural idea the rest of the page
// expands rather than repeats. Translates three real patterns from the
// internal tools: the status-badge pill (Variance Comment Builder), the
// nav active-indicator rule extended into a throughline (Transition
// Command Center), and the Rhythm Table's cause -> effect structure (the
// Design System). Deliberately not a dashboard: no login button, no
// metrics, no employee-tool surface.
export function PublicHome() {
  return (
    <div className="ph">
      <div className="ph__hero">
        <div className="ph__inner ph__header">
          <img
            className="ph__logo"
            src="/brand/lab-logo-reversed-white.svg"
            alt="The Lab Property Company"
          />
          <ul className="ph__nav">
            <li><a href="#operate">How We Operate</a></li>
            <li><a href="#manage">What We Do</a></li>
            <li><a href="#standard">The Standard</a></li>
          </ul>
        </div>

        <div className="ph__inner ph__hero-primary">
          <p className="ph__hero-eyebrow">Multifamily Property Management</p>
          <h1 className="ph__h1">Disciplined operations. Better outcomes.</h1>
          <p className="ph__hero-sub">
            The Lab is a multifamily property management company where clear
            standards, accountable teams, and continuous improvement drive
            stronger property performance.
          </p>
        </div>

        <div className="ph__hero-evidence">
          <img
            src="/photography/river-run-exterior-a.jpg"
            alt="River Run, a Lab-managed multifamily community, set above the river"
          />
          <div className="ph__hero-evidence-caption">
            <span className="dot" />
            River Run &middot; Lab-Managed Community
          </div>
        </div>

        <div className="ph__loop-band">
          <div className="ph__loop-stage">
            <p className="ph__loop-stage-label">Clear Standards</p>
          </div>
          <div className="ph__loop-stage">
            <p className="ph__loop-stage-label">Accountable Ownership</p>
          </div>
          <div className="ph__loop-stage">
            <p className="ph__loop-stage-label">Disciplined Execution</p>
          </div>
          <div className="ph__loop-stage">
            <p className="ph__loop-stage-label">Continuous Improvement</p>
          </div>
        </div>
      </div>

      <div className="ph__system">
        <div className="ph__inner ph__thesis">
          <p className="ph__thesis-eyebrow">The Operating Thesis</p>
          <div className="ph__thesis-row">
            <p className="ph__thesis-maxim">
              Places feel the way they are run<span className="dot">.</span>
            </p>
            <div className="ph__thesis-explain">
              <p>
                Strong performance is rarely the result of one dramatic
                decision. It is built through the standards teams follow,
                the issues they refuse to walk past, and the improvements
                they make every day.
              </p>
            </div>
          </div>
        </div>

        <div className="ph__inner ph__section" id="operate">
          <p className="ph__section-eyebrow">How We Operate</p>
          <h2 className="ph__section-title">The Operating Loop, in Practice</h2>
          <p className="ph__section-deck">
            The same four stages from above — what each one looks like on a
            real property, and the result it's built to produce.
          </p>
          <div className="ph__loop-expand">
            <div className="ph__loop-expand-row">
              <span className="stage">Clear Standards</span>
              <span className="detail">Every property runs on the same clean systems and expectations.</span>
              <span className="produces">Better-run properties</span>
            </div>
            <div className="ph__loop-expand-row">
              <span className="stage">Accountable Ownership</span>
              <span className="detail">Teams treat the outcome as theirs to answer for, not the org chart's.</span>
              <span className="produces">Stronger teams</span>
            </div>
            <div className="ph__loop-expand-row">
              <span className="stage">Disciplined Execution</span>
              <span className="detail">Standards hold under pressure, not just when it's convenient.</span>
              <span className="produces">Clearer decisions</span>
            </div>
            <div className="ph__loop-expand-row">
              <span className="stage">Continuous Improvement</span>
              <span className="detail">No process is ever final — we test, measure, and refine on a fixed rhythm.</span>
              <span className="produces">Improved performance</span>
            </div>
          </div>
        </div>

        <div className="ph__inner ph__section" id="manage">
          <p className="ph__section-eyebrow">What We Do</p>
          <h2 className="ph__section-title">Multifamily Management</h2>
          <p className="ph__section-deck">
            A full-service, restrained approach to running real communities well.
          </p>
          <div className="ph__manage-grid">
            <ul className="ph__capabilities-list">
              <li className="ph__capabilities-row">
                <span className="num">01</span>
                <b>Property Operations</b>
                <span>Standards, accountability, resident experience, and disciplined daily execution.</span>
              </li>
              <li className="ph__capabilities-row">
                <span className="num">02</span>
                <b>Financial Performance</b>
                <span>Clear reporting, disciplined expense management, and decisions tied to property outcomes.</span>
              </li>
              <li className="ph__capabilities-row">
                <span className="num">03</span>
                <b>Maintenance &amp; Capital Planning</b>
                <span>Fixing the reason, not just the symptom.</span>
              </li>
              <li className="ph__capabilities-row">
                <span className="num">04</span>
                <b>Team Development &amp; Culture</b>
                <span>Leaders who build leaders, property by property.</span>
              </li>
            </ul>
            <div className="ph__manage-photo">
              <img
                src="/photography/river-run-clubhouse.jpg"
                alt="The River Run clubhouse, a Lab-managed community space"
              />
              <div className="ph__manage-photo-caption">River Run &middot; Clubhouse</div>
            </div>
          </div>
        </div>
      </div>

      <div className="ph__standard" id="standard">
        <div className="ph__inner ph__standard-head">
          <p className="ph__standard-eyebrow">The Operating Standard</p>
          <h2 className="ph__standard-title">Run today. Improve tomorrow. Always both.</h2>
        </div>
        <div className="ph__inner">
          <div className="ph__standard-split">
            <div className="ph__standard-col">
              <h3>Run today.</h3>
              <ul>
                <li>Run the property well, exactly as it is today.</li>
                <li>Hit the numbers.</li>
                <li>Take care of the people here right now.</li>
                <li>Follow through on what can't wait.</li>
              </ul>
            </div>
            <div className="ph__standard-col">
              <h3>Improve tomorrow.</h3>
              <ul>
                <li>Challenge the status quo, including the parts we wrote.</li>
                <li>Fix the reason, not just the symptom.</li>
                <li>Run the small experiment, then teach what we learn.</li>
                <li>Leave the next leader further ahead than we started.</li>
              </ul>
            </div>
          </div>
          <div className="ph__standard-bridge">
            <b>Always both.</b>
            <span>Every leader here carries two responsibilities: run today's business and improve how we operate tomorrow. Neither is optional.</span>
          </div>
        </div>
      </div>

      <div className="ph__closing">
        <div className="ph__inner">
          <p className="ph__closing-final">
            Every improvement compounds<span className="dot">.</span>
          </p>
          <p className="ph__closing-explain">
            Better standards create better actions. Better actions create
            stronger properties. Repeated consistently, the gains multiply.
          </p>
        </div>
      </div>

      <div className="ph__inner ph__footer">
        <img className="ph__footer-logo" src="/brand/lab-logo-primary-black.svg" alt="The Lab Property Company" />
        <div className="ph__footer-name">The Lab Property Company LLC</div>
        <div className="ph__footer-address">
          2198 E. Camelback Rd., Suite 240
          <br />
          Phoenix, AZ 85016
        </div>
        <div className="ph__footer-copyright">
          © {new Date().getFullYear()} The Lab Property Company LLC
        </div>
        <div className="ph__footer-easteregg">Leave it better than you found it.</div>
      </div>
    </div>
  );
}

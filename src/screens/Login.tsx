import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import "../styles/login.css";

// Invite-only, OTP-primary sign-in.
// - signInWithOtp is always called with shouldCreateUser:false, so this screen
//   can never create an account.
// - After "Send code" we ALWAYS advance to the code step with a generic message,
//   regardless of whether the email is registered, so the user list can't be probed.
export function Login() {
  const { configured } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendCode() {
    setError(""); setBusy(true);
    // Fire and forget the result on purpose — never reveal existence.
    await supabase?.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    }).catch(() => {});
    setBusy(false);
    setStep("code");
  }

  async function verify() {
    if (!supabase) return;
    setError(""); setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) setError("That code didn't work. Check the code and try again.");
    // On success, onAuthStateChange flips the session and the guard redirects.
  }

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__brand">The&nbsp;Lab<span>.</span></div>
        <div className="login__sub">Transition Command Center</div>

        {!configured && (
          <p className="login__notice">
            Backend not configured. Add <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code>, then reload.
          </p>
        )}

        {step === "email" ? (
          <>
            <label className="login__label" htmlFor="email">Work email</label>
            <input
              id="email" className="login__input" type="email" autoComplete="email"
              placeholder="you@company.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && email) sendCode(); }}
            />
            <button className="login__btn" disabled={!email || busy || !configured} onClick={sendCode}>
              {busy ? "Sending…" : "Send sign-in code"}
            </button>
            <p className="login__hint">Access is invite-only. Ask an administrator if you need an account.</p>
          </>
        ) : (
          <>
            <p className="login__generic">
              If <strong>{email}</strong> is registered, we've emailed a 6-digit code.
              Enter it below.
            </p>
            <label className="login__label" htmlFor="code">6-digit code</label>
            <input
              id="code" className="login__input login__input--code" inputMode="numeric"
              maxLength={6} placeholder="••••••" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) verify(); }}
            />
            {error && <p className="login__error">{error}</p>}
            <button className="login__btn" disabled={code.length !== 6 || busy} onClick={verify}>
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>
            <button className="login__link" onClick={() => { setStep("email"); setCode(""); setError(""); }}>
              Use a different email
            </button>
          </>
        )}
      </div>
    </div>
  );
}

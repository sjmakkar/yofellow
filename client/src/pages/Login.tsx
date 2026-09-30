import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { tokenStore, type Me } from "../api";
import { useApp } from "../App";
import {
  authConfig,
  createEmailAccount,
  devEmailLogin,
  finishVerification,
  NeedsVerification,
  resendVerification,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
  type LoginMethod,
} from "../lib/auth";
import { sendCode, confirmCode } from "../lib/phoneAuth";

type Step = "choose" | "signin" | "signup" | "forgot" | "verify" | "phone" | "code";

export default function Login() {
  const { setMe } = useApp();
  const [methods, setMethods] = useState<LoginMethod[] | null>(null);
  const [step, setStep] = useState<Step>("choose");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [info, setInfo] = useState("");
  const [err, setErr] = useState(() => {
    const n = sessionStorage.getItem("yf_notice") || "";
    sessionStorage.removeItem("yf_notice");
    return n;
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authConfig()
      .then((c) => setMethods(c.loginMethods ?? (c.firebase ? ["google", "email"] : ["dev"])))
      .catch(() => setMethods([]));
  }, []);

  const done = (r: { token: string; user: Me }) => {
    tokenStore.set(r.token);
    setMe(r.user);
  };
  const go = (s: Step) => {
    setErr("");
    setInfo("");
    setStep(s);
  };

  async function run(fn: () => Promise<void>) {
    setErr("");
    setInfo("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof NeedsVerification) {
        setInfo(e.message);
        setStep("verify");
      } else setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const submit = (fn: () => Promise<void>) => (e: React.FormEvent) => {
    e.preventDefault();
    run(fn);
  };

  const dev = methods?.includes("dev");
  const pwOk = password.length >= 8;

  return (
    <div className="login">
      <div className="hero">
        <img src="/icon.svg" width={64} height={64} alt="" />
        <h1>YoFellow</h1>
        <p>Long journey? Find someone on the same train, flight or bus who matches your vibe.</p>
      </div>

      {!methods ? (
        <p className="muted center-text">Loading…</p>
      ) : dev && step === "choose" ? (
        <form className="card stack" onSubmit={submit(async () => done(await devEmailLogin(email, name || undefined)))}>
          <p className="hint">Dev mode: no Firebase settings, so any email works without a password.</p>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus required />
          </label>
          <button className="btn primary" disabled={busy || !email.includes("@")}>
            Continue
          </button>
          <button type="button" className="linkbtn" onClick={() => go("phone")}>
            Use phone number (dev code)
          </button>
        </form>
      ) : step === "choose" ? (
        <div className="card stack">
          {methods.includes("google") && (
            <button className="btn google" disabled={busy} onClick={() => run(async () => done(await signInWithGoogle()))}>
              <GoogleG /> {busy ? "Opening Google…" : "Continue with Google"}
            </button>
          )}
          {methods.includes("email") && (
            <>
              <div className="divider">
                <span>or</span>
              </div>
              <button className="btn" onClick={() => go("signin")}>
                ✉️ Sign in with email
              </button>
              <button className="btn ghost" onClick={() => go("signup")}>
                Create an account with email
              </button>
            </>
          )}
          {methods.includes("phone") && (
            <button className="linkbtn" onClick={() => go("phone")}>
              Use phone number instead
            </button>
          )}
        </div>
      ) : step === "signin" ? (
        <form className="card stack" onSubmit={submit(async () => done(await signInWithEmail(email, password)))}>
          <h3>Sign in</h3>
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="btn primary" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <div className="row between">
            <button type="button" className="linkbtn" onClick={() => go("forgot")}>
              Forgot password?
            </button>
            <button type="button" className="linkbtn" onClick={() => go("signup")}>
              New here? Create account
            </button>
          </div>
          <button type="button" className="btn ghost" onClick={() => go("choose")}>
            ← Other ways to sign in
          </button>
        </form>
      ) : step === "signup" ? (
        <form className="card stack" onSubmit={submit(() => createEmailAccount(name, email, password))}>
          <h3>Create your account</h3>
          <label>
            First name
            <input value={name} maxLength={40} autoComplete="given-name" onChange={(e) => setName(e.target.value)} autoFocus required />
          </label>
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <p className="hint">At least 8 characters. We'll email you a link to verify your address.</p>
          <button className="btn primary" disabled={busy || !name.trim() || !email || !pwOk}>
            {busy ? "Creating…" : "Create account"}
          </button>
          <button type="button" className="linkbtn" onClick={() => go("signin")}>
            Already have an account? Sign in
          </button>
          <button type="button" className="btn ghost" onClick={() => go("choose")}>
            ← Other ways to sign in
          </button>
        </form>
      ) : step === "forgot" ? (
        <form
          className="card stack"
          onSubmit={submit(async () => {
            await resetPassword(email);
            setInfo(`If an account exists for ${email}, a reset link is on its way. Check spam too.`);
          })}
        >
          <h3>Reset password</h3>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          </label>
          <button className="btn primary" disabled={busy || !email}>
            Send reset link
          </button>
          <button type="button" className="btn ghost" onClick={() => go("signin")}>
            ← Back to sign in
          </button>
        </form>
      ) : step === "verify" ? (
        <div className="card stack center-text">
          <div className="bigicon">📬</div>
          <h3>Check your inbox</h3>
          {info && <p className="info">{info}</p>}
          <button className="btn primary" disabled={busy} onClick={() => run(async () => done(await finishVerification()))}>
            {busy ? "Checking…" : "I've verified, continue"}
          </button>
          <button
            className="btn ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await resendVerification();
                setInfo(`Sent again to ${email || "your email"}. Check spam too.`);
              })
            }
          >
            Resend email
          </button>
          <button className="linkbtn" onClick={() => go("signin")}>
            Use a different email
          </button>
        </div>
      ) : step === "phone" ? (
        <form
          className="card stack"
          onSubmit={submit(async () => {
            const r = await sendCode(phone.replace(/[\s-]/g, ""), "recaptcha");
            setDevCode(r.devCode);
            setStep("code");
          })}
        >
          <label>
            Phone number
            <input key="phone" inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
          </label>
          <button className="btn primary" disabled={busy || phone.replace(/\D/g, "").length < 10}>
            {busy ? "Sending…" : "Send code"}
          </button>
          <button type="button" className="btn ghost" onClick={() => go("choose")}>
            ← Back
          </button>
        </form>
      ) : (
        <form className="card stack" onSubmit={submit(async () => done(await confirmCode(phone.replace(/[\s-]/g, ""), code)))}>
          <label>
            Enter the 6 digit code sent to {phone}
            <input key="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
          </label>
          {devCode && <p className="hint">Dev mode: your code is {devCode}</p>}
          <button className="btn primary" disabled={busy || code.length !== 6}>
            Verify
          </button>
          <button type="button" className="btn ghost" onClick={() => go("phone")}>
            Change number
          </button>
        </form>
      )}

      {info && step !== "verify" && <p className="info">{info}</p>}
      {err && <p className="error">{err}</p>}
      <div id="recaptcha" />
      <p className="fine">
        18+ only. Your seat is never shown unless both of you agree to meet. By continuing you agree to our <Link to="/terms">Terms</Link> and{" "}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5.1 2.4-8.7 2.4-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

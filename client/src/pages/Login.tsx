import { useEffect, useState } from "react";
import { tokenStore } from "../api";
import { sendCode, confirmCode, loginMode } from "../lib/phoneAuth";
import { useApp } from "../App";

export default function Login() {
  const { setMe } = useApp();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [devCode, setDevCode] = useState<string | undefined>();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const cleanPhone = phone.replace(/[\s-]/g, "");
  const [realSms, setRealSms] = useState(false);
  useEffect(() => {
    loginMode().then((c) => setRealSms(!!c));
  }, []);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await sendCode(cleanPhone, "recaptcha");
      setDevCode(r.devCode);
      setStep("code");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await confirmCode(cleanPhone, code);
      tokenStore.set(r.token);
      setMe(r.user);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="hero">
        <img src="/icon.svg" width={64} height={64} alt="" />
        <h1>YoFellow</h1>
        <p>Long journey? Find someone on the same train, flight or bus who matches your vibe.</p>
      </div>
      {step === "phone" ? (
        <form onSubmit={sendOtp} className="card stack">
          <label>
            Phone number
            <input key="phone" inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
          </label>
          <button className="btn primary" disabled={busy || cleanPhone.length < 10}>
            {busy ? "Sending…" : "Send code"}
          </button>
          {realSms && <p className="hint">We'll send you an SMS with a 6 digit code. Numbers without +country code are treated as Indian (+91).</p>}
        </form>
      ) : (
        <form onSubmit={verify} className="card stack">
          <label>
            Enter the 6 digit code sent to {phone}
            <input key="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
          </label>
          {devCode && <p className="hint">Dev mode: your code is {devCode}</p>}
          <button className="btn primary" disabled={busy || code.length !== 6}>
            Verify
          </button>
          <button type="button" className="btn ghost" onClick={() => setStep("phone")}>
            Change number
          </button>
        </form>
      )}
      {err && <p className="error">{err}</p>}
      <div id="recaptcha" />
      <p className="fine">18+ only. Your seat is never shown unless both of you agree to meet.</p>
    </div>
  );
}

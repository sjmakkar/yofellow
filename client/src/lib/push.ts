// Web push: ask permission, subscribe this browser, send the subscription to the server.
// Works on Android Chrome, desktop browsers, and iPhone only after "Add to Home Screen".
import { api } from "../api";

type Config = { firebase: unknown; vapidPublicKey: string; supportEmail: string | null };
let cfgPromise: Promise<Config> | null = null;
export const appConfig = () => (cfgPromise ??= api<Config>("/config").catch((e) => ((cfgPromise = null), Promise.reject(e))));

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;

function urlBase64ToUint8Array(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error(isIos() ? "On iPhone, first tap Share → Add to Home Screen, then open YoFellow from there." : "This browser can't show notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications are blocked. Allow them for this site in your browser settings.");
  const { vapidPublicKey } = await appConfig();
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
  const json = sub.toJSON();
  await api("/push/subscribe", { body: { endpoint: json.endpoint, keys: json.keys } });
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api("/push/unsubscribe", { body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

/** Re-send the subscription after login, so a new account on the same phone gets its alerts. */
export async function refreshPush() {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return;
    const sub = await currentSubscription();
    if (!sub) return;
    const json = sub.toJSON();
    await api("/push/subscribe", { body: { endpoint: json.endpoint, keys: json.keys } });
  } catch {
    /* offline, try next time */
  }
}

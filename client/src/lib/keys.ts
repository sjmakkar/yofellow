// Each device has its own Ed25519 key. Group messages are signed with it, so
// phones and the server can check that a message relayed over Bluetooth was
// really written by that person and not changed on the way.
import { newKeypair } from "../../../shared/mesh";
import { kvGet, kvSet } from "./idb";
import { api } from "../api";

type Keypair = { publicKey: string; secretKey: string };

export async function deviceKey(): Promise<Keypair> {
  let kp = await kvGet<Keypair>("device-key");
  if (!kp) {
    kp = newKeypair();
    await kvSet("device-key", kp);
  }
  return kp;
}

export type KeyCert = { user: number; pubkey: string; sig: string };
export const deviceCert = () => kvGet<KeyCert>("device-cert");

export async function registerDeviceKey() {
  const kp = await deviceKey();
  const cert = await deviceCert();
  if (cert?.pubkey === kp.publicKey) return kp;
  try {
    // The server returns a certificate for our key. We attach it to group
    // messages, so phones that never met us online can still verify them.
    const r = await api<{ cert: KeyCert; serverKey: string }>("/me/key", { method: "PUT", body: { pubkey: kp.publicKey } });
    await kvSet("device-cert", r.cert);
    await kvSet("server-key", r.serverKey);
  } catch {
    /* try again next time we are online */
  }
  return kp;
}

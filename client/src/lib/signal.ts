// Signal map on the phone: log (position, online?) once a minute during the
// journey, upload through the outbox, and forecast drops from past riders.
import { useEffect, useState } from "react";
import { predictSignal, describePrediction, type Sample } from "../../../shared/signal";
import { enqueue } from "./outbox";
import { net } from "./net";

export function consentKey(tripId: number) {
  return `tb_signal_${tripId}`;
}

export function usePosition(enabled: boolean) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => setError(e.code === 1 ? "Location permission denied" : "Location unavailable"),
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 30000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { pos, error };
}

/** Records one sample a minute and sends them in batches of 10. */
export function useSignalLogger(tripId: number, active: boolean, pos: { lat: number; lng: number } | null) {
  useEffect(() => {
    if (!active) return;
    let buffer: object[] = [];
    const tick = () => {
      if (!pos) return;
      buffer.push({ lat: pos.lat, lng: pos.lng, online: net.get().status !== "offline", ts: Date.now() });
      if (buffer.length >= 10) {
        enqueue({ op: "signal", tripId, samples: buffer });
        buffer = [];
      }
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => {
      clearInterval(id);
      if (buffer.length) enqueue({ op: "signal", tripId, samples: buffer });
    };
  }, [tripId, active, pos?.lat, pos?.lng]);
}

export function forecast(signal: [string, number, number, number, number][] | undefined, pos: { lat: number; lng: number } | null) {
  if (!signal || !pos) return null;
  const samples: Sample[] = signal.map(([run, ts, lat, lng, on]) => ({ run, ts, lat, lng, online: !!on }));
  const p = predictSignal(samples, pos.lat, pos.lng);
  return { ...p, text: describePrediction(p) };
}

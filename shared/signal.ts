// Crowd sourced signal map. Phones on a journey record (position, online?) every
// minute. For the same train/flight/bus number, past runs tell us where the
// network drops and when it comes back, so we can predict it for today's riders.

export type Sample = { run: string; ts: number; lat: number; lng: number; online: boolean };

export type Prediction = {
  basis: number; // how many past runs were used
  onlineNow: boolean | null; // what past riders usually had at this spot
  dropsInMin: number | null; // minutes until network usually drops (if online now)
  dropForMin: number | null; // how long the dead zone usually lasts
  returnsInMin: number | null; // minutes until network usually returns (if offline now)
};

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};

/** Index where the next real dead zone starts (offline for at least minDeadMin), or -1. */
function nextDeadZone(run: Sample[], from: number, minDeadMin: number) {
  for (let k = from + 1; k < run.length; k++) {
    if (run[k].online) continue;
    let j = k;
    while (j + 1 < run.length && !run[j + 1].online) j++;
    const end = j + 1 < run.length ? run[j + 1].ts : run[j].ts;
    if ((end - run[k].ts) / 60000 >= minDeadMin) return k;
    k = j; // skip a short blip
  }
  return -1;
}

export function predictSignal(samples: Sample[], lat: number, lng: number, radiusKm = 4, minDeadMin = 5): Prediction {
  const runs = new Map<string, Sample[]>();
  for (const s of samples) {
    if (!runs.has(s.run)) runs.set(s.run, []);
    runs.get(s.run)!.push(s);
  }
  const onlineVotes: boolean[] = [];
  const drops: number[] = [];
  const dropFor: number[] = [];
  const returns: number[] = [];

  for (const run of runs.values()) {
    run.sort((a, b) => a.ts - b.ts);
    // nearest sample of this past run to where we are now
    let best = -1;
    let bestD = Infinity;
    run.forEach((s, i) => {
      const d = distanceKm(lat, lng, s.lat, s.lng);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0 || bestD > radiusKm) continue;
    const here = run[best];
    onlineVotes.push(here.online);
    const mins = (a: Sample, b: Sample) => (b.ts - a.ts) / 60000;
    if (here.online) {
      const k = nextDeadZone(run, best, minDeadMin);
      if (k > 0) {
        drops.push(mins(here, run[k]));
        const j = run.findIndex((s, i) => i > k && s.online);
        if (j > 0) dropFor.push(mins(run[k], run[j]));
      }
    } else {
      const j = run.findIndex((s, i) => i > best && s.online);
      if (j > 0) returns.push(mins(here, run[j]));
    }
  }

  const basis = onlineVotes.length;
  const onlineNow = basis ? onlineVotes.filter(Boolean).length >= basis / 2 : null;
  return {
    basis,
    onlineNow,
    dropsInMin: onlineNow ? median(drops) : null,
    dropForMin: onlineNow ? median(dropFor) : null,
    returnsInMin: onlineNow === false ? median(returns) : null,
  };
}

export function describePrediction(p: Prediction): string {
  if (!p.basis) return "No signal data for this spot yet. Your trip helps build the map.";
  const from = `based on ${p.basis} past trip${p.basis > 1 ? "s" : ""}`;
  if (p.onlineNow === false) {
    return p.returnsInMin != null
      ? `Weak zone. Network usually returns in about ${p.returnsInMin} min (${from}).`
      : `Weak zone ahead for a while (${from}).`;
  }
  if (p.dropsInMin != null) {
    const dur = p.dropForMin != null ? ` for about ${p.dropForMin} min` : "";
    return `Network usually drops in about ${p.dropsInMin} min${dur} (${from}). Messages will queue and send later.`;
  }
  return `Good network expected for the rest of this stretch (${from}).`;
}

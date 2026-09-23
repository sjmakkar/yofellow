// Simulates a train with no internet: phones only reach phones in their own or
// the next coach (like Bluetooth range), links flicker as people move, and one
// phone gets signal at a station. Run: npx tsx shared/mesh-sim.ts
import { MeshNode, newKeypair, signEnvelope, uuid, type Transport, type WireMsg } from "./mesh";

type Phone = { id: string; user: number; coach: number; node: MeshNode; keys: ReturnType<typeof newKeypair> };

export function simulate(opts: { coaches?: number; perCoach?: number; messages?: number; rounds?: number; seed?: number } = {}) {
  const coaches = opts.coaches ?? 18;
  const perCoach = opts.perCoach ?? 4;
  const messages = opts.messages ?? 60;
  const rounds = opts.rounds ?? 30;
  let seed = opts.seed ?? 42;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  const queue: (() => void)[] = [];
  const handlers = new Map<string, { msg?: (f: string, m: WireMsg) => void; peer?: (p: string, up: boolean) => void }>();
  const links = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const neighbours = (id: string) => [...links].filter((l) => l.split("|").includes(id)).map((l) => l.split("|").find((x) => x !== id)!);
  let frames = 0;

  const makeTransport = (id: string): Transport => {
    handlers.set(id, {});
    return {
      send(to, msg) {
        const targets = to ? [to] : neighbours(id);
        for (const t of targets) {
          if (!links.has(key(id, t))) continue;
          frames++;
          queue.push(() => handlers.get(t)?.msg?.(id, structuredClone(msg)));
        }
      },
      onMessage(cb) {
        handlers.get(id)!.msg = cb;
      },
      onPeer(cb) {
        handlers.get(id)!.peer = cb;
      },
    };
  };

  const pubkeys = new Map<number, string[]>();
  const phones: Phone[] = [];
  let uid = 1;
  for (let c = 0; c < coaches; c++) {
    for (let i = 0; i < perCoach; i++) {
      const id = `p${c}-${i}`;
      const keys = newKeypair();
      const user = uid++;
      pubkeys.set(user, [keys.publicKey]);
      const node = new MeshNode({ transport: makeTransport(id), keysFor: (s) => pubkeys.get(s) });
      phones.push({ id, user, coach: c, node, keys });
    }
  }

  const drain = () => {
    while (queue.length) queue.shift()!();
  };
  const setLink = (a: string, b: string, up: boolean) => {
    const k = key(a, b);
    if (up === links.has(k)) return;
    if (up) links.add(k);
    else links.delete(k);
    handlers.get(a)?.peer?.(b, up);
    handlers.get(b)?.peer?.(a, up);
  };

  // One attacker who is not on the passenger list tries to inject messages.
  const attacker = newKeypair();

  const posted: string[] = [];
  const perRound = Math.ceil(messages / rounds);
  for (let r = 0; r < rounds; r++) {
    // Bluetooth reaches own coach reliably, next coach only sometimes.
    for (const a of phones)
      for (const b of phones) {
        if (a.id >= b.id) continue;
        const gap = Math.abs(a.coach - b.coach);
        const p = gap === 0 ? 0.8 : gap === 1 ? 0.25 : 0;
        setLink(a.id, b.id, rand() < p);
      }
    drain();
    for (let m = 0; m < perRound && posted.length < messages; m++) {
      const ph = phones[Math.floor(rand() * phones.length)];
      const e = signEnvelope({ id: uuid(), room: 1, sender: ph.user, name: `U${ph.user}`, body: `hello from coach ${ph.coach + 1}`, ts: Date.now(), hops: 0, ttl: 12 }, ph.keys.secretKey);
      ph.node.publish(e);
      posted.push(e.id);
    }
    if (r === 3) {
      const forged = signEnvelope({ id: uuid(), room: 1, sender: 1, name: "U1", body: "fake", ts: Date.now(), hops: 0, ttl: 12 }, attacker.secretKey);
      phones[5].node.publish(forged); // own node rejects it
      handlers.get(phones[6].id)?.msg?.(phones[5].id, { t: "env", e: forged }); // pushed raw to a neighbour
    }
    drain();
  }

  // Station stop: one phone in the middle coach gets 4G and uploads everything it holds.
  const gateway = phones.find((p) => p.coach === Math.floor(coaches / 2))!;
  const server = new Set(gateway.node.all().map((e) => e.id));

  const coverage = phones.map((p) => posted.filter((id) => p.node.has(id)).length / posted.length);
  const avg = coverage.reduce((a, b) => a + b, 0) / coverage.length;
  const rejected = phones.reduce((a, p) => a + p.node.stats.rejected, 0);
  return {
    phones: phones.length,
    messages: posted.length,
    avgCoverage: Math.round(avg * 100),
    minCoverage: Math.round(Math.min(...coverage) * 100),
    serverGotFromOneGateway: Math.round((posted.filter((id) => server.has(id)).length / posted.length) * 100),
    forgedAccepted: phones.some((p) => p.node.all().some((e) => e.body === "fake")),
    rejected,
    frames,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = simulate();
  console.log("Train mesh simulation (no internet on board)");
  console.log(`  ${r.phones} phones in 18 coaches, ${r.messages} group messages`);
  console.log(`  Average phone received ${r.avgCoverage}% of messages (worst phone ${r.minCoverage}%)`);
  console.log(`  One phone getting 4G at a station uploads ${r.serverGotFromOneGateway}% of all messages`);
  console.log(`  Forged message accepted anywhere: ${r.forgedAccepted ? "YES (bug)" : "no"}; rejected frames: ${r.rejected}`);
  console.log(`  Radio frames sent: ${r.frames}`);
}

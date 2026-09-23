# YoFellow

Meet people on the same train, flight, bus or metro. Chat in the journey's group room, match by vibe, play icebreakers, and meet up only when both people agree. Built to keep working when the network doesn't.

## Features

**Social**
- Phone OTP login (dev code `123456`), profile with interests and intent (Friends / Dating / Just chat, per trip)
- **Group rooms per journey**, joined automatically: Whole train, My coach, Women only, plus topic rooms anyone can start
- People tab: co-travellers ranked by a 0 to 100 vibe score; wave, and a mutual wave opens a private chat
- Private chat with typing indicator and 5 icebreaker games
- Mutual Meet: coach revealed only when both tap Meet

**Safety**
- Women only mode and a women only room; dating filtered by "show me"; 18+
- Group rooms block phone numbers and links, slow mode (1 message per second), mute, report (3 reports hide a message), block
- Coach and women rooms are never carried by other phones over the mesh

**Works with bad or no network (3 layers)**
1. **Offline first app**: service worker caches the app, IndexedDB caches data, each trip is saved for offline ("Offline ready"), and every action (group and private messages, game answers, waves, signal data) goes into an outbox that flushes in one `/sync` request when signal returns. Retries never duplicate (every message has an id).
2. **Mesh relay**: group messages are signed (Ed25519) envelopes that phones pass to nearby phones, drop duplicates and forward up to 12 hops. When any phone gets signal, it uploads what it carries, and the server checks every signature, so one phone at a station can sync a whole coach. The server also signs a certificate for each device key, so phones can verify people they never saw online.
3. **Signal map**: with consent, phones record (location, online?) once a minute during the journey. Past runs of the same train number predict "network drops in about 25 min for about 55 min".

## Run it locally

Needs Node 22.13 or newer. The database is the SQLite built into Node, so there is nothing to compile and no Visual Studio or build tools are needed on Windows. You may see an "SQLite is an experimental feature" warning; it is harmless.

```bash
npm run install:all
npm run seed               # demo travellers, group messages, signal data for today's trips
npm run dev:server         # API on :4000, plus the dev radio hub on :4100
npm run dev:client         # app on http://localhost:5173
```

Log in with any 10 digit number and code `123456`, then add **Train 12951** (coach B3) for today.

**Try the offline mesh in a browser:** open two different browsers (or a normal and an incognito window), log in with 2 numbers, and add the same train in both. Then stop the API only and keep the radio hub:

```bash
npm run dev:server:noradio   # terminal 1: API without the hub
npm run radio                # terminal 2: the Bluetooth stand-in
```

Stop terminal 1. Both phones show Offline, and group messages still arrive "via nearby phones". Start it again and everything syncs.

**Mesh simulation:** `npm run mesh-sim` runs 72 phones in 18 coaches with no internet.

## About the dev radio hub

Browsers cannot use Bluetooth mesh. In dev, `server/src/radio.ts` stands in for Bluetooth range: it only passes frames between phones on the same journey and knows nothing about users. The mesh logic (`shared/mesh.ts`) is the real one. For the phone app, write a `Transport` using Bluetooth LE / Wi-Fi Direct (Google Nearby Connections on Android, MultipeerConnectivity on iOS, or a cross platform SDK) in React Native, and reuse `shared/mesh.ts` unchanged.

## Production

```bash
npm run build
NODE_ENV=production JWT_SECRET=... npm start   # serves the app too; radio hub and demo bots are off
```

Before going live: SMS provider in `server/src/auth.ts`, Postgres instead of SQLite (all SQL goes through the small wrapper in `server/src/db.ts`), HTTPS (needed for service workers and location), and the native Bluetooth transport.

## Code map

```
shared/
  mesh.ts        signed envelopes, key certificates, MeshNode gossip + store and forward, group message rules
  signal.ts      network forecast from past runs
  mesh-sim.ts    train simulation
server/src
  routes.ts      auth, profile, trips, people, waves, private chat, games, meet, block, report
  rooms.ts       group rooms, offline pack, /sync outbox endpoint, relay verification, device keys, signal map
  radio.ts       dev only Bluetooth stand-in
  realtime.ts    Socket.IO: per user and per room channels
  vibe.ts games.ts demo.ts seed.ts db.ts auth.ts
client/src
  lib/           idb (IndexedDB), net (status), outbox, keys, mesh (transport), group (message merge), signal
  pages/         Login, Profile, Trips, TripDetail (Group + People), Chats, Chat
  components/    GroupRoom, NetBadge, GameCard, GamePicker, Avatar
  public/sw.js   service worker
```

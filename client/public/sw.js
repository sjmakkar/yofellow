// Service worker: keeps the app shell on the phone so YoFellow opens with no network.
// API data is cached separately in IndexedDB by the app itself.
const CACHE = "yofellow-shell-v3";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

// Cache the shell plus the hashed JS/CSS bundles that index.html points to,
// so the very first visit is already enough to open the app offline later.
self.addEventListener("install", (e) => {
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE);
      await c.addAll(SHELL);
      const html = await (await c.match("/index.html")).text();
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await c.addAll(assets);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/socket.io")) return;

  // Pages: network first, fall back to the cached shell.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          // Copy the response right away, before the browser starts reading it.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }
  // Built assets have hashed names, so cache first is safe.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});

// ---------- Push notifications ----------
self.addEventListener("push", (e) => {
  let p = { title: "YoFellow", body: "You have something new", url: "/" };
  try {
    p = { ...p, ...e.data.json() };
  } catch {}
  e.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      tag: p.tag,
      renotify: !!p.tag,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { url: p.url || "/" },
    })
  );
});

// Tapping a notification opens the right screen, reusing an open YoFellow tab if there is one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin) {
          await w.focus();
          return w.navigate ? w.navigate(url) : undefined;
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});

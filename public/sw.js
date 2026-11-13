/* Service worker: app shell + static assets only. Firebase/Google API traffic, /api/* and every non-GET request always go to the network
   and are never cached, so no authentication response or private data is stored here (Firestore keeps its own IndexedDB cache). */
const VERSION = "v1";
const SHELL = `cs-shell-${VERSION}`, ASSETS = `cs-assets-${VERSION}`, MAX_ASSETS = 150;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("cs-") && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_ASSETS) await Promise.all(keys.slice(0, keys.length - MAX_ASSETS).map((k) => cache.delete(k)));
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(ASSETS), hit = await cache.match(req);
  const net = fetch(req).then((r) => { if (r.ok || r.type === "opaque") { cache.put(req, r.clone()); trim(cache); } return r; }).catch(() => hit);
  return hit || net;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(staleWhileRevalidate(req)); // public fonts only
    return; // Firebase Auth / Firestore / Google APIs: network only
  }
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;
  if (req.mode === "navigate") {
    // Network first so a new deployment is picked up immediately; the cached shell is the offline fallback (single-page app).
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put("/", copy)); } return r; }).catch(() => caches.match("/")));
    return;
  }
  // Built files have content hashes in their names, so cache-first is always correct for them.
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) { e.respondWith(caches.match(req).then((hit) => hit || staleWhileRevalidate(req))); }
});

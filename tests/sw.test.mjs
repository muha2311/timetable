import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ORIGIN = "https://app.example";
const norm = (k) => new URL(typeof k === "string" ? k : k.url, ORIGIN).href;
function makeWorker() {
  const store = new Map(), handlers = {}, net = { online: true, calls: [], bodies: {} };
  const mkCache = (name) => { if (!store.has(name)) store.set(name, new Map()); const m = store.get(name);
    return { async put(k, r) { m.set(norm(k), r); }, async match(k) { return m.get(norm(k)); }, async keys() { return [...m.keys()].map((u) => new Request(u)); }, async delete(k) { return m.delete(norm(k)); },
      async addAll(list) { for (const u of list) m.set(norm(u), await fetchMock(u)); } }; };
  const caches = { open: async (n) => mkCache(n), keys: async () => [...store.keys()], delete: async (n) => store.delete(n), async match(k) { for (const m of store.values()) if (m.has(norm(k))) return m.get(norm(k)); } };
  const fetchMock = async (req) => { const url = norm(req); net.calls.push(url); if (!net.online) throw new TypeError("Failed to fetch"); return new Response(net.bodies[url] ?? `net:${url}`, { status: 200 }); };
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: ORIGIN }, skipWaiting() {}, clients: { claim() {} } };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches, fetch: fetchMock, URL, Promise, Response, Request });
  const dispatch = async (type, extra = {}) => { let p; const ev = { waitUntil: (x) => { p = x; }, respondWith: (x) => { ev.handled = true; p = x; }, ...extra }; handlers[type](ev); return { handled: !!ev.handled, res: p ? await p : undefined }; };
  const get = (url, mode = "cors", method = "GET") => dispatch("fetch", { request: { url, method, mode } });
  return { store, net, dispatch, get, caches };
}
const nav = (w) => w.get(`${ORIGIN}/timetable`, "navigate");

test("1. the app shell is cached on install and the app loads with NO internet connection", async () => {
  const w = makeWorker(); w.net.bodies[`${ORIGIN}/`] = "<html>shell</html>"; await w.dispatch("install");
  w.net.online = false; const r = await nav(w);
  assert.equal(r.handled, true); assert.equal(await r.res.text(), "<html>shell</html>"); // any route falls back to the cached single-page shell
});
test("2. updates: online navigations refresh the cached shell (a new deployment is served next time, also offline)", async () => {
  const w = makeWorker(); await w.dispatch("install");
  w.net.bodies[`${ORIGIN}/timetable`] = "<html>v2</html>"; assert.equal(await (await nav(w)).res.text(), "<html>v2</html>"); // network first
  await new Promise((r) => setTimeout(r, 10)); w.net.online = false; assert.equal(await (await nav(w)).res.text(), "<html>v2</html>");
});
test("3. built (hashed) assets are cached after first use and served offline", async () => {
  const w = makeWorker(); await w.dispatch("install"); const u = `${ORIGIN}/assets/index-abc123.js`;
  assert.equal(await (await w.get(u)).res.text(), `net:${u}`); await new Promise((r) => setTimeout(r, 10));
  w.net.online = false; assert.equal(await (await w.get(u)).res.text(), `net:${u}`);
});
test("4. nothing sensitive is ever cached: Firebase/Google APIs, /api/*, non-GET requests and the worker file bypass the cache entirely", async () => {
  const w = makeWorker(); await w.dispatch("install");
  for (const u of ["https://firestore.googleapis.com/v1/projects/p/databases/(default)/documents:runQuery", "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=k", "https://securetoken.googleapis.com/v1/token", "https://www.googleapis.com/x"]) assert.equal((await w.get(u)).handled, false, u);
  assert.equal((await w.get(`${ORIGIN}/api/users`)).handled, false); assert.equal((await w.get(`${ORIGIN}/sw.js`)).handled, false);
  assert.equal((await w.get(`${ORIGIN}/assets/x.js`, "cors", "POST")).handled, false);
  const all = [...w.store.values()].flatMap((m) => [...m.keys()]); assert.ok(all.every((k) => k.startsWith(ORIGIN) || k.includes("fonts.")), all.join());
  assert.ok(!all.some((k) => /googleapis\.com\/(v1|robot)|identitytoolkit|securetoken|\/api\//.test(k)));
});
test("5. only public Google Fonts from other origins are cached (so Arabic text keeps its font offline)", async () => {
  const w = makeWorker(); const f = "https://fonts.gstatic.com/s/cairo/v28/x.woff2"; assert.equal((await w.get(f)).handled, true); await new Promise((r) => setTimeout(r, 10));
  w.net.online = false; assert.ok((await (await w.get(f)).res.text()).includes("net:"));
});
test("6. a new worker version removes the old caches (no stale shell left behind)", async () => {
  const w = makeWorker(); await w.caches.open("cs-shell-v0"); await w.caches.open("cs-assets-v0"); await w.caches.open("other-app-cache"); await w.dispatch("install"); await w.dispatch("activate");
  const names = await w.caches.keys(); assert.ok(!names.includes("cs-shell-v0") && !names.includes("cs-assets-v0")); assert.ok(names.includes("other-app-cache")); assert.ok(names.includes("cs-shell-v1"));
});

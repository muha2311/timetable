import { test } from "node:test";
import assert from "node:assert/strict";
import { backoffMs, baseCheck, discardOp, enqueue, isNetworkError, MAX_ATTEMPTS, MemoryStore, processOutbox, retryOp, summarizeOps, SyncConflict, syncState } from "../src/domain/outbox.ts";

const mkLock = () => { let held = false; return async (fn) => { if (held) return undefined; held = true; try { return await fn(); } finally { held = false; } }; };
const net = () => Object.assign(new Error("Failed to get document because the client is offline."), { code: "unavailable" });
const input = (o = {}) => ({ id: "op1", type: "timetable.save", targetKey: "timetable:new1", label: "Math", payload: { draft: { x: 1 }, baseUpdatedAt: 100 }, userUid: "u1", ...o });
let clock = 1_000_000;
const deps = (store, run, o = {}) => ({ store, uid: "u1", now: () => clock, run, withLock: mkLock(), ...o });

test("3/4. changes made offline are stored durably and survive a page refresh (new processor, same storage)", async () => {
  const store = new MemoryStore(); await enqueue(store, input(), clock);
  const after = await new MemoryStore().list(); assert.equal(after.length, 0); // a fresh in-memory store is empty...
  assert.equal((await store.list()).length, 1); assert.equal((await store.list())[0].status, "pending"); // ...while the persisted store keeps the op
  assert.deepEqual(Object.keys((await store.list())[0]).sort(), ["attempts", "createdAt", "id", "label", "nextAttemptAt", "payload", "status", "targetKey", "type", "userUid"]); // who/what/when/status/id are all recorded
  assert.ok(!JSON.stringify(await store.list()).match(/password|token|secret/i));
});
test("5. pending changes synchronize automatically once connectivity returns; the queue empties", async () => {
  const store = new MemoryStore(); await enqueue(store, input({ id: "a", targetKey: "k1" }), clock); await enqueue(store, input({ id: "b", targetKey: "k2" }), clock);
  const seen = []; const r = await processOutbox(deps(store, async (op) => { seen.push(op.id); }));
  assert.deepEqual(seen, ["a", "b"]); assert.equal(r.done, 2); assert.equal((await store.list()).length, 0);
});
test("6. a failed synchronization is retried with backoff and keeps order; nothing is lost", async () => {
  const store = new MemoryStore(); await enqueue(store, input({ id: "a", targetKey: "k1" }), clock); await enqueue(store, input({ id: "b", targetKey: "k2" }), clock);
  let calls = 0; const run = async () => { calls++; if (calls === 1) throw net(); };
  const r1 = await processOutbox(deps(store, run)); assert.equal(r1.offline, true); assert.equal(calls, 1); // stopped at the first failure, 'b' untouched
  const [a] = await store.list(); assert.deepEqual([a.status, a.attempts], ["pending", 1]); assert.equal(a.nextAttemptAt, clock + backoffMs(1));
  assert.equal((await processOutbox(deps(store, run))).done, 0); // too early to retry
  clock += 5000; assert.equal((await processOutbox(deps(store, run))).done, 2); assert.equal((await store.list()).length, 0);
  assert.deepEqual([backoffMs(1), backoffMs(2), backoffMs(3), backoffMs(10)], [1000, 2000, 4000, 60000]);
});
test("a permanently unreachable operation ends as 'failed' (visible), not silently dropped", async () => {
  const store = new MemoryStore(); await enqueue(store, input(), clock);
  for (let i = 0; i < MAX_ATTEMPTS; i++) { clock += 70_000; await processOutbox(deps(store, async () => { throw net(); })); }
  assert.equal((await store.list())[0].status, "failed");
});
test("7. duplicate writes are prevented: a successful op is removed and never runs again; repeated edits of one record coalesce into ONE op keeping its id", async () => {
  const store = new MemoryStore();
  await enqueue(store, input({ payload: { draft: { v: 1 }, baseUpdatedAt: 100 } }), clock); await enqueue(store, input({ label: "Math (edited)", payload: { draft: { v: 2 }, baseUpdatedAt: 999 } }), clock);
  const ops = await store.list(); assert.equal(ops.length, 1); assert.deepEqual([ops[0].id, ops[0].payload.draft.v, ops[0].payload.baseUpdatedAt], ["op1", 2, 100]); // newest change, ORIGINAL base
  let n = 0; await processOutbox(deps(store, async () => { n++; })); await processOutbox(deps(store, async () => { n++; })); assert.equal(n, 1);
});
test("7b. two browser tabs processing at the same moment run each operation once (cross-tab lock)", async () => {
  const store = new MemoryStore(); await enqueue(store, input(), clock); let n = 0; const lock = mkLock(); let release; const gate = new Promise((r) => { release = r; });
  const run = async () => { n++; await gate; };
  const a = processOutbox({ ...deps(store, run), withLock: lock }), b = await processOutbox({ ...deps(store, run), withLock: lock });
  assert.equal(b.skipped, true); release(); await a; assert.equal(n, 1);
});
test("a crashed tab's 'syncing' lease expires and the op is picked up again", async () => {
  const store = new MemoryStore(); await enqueue(store, input(), clock); const [op] = await store.list(); await store.put({ ...op, status: "syncing", nextAttemptAt: clock + 120_000 });
  assert.equal((await processOutbox(deps(store, async () => {}))).done, 0); clock += 121_000; assert.equal((await processOutbox(deps(store, async () => {}))).done, 1);
});
test("8. conflicts are detected and held for a decision, never auto-retried or silently overwritten; later operations still sync", async () => {
  const store = new MemoryStore(); await enqueue(store, input({ id: "a", targetKey: "k1" }), clock); await enqueue(store, input({ id: "b", targetKey: "k2" }), clock);
  const r = await processOutbox(deps(store, async (op) => { if (op.id === "a") throw new SyncConflict("modified_elsewhere", { by: "someone" }); }));
  assert.deepEqual([r.conflicts, r.done], [1, 1]); const [c] = await store.list(); assert.deepEqual([c.id, c.status, c.error.code], ["a", "conflict", "modified_elsewhere"]);
  assert.equal((await processOutbox(deps(store, async () => assert.fail("must not retry")))).done, 0);
  await retryOp(store, "a", clock, true); const [again] = await store.list(); assert.deepEqual([again.status, again.payload.force], ["pending", true]); // explicit "apply mine"
  await discardOp(store, "a"); assert.equal((await store.list()).length, 0);
});
test("9. unauthorized operations are rejected when synchronized (kept as 'failed', never applied), and another account's operations are never replayed", async () => {
  const store = new MemoryStore(); await enqueue(store, input({ id: "mine", targetKey: "k1" }), clock); await enqueue(store, input({ id: "theirs", targetKey: "k2", userUid: "u2" }), clock);
  const ran = []; const r = await processOutbox(deps(store, async (op) => { ran.push(op.id); throw Object.assign(new Error("denied"), { code: "permission-denied" }); }));
  assert.deepEqual(ran, ["mine"]); assert.equal(r.failed, 1); const ops = await store.list();
  assert.deepEqual([ops.find((o) => o.id === "mine").status, ops.find((o) => o.id === "mine").error.code, ops.find((o) => o.id === "theirs").status], ["failed", "permission-denied", "pending"]);
});
test("conflict detection: edited elsewhere, deleted elsewhere, replay of an applied op, forced overwrite", () => {
  const op = (o = {}) => ({ id: "op", isNew: false, baseUpdatedAt: 100, ...o });
  assert.equal(baseCheck({ updatedAtMs: 100 }, op()), "apply");
  assert.equal(baseCheck({ updatedAtMs: 150 }, op()), "conflict");
  assert.equal(baseCheck(null, op()), "conflict");
  assert.equal(baseCheck({ updatedAtMs: 150 }, op({ force: true })), "apply");
  assert.equal(baseCheck({ updatedAtMs: 150, lastOpId: "op" }, op()), "already_applied");
  assert.equal(baseCheck(null, op({ isNew: true, baseUpdatedAt: undefined })), "apply");
  assert.equal(baseCheck({ updatedAtMs: 7, lastOpId: "other" }, op({ isNew: true })), "apply");
});
test("10. the UI states: offline, pending, syncing, synced (only after confirmation), failed, conflict", () => {
  const c = (o = {}) => ({ pending: 0, syncing: 0, conflict: 0, failed: 0, ...o });
  assert.equal(syncState(true, c(), false, false), "synced");
  assert.equal(syncState(false, c(), false, false), "offline"); assert.equal(syncState(false, c({ pending: 3 }), false, false), "offline");
  assert.equal(syncState(true, c({ pending: 2 }), false, false), "pending"); assert.equal(syncState(true, c({ pending: 2 }), false, true), "syncing");
  assert.equal(syncState(true, c(), true, false), "syncing"); // Firestore has unacknowledged writes: NOT synced yet
  assert.equal(syncState(true, c({ syncing: 1 }), false, false), "syncing");
  assert.equal(syncState(true, c({ failed: 1 }), false, false), "failed"); assert.equal(syncState(false, c({ conflict: 1, failed: 1 }), false, false), "conflict");
  assert.deepEqual(summarizeOps([{ status: "pending" }, { status: "conflict" }, { status: "failed" }, { status: "pending" }]), { pending: 2, syncing: 0, conflict: 1, failed: 1, total: 4 });
});
test("network error detection", () => { assert.ok(isNetworkError(net())); assert.ok(isNetworkError(new TypeError("Failed to fetch"))); assert.ok(!isNetworkError(Object.assign(new Error("x"), { code: "permission-denied" }))); });

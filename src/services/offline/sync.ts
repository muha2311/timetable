import { clearIndexedDbPersistence, terminate, waitForPendingWrites } from "firebase/firestore";
import { useSyncExternalStore } from "react";
import { discardOp, enqueue, MemoryStore, processOutbox, retryOp, summarizeOps, syncState, type OpType, type OutboxOp, type OutboxStore, type SyncState } from "../../domain/outbox";
import { db } from "../firebase/init";
import { openIdbStore } from "./idbStore";
import { isOnline, nativeFailures, nativeInFlight, onNativeChange } from "./native";

export interface SyncSnapshot { state: SyncState; online: boolean; counts: ReturnType<typeof summarizeOps>; ops: OutboxOp[]; nativePending: boolean; failures: string[]; durable: boolean; updateReady: boolean; uid: string | null }

let store: OutboxStore = new MemoryStore();
let durable = false, uid: string | null = null, processing = false, nativePending = false, updateReady = false, started = false, running = false;
let ops: OutboxOp[] = [];
let runner: (op: OutboxOp) => Promise<void> = async () => { throw new Error("no runner"); };
const subs = new Set<() => void>();
let ready: Promise<void> = Promise.resolve();

function build(): SyncSnapshot {
  const counts = summarizeOps(ops.filter((o) => o.userUid === uid));
  const online = isOnline();
  return { state: syncState(online, counts, nativePending || nativeInFlight() > 0, processing), online, counts, ops, nativePending, failures: nativeFailures(), durable, updateReady, uid };
}
let snap: SyncSnapshot = build();
function emit() { snap = build(); subs.forEach((f) => f()); }
export const setRunner = (f: (op: OutboxOp) => Promise<void>): void => { runner = f; };
export const getSyncSnapshot = (): SyncSnapshot => snap;
const subscribeSync = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useSyncStatus = (): SyncSnapshot => useSyncExternalStore(subscribeSync, getSyncSnapshot, getSyncSnapshot);

async function refreshOps() { ops = await store.list().catch(() => ops); emit(); }
/** Is Firestore holding writes the server has not acknowledged yet? (waitForPendingWrites stays pending until they are.) */
async function refreshNative() {
  if (!db || !isOnline()) { emit(); return; }
  nativePending = await Promise.race([waitForPendingWrites(db).then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), 80))]).catch(() => false);
  emit();
  if (nativePending) setTimeout(() => void refreshNative(), 3000);
}
const withLock = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request("cs-outbox-sync", { ifAvailable: true }, (lock) => (lock ? fn() : Promise.resolve(undefined)));
  if (running) return undefined;
  running = true; try { return await fn(); } finally { running = false; }
};

/** Process the outbox now (also called on reconnect, tab focus and every 20 s while online). */
export async function kick(): Promise<void> {
  await ready;
  if (!uid || !isOnline()) return;
  processing = true; emit();
  try { await processOutbox({ store, uid, now: Date.now, run: runner, withLock, onChange: () => void refreshOps() }); }
  finally { processing = false; await refreshOps(); await refreshNative(); }
}

export function initSync(userUid: string | null): void {
  uid = userUid;
  if (!started && typeof window !== "undefined") {
    started = true;
    ready = openIdbStore(() => void refreshOps()).then((s) => { if (s) { store = s; durable = true; } return refreshOps(); });
    window.addEventListener("online", () => { emit(); void kick(); void refreshNative(); });
    window.addEventListener("offline", emit);
    window.addEventListener("app-update-ready", () => { updateReady = true; emit(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void kick(); });
    onNativeChange(() => { emit(); void refreshNative(); });
    setInterval(() => { if (isOnline() && uid) void kick(); }, 20000);
  }
  emit();
  void ready.then(() => kick());
}

export async function queueOp(input: { id: string; type: OpType; targetKey: string; label: string; payload: unknown }): Promise<void> {
  await ready;
  if (!uid) throw new Error("unauthenticated");
  await enqueue(store, { ...input, userUid: uid }, Date.now());
  await refreshOps();
}
export const retry = async (id: string, force = false): Promise<void> => { await retryOp(store, id, Date.now(), force); await refreshOps(); void kick(); };
export const discard = async (id: string): Promise<void> => { await discardOp(store, id); await refreshOps(); };

/** For shared computers: removes the cached Firestore data. Refused while changes are still waiting to be synchronized. */
export async function clearLocalData(): Promise<boolean> {
  if (!db || ops.some((o) => o.userUid === uid) || nativePending || nativeInFlight() > 0) return false;
  try { await terminate(db); await clearIndexedDbPersistence(db); return true; } catch { return false; }
}

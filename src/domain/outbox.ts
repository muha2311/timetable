// Durable outbox core (pure: storage, clock, lock and network are injected, so it is fully testable).
export type OpType = "timetable.save" | "timetable.delete" | "exam.save" | "exam.delete" | "invigilation.save";
export type OpStatus = "pending" | "syncing" | "conflict" | "failed";
export interface OutboxOp {
  id: string; type: OpType; targetKey: string; label: string;
  /** Only the intended change (plain data). Never passwords, tokens or secrets. */ payload: unknown;
  userUid: string; createdAt: number; status: OpStatus; attempts: number;
  /** pending: earliest retry time; syncing: lease expiry (a crashed tab's op becomes eligible again). */ nextAttemptAt: number;
  error?: { code: string; detail?: unknown };
}
export interface OutboxStore { list(): Promise<OutboxOp[]>; put(op: OutboxOp): Promise<void>; remove(id: string): Promise<void> }

/** The change was refused on purpose (validation rule violated, or the record changed elsewhere). Never retried automatically. */
export class SyncConflict extends Error {
  code: string; detail: unknown;
  constructor(code: string, detail?: unknown) { super(code); this.code = code; this.detail = detail; }
}
export const MAX_ATTEMPTS = 8;
const LEASE_MS = 120_000;
export const backoffMs = (attempts: number): number => Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));
export function isNetworkError(e: unknown): boolean {
  const c = (e as { code?: unknown } | null)?.code;
  return c === "unavailable" || c === "deadline-exceeded" || c === "cancelled" || /offline|network|failed to fetch/i.test(String((e as Error | null)?.message ?? ""));
}

export async function enqueue(store: OutboxStore, input: { id: string; type: OpType; targetKey: string; label: string; payload: unknown; userUid: string }, now: number): Promise<OutboxOp> {
  const same = (await store.list()).find((o) => o.targetKey === input.targetKey && o.userUid === input.userUid && o.status === "pending");
  if (same) {
    // Repeated offline edits of one record collapse into one operation (same id => idempotent); the ORIGINAL base version is kept for conflict detection.
    const base = (same.payload as { baseUpdatedAt?: unknown } | null)?.baseUpdatedAt;
    const payload = base !== undefined && input.payload && typeof input.payload === "object" ? { ...(input.payload as object), baseUpdatedAt: base } : input.payload;
    const merged: OutboxOp = { ...same, type: input.type, label: input.label, payload, attempts: 0, nextAttemptAt: now };
    await store.put(merged); return merged;
  }
  const op: OutboxOp = { ...input, createdAt: now, status: "pending", attempts: 0, nextAttemptAt: now };
  await store.put(op); return op;
}

export interface ProcessDeps {
  store: OutboxStore; uid: string; now: () => number;
  run: (op: OutboxOp) => Promise<void>;                       // the authoritative save; it re-validates against the latest server data
  withLock: <T>(fn: () => Promise<T>) => Promise<T | undefined>; // cross-tab mutual exclusion (undefined = another tab is syncing)
  onChange?: () => void;
}
export interface ProcessResult { done: number; conflicts: number; failed: number; offline: boolean; skipped: boolean }

export async function processOutbox(d: ProcessDeps): Promise<ProcessResult> {
  const out = await d.withLock(async () => {
    const r: ProcessResult = { done: 0, conflicts: 0, failed: 0, offline: false, skipped: false };
    const ops = (await d.store.list()).sort((a, b) => a.createdAt - b.createdAt);
    for (const op of ops) {
      // Operations of another account are never replayed under this account's permissions.
      if (op.userUid !== d.uid || (op.status !== "pending" && op.status !== "syncing")) continue;
      if (op.nextAttemptAt > d.now()) { if (op.status === "pending" && op.attempts > 0) break; continue; } // an op waiting to retry holds back the later ones, so order is kept
      await d.store.put({ ...op, status: "syncing", nextAttemptAt: d.now() + LEASE_MS }); d.onChange?.();
      try { await d.run(op); await d.store.remove(op.id); r.done++; }
      catch (e) {
        if (e instanceof SyncConflict) { await d.store.put({ ...op, status: "conflict", error: { code: e.code, detail: e.detail } }); r.conflicts++; }
        else if (isNetworkError(e)) {
          const attempts = op.attempts + 1;
          await d.store.put({ ...op, status: attempts >= MAX_ATTEMPTS ? "failed" : "pending", attempts, nextAttemptAt: d.now() + backoffMs(attempts), error: { code: "network" } });
          r.offline = true; d.onChange?.(); break; // still offline: stop, keep order
        } else { await d.store.put({ ...op, status: "failed", error: { code: String((e as { code?: unknown } | null)?.code ?? "error") } }); r.failed++; }
      }
      d.onChange?.();
    }
    return r;
  });
  return out ?? { done: 0, conflicts: 0, failed: 0, offline: false, skipped: true };
}

export const summarizeOps = (ops: readonly OutboxOp[]) => ({
  pending: ops.filter((o) => o.status === "pending").length, syncing: ops.filter((o) => o.status === "syncing").length,
  conflict: ops.filter((o) => o.status === "conflict").length, failed: ops.filter((o) => o.status === "failed").length, total: ops.length,
});
export async function retryOp(store: OutboxStore, id: string, now: number, force = false): Promise<void> {
  const op = (await store.list()).find((o) => o.id === id); if (!op) return;
  const payload = force && op.payload && typeof op.payload === "object" ? { ...(op.payload as object), force: true } : op.payload;
  await store.put({ ...op, payload, status: "pending", attempts: 0, nextAttemptAt: now, error: undefined });
}
export const discardOp = (store: OutboxStore, id: string): Promise<void> => store.remove(id);

export class MemoryStore implements OutboxStore {
  ops = new Map<string, OutboxOp>();
  async list() { return [...this.ops.values()].map((o) => structuredClone(o)); }
  async put(op: OutboxOp) { this.ops.set(op.id, structuredClone(op)); }
  async remove(id: string) { this.ops.delete(id); }
}

/** What the connection indicator shows. "synced" only when online, nothing queued here AND Firestore has no unacknowledged writes. */
export type SyncState = "offline" | "conflict" | "failed" | "syncing" | "pending" | "synced";
export function syncState(online: boolean, c: { pending: number; syncing: number; conflict: number; failed: number }, nativePending: boolean, processing: boolean): SyncState {
  if (c.conflict > 0) return "conflict";
  if (c.failed > 0) return "failed";
  if (!online) return "offline";
  if (processing || c.syncing > 0 || nativePending) return "syncing";
  return c.pending > 0 ? "pending" : "synced";
}

/** Optimistic-concurrency check used by every queued edit/delete when it is finally applied. */
export function baseCheck(current: { updatedAtMs: number | null; lastOpId?: string | null } | null, op: { id: string; baseUpdatedAt?: number | null; force?: boolean; isNew: boolean }): "apply" | "already_applied" | "conflict" {
  if (current?.lastOpId && current.lastOpId === op.id) return "already_applied";   // a previous attempt already succeeded (idempotent replay)
  if (op.isNew) return "apply";
  if (!current) return op.baseUpdatedAt == null ? "apply" : "conflict";            // edited record was deleted elsewhere
  if (op.force || op.baseUpdatedAt === undefined) return "apply";
  return current.updatedAtMs === op.baseUpdatedAt ? "apply" : "conflict";            // changed by someone else since this edit began
}

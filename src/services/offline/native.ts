import { getDoc, type DocumentReference } from "firebase/firestore";
import { isNetworkError } from "../../domain/outbox";

export const isOnline = (): boolean => typeof navigator === "undefined" || navigator.onLine !== false;

// ---- plain Firestore writes (queued by the SDK itself): tracked so the UI never claims "synced" before the server acknowledged them ----
let inFlight = 0;
const failureMsgs: string[] = [];
const listeners = new Set<() => void>();
export const nativeInFlight = (): number => inFlight;
export const nativeFailures = (): string[] => [...failureMsgs];
export const clearNativeFailures = (): void => { failureMsgs.length = 0; listeners.forEach((f) => f()); };
export const onNativeChange = (f: () => void): (() => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

/**
 * Online: resolves when the server confirms (and rejects on error), exactly as before.
 * Offline: the write is already stored locally and will be sent automatically, so we must NOT wait for the server (that promise stays pending
 * until reconnection). A rejection that arrives later (e.g. rules refuse it) is recorded and shown as a synchronization failure.
 */
export function settle<T>(p: Promise<T>): Promise<void> {
  inFlight++; listeners.forEach((f) => f());
  p.then(() => { inFlight--; listeners.forEach((f) => f()); }, (e: unknown) => {
    inFlight--; if (!isNetworkError(e)) failureMsgs.push(String((e as { code?: unknown })?.code ?? "error")); listeners.forEach((f) => f());
  });
  return isOnline() ? p.then(() => undefined) : Promise.resolve();
}

/** Existence check that still works offline (an unknown document is treated as "not found"; the deterministic ID keeps the write idempotent). */
export async function docExists(ref: DocumentReference): Promise<boolean> {
  try { return (await getDoc(ref)).exists(); } catch (e) { if (isNetworkError(e)) return false; throw e; }
}

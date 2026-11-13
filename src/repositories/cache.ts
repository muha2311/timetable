// Tiny in-memory cache with a time limit, request de-duplication and explicit invalidation (no library, no persistence).
const store = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
export const TTL_MS = 5 * 60 * 1000;

export async function cached<T>(key: string, load: () => Promise<T>, opts: { force?: boolean; ttl?: number } = {}): Promise<T> {
  const hit = store.get(key);
  if (!opts.force && hit && Date.now() - hit.at < (opts.ttl ?? TTL_MS)) return hit.value as T;
  const running = inflight.get(key);
  if (!opts.force && running) return running as Promise<T>;
  const p = load().then((v) => { store.set(key, { at: Date.now(), value: v }); return v; }).finally(() => { if (inflight.get(key) === p) inflight.delete(key); });
  inflight.set(key, p);
  return p;
}
/** Fresh cached value, if any (lets a page render instantly with data it already has). */
export function peek<T>(key: string, ttl = TTL_MS): T | undefined {
  const hit = store.get(key);
  return hit && Date.now() - hit.at < ttl ? (hit.value as T) : undefined;
}
export function invalidate(prefix: string): void {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
  for (const k of [...inflight.keys()]) if (k.startsWith(prefix)) inflight.delete(k);
}
export function clearCache(): void { store.clear(); inflight.clear(); }

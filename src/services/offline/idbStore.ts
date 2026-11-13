import type { OutboxOp, OutboxStore } from "../../domain/outbox";

/** Durable outbox in IndexedDB (survives refreshes and browser restarts). Other tabs are told about changes through a BroadcastChannel. */
export async function openIdbStore(onExternalChange: () => void): Promise<OutboxStore | null> {
  if (typeof indexedDB === "undefined") return null;
  let db: IDBDatabase;
  try {
    db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("cs-timetable-outbox", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("ops", { keyPath: "id" }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  } catch { return null; }
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("cs-outbox") : null;
  bc?.addEventListener("message", onExternalChange);
  const run = <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => new Promise<T>((res, rej) => {
    const r = f(db.transaction("ops", mode).objectStore("ops")); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return {
    list: () => run("readonly", (s) => s.getAll() as IDBRequest<OutboxOp[]>),
    put: async (op) => { await run("readwrite", (s) => s.put(op)); bc?.postMessage(1); },
    remove: async (id) => { await run("readwrite", (s) => s.delete(id)); bc?.postMessage(1); },
  };
}

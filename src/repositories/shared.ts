import { Timestamp, type QueryDocumentSnapshot } from "firebase/firestore";
import { db } from "../services/firebase/init";

export const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Version info used for conflict detection: when the record was last written and by which operation. */
export function docState(snap: { exists(): boolean; data(): Record<string, unknown> | undefined }): { updatedAtMs: number | null; lastOpId: string | null } | null {
  if (!snap.exists()) return null;
  const d = snap.data() ?? {};
  return { updatedAtMs: d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : null, lastOpId: typeof d.lastOpId === "string" ? d.lastOpId : null };
}

export function fdb() {
  if (!db) throw new Error("Firebase is not configured.");
  return db;
}
const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

export function withMeta<T>(d: QueryDocumentSnapshot): T {
  const x = d.data();
  return { ...x, id: d.id, createdAt: toDate(x.createdAt), updatedAt: toDate(x.updatedAt) } as unknown as T;
}

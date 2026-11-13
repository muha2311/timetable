import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, Timestamp } from "firebase/firestore";
import { auth } from "../services/firebase/init";
import { cached, invalidate } from "./cache";
import { fdb } from "./shared";

export interface Activity { id: string; type: string; action: string; target: string; actorEmail: string; createdAt: Date | null }

/** Lightweight audit trail: one small append-only document per important change. Never blocks or fails the operation it describes. */
export async function logActivity(type: "import" | "timetable" | "exam" | "user", action: string, target: string): Promise<void> {
  try {
    const u = auth?.currentUser;
    if (!u) return;
    await addDoc(collection(fdb(), "activityLog"), { type, action, target, actorUid: u.uid, actorEmail: u.email ?? "", createdAt: serverTimestamp() });
    invalidate("data:activity");
  } catch { /* best-effort */ }
}
export const listActivity = (force = false): Promise<Activity[]> => cached("data:activity", async () =>
  (await getDocs(query(collection(fdb(), "activityLog"), orderBy("createdAt", "desc"), limit(10)))).docs.map((d) => {
    const x = d.data();
    return { id: d.id, type: String(x.type ?? ""), action: String(x.action ?? ""), target: String(x.target ?? ""), actorEmail: String(x.actorEmail ?? ""), createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : null };
  }), { force });

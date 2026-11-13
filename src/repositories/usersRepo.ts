import { collection, getDocs, orderBy, query, Timestamp, type DocumentData } from "firebase/firestore";
import type { UserProfile } from "../types";
import { cached } from "./cache";
import { fdb } from "./shared";

const date = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);
export function toProfile(id: string, d: DocumentData): UserProfile {
  return { uid: id, fullName: String(d.fullName ?? ""), email: String(d.email ?? ""), role: d.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER", isActive: d.isActive === true,
    createdAt: date(d.createdAt), updatedAt: date(d.updatedAt), lastLoginAt: date(d.lastLoginAt) };
}
/** A handful of accounts, so one cached read (no listener, no pagination needed). Refreshed after every change. */
export const listUsers = (force = false): Promise<UserProfile[]> => cached("data:users", async () =>
  (await getDocs(query(collection(fdb(), "users"), orderBy("createdAt", "asc")))).docs.map((d) => toProfile(d.id, d.data())), { force });

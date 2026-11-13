import { addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, setDoc, onSnapshot, query, serverTimestamp, updateDoc, where, type Unsubscribe } from "firebase/firestore";
import { ConflictError, findConflicts } from "../domain/conflicts";
import { baseCheck, SyncConflict } from "../domain/outbox";
import type { Semester } from "../domain/constants";
import type { TimetableDraft, TimetableEntry } from "../types";
import { logActivity } from "./activityRepo";
import { cached, invalidate } from "./cache";
import { settle } from "../services/offline/native";
import { docState, fdb, withMeta } from "./shared";

const COL = "timetableEntries";

/** One-shot, cached read for the dashboard (the Timetable page keeps its own live listener). */
export const listEntries = (year: string, semester: Semester, force = false): Promise<TimetableEntry[]> => cached(`data:timetable:${year}:${semester}`, async () =>
  (await getDocs(query(collection(fdb(), COL), where("academicYear", "==", year), where("semester", "==", semester)))).docs.map((d) => withMeta<TimetableEntry>(d)), { force });

export function subscribeEntries(year: string, semester: Semester, onData: (e: TimetableEntry[]) => void, onError: (e: Error) => void): Unsubscribe {
  const q = query(collection(fdb(), COL), where("academicYear", "==", year), where("semester", "==", semester));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => withMeta<TimetableEntry>(d))), onError);
}

export interface WriteOpts { newId?: string; baseUpdatedAt?: number | null; opId?: string; force?: boolean }

/**
 * Re-validates against fresh Firestore data (not the UI snapshot) and refuses to save any conflict.
 * With an opId it is also idempotent (a replay of an already-applied operation does nothing) and detects a record edited by someone else
 * since this edit began (SyncConflict "modified_elsewhere") instead of silently overwriting it.
 */
export async function saveEntry(draft: TimetableDraft, id?: string, opts: WriteOpts = {}): Promise<void> {
  const targetId = id ?? opts.newId;
  if (targetId && opts.opId) {
    const verdict = baseCheck(docState(await getDoc(doc(fdb(), COL, targetId))), { id: opts.opId, baseUpdatedAt: opts.baseUpdatedAt, force: opts.force, isNew: !id });
    if (verdict === "already_applied") return;
    if (verdict === "conflict") throw new SyncConflict("modified_elsewhere");
  }
  const snap = await getDocs(query(collection(fdb(), COL),
    where("academicYear", "==", draft.academicYear), where("semester", "==", draft.semester), where("day", "==", draft.day)));
  const found = findConflicts({ ...draft, id: targetId }, snap.docs.map((d) => withMeta<TimetableEntry>(d)));
  if (found.length) throw new ConflictError(found);
  const stamp = opts.opId ? { lastOpId: opts.opId } : {};
  if (id) await settle(updateDoc(doc(fdb(), COL, id), { ...draft, ...stamp, updatedAt: serverTimestamp() }));
  else if (opts.newId) await settle(setDoc(doc(fdb(), COL, opts.newId), { ...draft, ...stamp, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  else await settle(addDoc(collection(fdb(), COL), { ...draft, ...stamp, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  invalidate("data:timetable");
  void logActivity("timetable", id ? "update" : "create", draft.courseName);
}

/** How many timetable sessions reference an instructor or classroom (used to block unsafe deletes). */
export async function countEntriesBy(field: "instructorId" | "classroomId", id: string): Promise<number> {
  return (await getCountFromServer(query(collection(fdb(), COL), where(field, "==", id)))).data().count;
}

export async function removeEntry(id: string, label = id, opts: Pick<WriteOpts, "baseUpdatedAt" | "opId" | "force"> = {}): Promise<void> {
  const ref = doc(fdb(), COL, id);
  if (opts.opId) {
    const cur = docState(await getDoc(ref));
    if (!cur) return; // already deleted (by this operation earlier, or by someone else): nothing left to do
    if (baseCheck(cur, { id: opts.opId, baseUpdatedAt: opts.baseUpdatedAt, force: opts.force, isNew: false }) === "conflict") throw new SyncConflict("modified_elsewhere");
  }
  await settle(deleteDoc(ref));
  invalidate("data:timetable");
  void logActivity("timetable", "delete", label);
}

import { collection, doc, documentId, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where, type QueryDocumentSnapshot } from "firebase/firestore";
import { StaleError } from "../domain/examSchedule";
import { buildBusy, evaluateExam, peopleFrom, saveInvigWithRevalidation, type Assignments, type ExamTimes } from "../domain/invigilation";
import { slug } from "../domain/ids";
import { baseCheck, SyncConflict } from "../domain/outbox";
import { auth } from "../services/firebase/init";
import { docExists, settle } from "../services/offline/native";
import type { AdminStaff, Exam, FacultyMember, InvigDoc } from "../types";
import { logActivity } from "./activityRepo";
import { cached, invalidate } from "./cache";
import { listExamsByDate } from "./examsRepo";
import { chunk, docState, fdb, withMeta } from "./shared";

const toDoc = (d: QueryDocumentSnapshot): InvigDoc => {
  const x = d.data();
  return { id: d.id, assignments: (x.assignments ?? {}) as Assignments, updatedAt: x.updatedAt instanceof Timestamp ? x.updatedAt.toDate() : null, updatedBy: String(x.updatedBy ?? "") };
};
async function fetchInvigs(examIds: string[]): Promise<Map<string, InvigDoc>> {
  const out = new Map<string, InvigDoc>();
  for (const part of chunk(examIds, 30)) (await getDocs(query(collection(fdb(), "invigilations"), where(documentId(), "in", part)))).forEach((d) => out.set(d.id, toDoc(d)));
  return out;
}
/** Assignments of the given exams (document id = exam id). Cached with the dashboard rules: 5 min, cleared on save or Refresh. */
export const listInvigilationsForExams = (examIds: string[], cacheKey: string, force = false): Promise<Map<string, InvigDoc>> =>
  cached(`data:invig:${cacheKey}`, () => fetchInvigs(examIds), { force });

// ---- administrative invigilators ----
export const listAdminStaff = (force = false): Promise<AdminStaff[]> => cached("data:adminstaff", async () =>
  (await getDocs(collection(fdb(), "adminStaff"))).docs.map((d) => withMeta<AdminStaff>(d)).sort((a, b) => a.fullName.localeCompare(b.fullName)), { force });
export async function createAdminStaff(fullName: string, notes: string, isActive: boolean): Promise<string> {
  const id = slug(fullName);
  if (!id || fullName.trim().length < 2) throw new Error("error.invalidName");
  const ref = doc(fdb(), "adminStaff", id);
  if (await docExists(ref)) throw new Error("error.staffExists");
  await settle(setDoc(ref, { fullName: fullName.trim(), isActive, ...(notes.trim() ? { notes: notes.trim() } : {}), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  invalidate("data:adminstaff");
  return id;
}
export async function updateAdminStaff(id: string, v: { fullName: string; notes: string; isActive: boolean }): Promise<void> {
  await settle(updateDoc(doc(fdb(), "adminStaff", id), { fullName: v.fullName.trim(), isActive: v.isActive, notes: v.notes.trim(), updatedAt: serverTimestamp() }));
  invalidate("data:adminstaff");
}

/**
 * AUTHORITATIVE save of an exam's invigilators. Re-reads the exam, every exam of that date (any schedule), their assignments, the people and
 * their active flags, re-evaluates with the same rules as the screen, then commits in a transaction that checks the global invigilation
 * version: two administrators assigning the same person to overlapping exams at once cannot both succeed (the second re-validates and is refused).
 */
export async function saveInvigilation(examId: string, assignments: Assignments, label: string, opts: { opId?: string; baseUpdatedAt?: number | null; force?: boolean } = {}): Promise<void> {
  const db = fdb(), ref = doc(db, "invigilations", examId), metaRef = doc(db, "meta", "invigilation");
  const check = (cur: ReturnType<typeof docState>) => (opts.opId ? baseCheck(cur, { id: opts.opId, baseUpdatedAt: opts.baseUpdatedAt, force: opts.force, isNew: false }) : "apply");
  const v0 = check(docState(await getDoc(ref)));
  if (v0 === "already_applied") return;
  if (v0 === "conflict") throw new SyncConflict("modified_elsewhere");
  const me = auth?.currentUser?.email ?? "", at = new Date().toISOString();
  const stamped: Assignments = Object.fromEntries(Object.entries(assignments).map(([r, sl]) => [r, sl.map((s) => (s ? { ...s, assignedAt: s.assignedAt ?? at, assignedBy: s.assignedBy ?? me } : null))]));
  let exam: Exam | null = null;
  await saveInvigWithRevalidation({
    readVersion: async () => ((await getDoc(metaRef)).data()?.version as number | undefined) ?? 0,
    load: async () => {
      const snap = await getDoc(doc(db, "exams", examId));
      if (!snap.exists()) throw new SyncConflict("exam_missing");
      exam = withMeta<Exam>(snap as QueryDocumentSnapshot);
      const [dateExams, faculty, staff] = await Promise.all([listExamsByDate(exam.date, true), getDocs(collection(db, "facultyMembers")), getDocs(collection(db, "adminStaff"))]);
      const others = dateExams.filter((e) => e.id !== examId), invs = await fetchInvigs(others.map((e) => e.id));
      return { exam, busy: buildBusy(dateExams as ExamTimes[], new Map([...invs].map(([id, d]) => [id, d.assignments]))),
        people: peopleFrom(faculty.docs.map((d) => withMeta<FacultyMember>(d)), staff.docs.map((d) => withMeta<AdminStaff>(d))) };
    },
    evaluate: (d) => evaluateExam(d.exam as ExamTimes, stamped, d.people, d.busy),
    commit: async (version) => {
      await runTransaction(db, async (tx) => {
        const m = await tx.get(metaRef);
        if (((m.data()?.version as number | undefined) ?? 0) !== version) throw new StaleError();
        const cur = await tx.get(ref), v1 = check(docState(cur));
        if (v1 === "already_applied") return;
        if (v1 === "conflict") throw new SyncConflict("modified_elsewhere");
        tx.set(metaRef, { version: version + 1, updatedAt: serverTimestamp() }, { merge: true });
        tx.set(ref, { examId, assignments: stamped, updatedAt: serverTimestamp(), updatedBy: me, ...(opts.opId ? { lastOpId: opts.opId } : {}) });
      });
    },
  });
  invalidate("data:invig");
  void logActivity("exam", "invigilation", label);
}

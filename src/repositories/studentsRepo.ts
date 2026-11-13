import { collection, doc, documentId, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import type { EnrollmentStatus, Level } from "../domain/constants";
import { studentId } from "../domain/ids";
import type { Student } from "../types";
import type { MigrationPlan } from "../domain/cohort";
import { isNetworkError } from "../domain/outbox";
import { isOnline, settle } from "../services/offline/native";
import { cached, invalidate } from "./cache";
import { chunk, fdb, withMeta } from "./shared";

export type NewStudent = Omit<Student, "id" | "createdAt" | "updatedAt">;

/** All student records of an academic year (one query), cached until an edit/import/refresh. Levels are filtered in memory. */
export const listStudentsByYear = (year: string, force = false): Promise<Student[]> => cached(`data:students:year:${year}`, async () => {
  const s = await getDocs(query(collection(fdb(), "students"), where("academicYear", "==", year)));
  return s.docs.map((d) => withMeta<Student>(d)).sort((a, b) => a.academicId.localeCompare(b.academicId, undefined, { numeric: true }));
}, { force });

/** Manual edit. Changing the level marks it "manual" so later imports/migrations never overwrite it; academicYear is never touched. */
export async function updateStudent(current: Student, v: { level: Level | null; sectionId: string | null }): Promise<void> {
  if (v.sectionId) {
    try {
      const sec = await getDoc(doc(fdb(), "sections", v.sectionId));
      if (!sec.exists() || (sec.data().level as Level) !== v.level) throw new Error("error.sectionMismatch");
    } catch (e) { if (!isNetworkError(e)) throw e; } // offline: the form only offers sections of the chosen level
  }
  const levelChanged = v.level !== current.level;
  await settle(updateDoc(doc(fdb(), "students", current.id), { level: v.level, sectionId: v.sectionId, ...(levelChanged ? { levelSource: v.level ? "manual" : null } : {}), updatedAt: serverTimestamp() }));
  invalidate("data:");
}

/** Applies planLevelMigration(): sets cohort levels where reliable; otherwise level=null (old value kept in legacyLevel). Batches of 400. */
export async function applyLevelMigration(plan: MigrationPlan): Promise<void> {
  if (!isOnline()) throw new Error("error.needsConnection");
  const ops = [...plan.fix.map((f) => ({ id: f.id, data: { level: f.level, levelSource: "cohort", legacyLevel: f.legacyLevel } })),
    ...plan.review.map((r) => ({ id: r.id, data: { level: null, levelSource: null, legacyLevel: r.legacyLevel } }))];
  for (const part of chunk(ops, 400)) {
    const batch = writeBatch(fdb());
    part.forEach((o) => batch.update(doc(fdb(), "students", o.id), { ...o.data, updatedAt: serverTimestamp() }));
    await batch.commit();
  }
  invalidate("data:");
}

/** Bulk lookup: one query per 30 IDs instead of one read per student. */
export async function getStudentsByIds(ids: string[]): Promise<Map<string, Student>> {
  const out = new Map<string, Student>();
  for (const part of chunk([...new Set(ids)], 30)) {
    (await getDocs(query(collection(fdb(), "students"), where(documentId(), "in", part)))).forEach((d) => out.set(d.id, withMeta<Student>(d)));
  }
  return out;
}

export async function listStudents(): Promise<Student[]> {
  const s = await getDocs(collection(fdb(), "students"));
  return s.docs.map((d) => withMeta<Student>(d)).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** The ID is derived from the registration number, so the same student can never be added twice. */
export async function createStudent(input: NewStudent): Promise<string> {
  const id = studentId(input.academicId);
  if (!id || !input.fullName.trim()) throw new Error("error.invalidStudent");
  const ref = doc(fdb(), "students", id);
  if ((await getDoc(ref)).exists()) throw new Error("error.studentExists");
  if (input.sectionId && input.level) {
    const sec = await getDoc(doc(fdb(), "sections", input.sectionId));
    if (!sec.exists() || (sec.data().level as Level) !== input.level) throw new Error("error.sectionMismatch");
  }
  await setDoc(ref, { ...input, fullName: input.fullName.trim(), academicId: input.academicId.trim(), status: input.status as EnrollmentStatus, levelSource: input.levelSource ?? null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return id;
}

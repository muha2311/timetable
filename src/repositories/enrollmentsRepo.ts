import { collection, doc, documentId, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import type { Level, Semester } from "../domain/constants";
import { studentWrites, type PlanItem } from "../domain/studentImport";
import type { Course } from "../types";
import { logActivity } from "./activityRepo";
import { isOnline } from "../services/offline/native";
import { cached, invalidate } from "./cache";
import { getStudentsByIds } from "./studentsRepo";
import { chunk, fdb } from "./shared";
import type { Student } from "../types";


/** One query per 30 IDs (Firestore "in" limit) instead of one read per row. */
export async function findExistingStudentIds(ids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const part of chunk(ids, 30)) {
    (await getDocs(query(collection(fdb(), "students"), where(documentId(), "in", part)))).forEach((d) => found.add(d.id));
  }
  return found;
}
export async function findExistingEnrollmentIds(year: string, courseId: string): Promise<Set<string>> {
  const s = await getDocs(query(collection(fdb(), "courseEnrollments"), where("academicYear", "==", year), where("courseId", "==", courseId)));
  return new Set(s.docs.map((d) => d.id));
}

export interface ImportMeta { fileName: string; course: Course; academicYear: string; totalRows: number; invalidRows: number }
export interface ImportResult { newStudents: number; existingStudents: number; newEnrollments: number; skippedEnrollments: number; failedRows: number[]; historySaved: boolean }

/** Create-only writes in batches of 200 rows (max 400 writes, under the 500 limit). A failed batch is reported, the rest continue. */
export async function runImport(items: PlanItem[], meta: ImportMeta, onProgress: (done: number, total: number) => void): Promise<ImportResult> {
  if (!isOnline()) throw new Error("error.needsConnection"); // the "does this student already exist?" check must see the server
  const db = fdb();
  // Re-check right before writing: a student created (or manually edited) since the preview is reused, never overwritten.
  const fresh = await findExistingStudentIds(items.filter((i) => !i.studentExists).map((i) => i.row.studentId));
  items = items.map((i) => (fresh.has(i.row.studentId) ? { ...i, studentExists: true } : i));
  const historyRef = doc(collection(db, "importHistory"));
  const r: ImportResult = { newStudents: 0, existingStudents: 0, newEnrollments: 0, skippedEnrollments: 0, failedRows: [], historySaved: false };
  let done = 0;
  onProgress(0, items.length);
  for (const part of chunk(items, 200)) {
    const batch = writeBatch(db);
    let writes = 0, ns = 0, ne = 0;
    for (const w of studentWrites(part, meta.academicYear)) {
      batch.set(doc(db, "students", w.id), { ...w.data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      writes++; ns++;
    }
    for (const it of part) {
      if (!it.enrolled) {
        // The enrollment records the COURSE's level; the student's own level is never derived from it.
        batch.set(doc(db, "courseEnrollments", it.enrollmentId), { studentId: it.row.studentId, courseId: meta.course.id, level: meta.course.level, semester: meta.course.semester, academicYear: meta.academicYear, importId: historyRef.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        writes++; ne++;
      }
    }
    try {
      if (writes) await batch.commit();
      r.newStudents += ns; r.newEnrollments += ne;
      r.existingStudents += part.filter((i) => i.studentExists).length;
      r.skippedEnrollments += part.filter((i) => i.enrolled).length;
    } catch { r.failedRows.push(...part.filter((i) => !i.studentExists || !i.enrolled).map((i) => i.row.row)); }
    done += part.length;
    onProgress(done, items.length);
  }
  try {
    await setDoc(historyRef, { fileName: meta.fileName, courseId: meta.course.id, courseName: meta.course.name, level: meta.course.level, semester: meta.course.semester, academicYear: meta.academicYear,
      totalRows: meta.totalRows, validRows: items.length, invalidRows: meta.invalidRows, newStudents: r.newStudents, existingStudents: r.existingStudents,
      newEnrollments: r.newEnrollments, skippedEnrollments: r.skippedEnrollments, failedRows: r.failedRows.length, status: r.failedRows.length ? "partial" : "completed", createdAt: serverTimestamp() });
    r.historySaved = true;
  } catch { /* history is best-effort; the result is still shown to the user */ }
  invalidate("data:"); // students/enrollments changed: drop cached lists
  void logActivity("import", "import", meta.course.name);
  return r;
}

export interface EnrollmentRow { studentId: string; courseId: string; level: Level; semester: Semester; academicYear: string; status?: string }

/**
 * Enrollment records of exactly the given courses (the courses selected in the checker). The read is scoped by course ID only:
 * no level, neither the student's nor one stored on the enrollment, is used to include or exclude anyone.
 */
export async function listEnrollmentsForCourses(year: string, courseIds: readonly string[], force = false, onProgress?: (total: number) => void): Promise<EnrollmentRow[]> {
  let total = 0;
  const lists = await Promise.all(courseIds.map(async (id) => { const r = await listCourseEnrollments(year, id, force); total += r.length; onProgress?.(total); return r; }));
  return lists.flat();
}

export interface RosterRow { studentId: string; student: Student | null; enrollment: EnrollmentRow }
/** Students enrolled in one course: one enrollment query + bulk student lookup, cached until refresh/import. */
/** Raw enrollment records of one course for a year (cached; pass force for the latest data). */
export const listCourseEnrollments = (year: string, courseId: string, force = false): Promise<EnrollmentRow[]> => cached(`data:enrollments:${year}:${courseId}`, async () =>
  (await getDocs(query(collection(fdb(), "courseEnrollments"), where("academicYear", "==", year), where("courseId", "==", courseId)))).docs.map((d) => d.data() as EnrollmentRow), { force });

export const listCourseRoster = (year: string, courseId: string, force = false): Promise<RosterRow[]> => cached(`data:roster:${year}:${courseId}`, async () => {
  const enrollments = await listCourseEnrollments(year, courseId, force);
  const students = await getStudentsByIds(enrollments.map((e) => e.studentId));
  return enrollments.map((e) => ({ studentId: e.studentId, student: students.get(e.studentId) ?? null, enrollment: e }))
    .sort((a, b) => (a.student?.academicId ?? a.studentId).localeCompare(b.student?.academicId ?? b.studentId, undefined, { numeric: true }));
}, { force });

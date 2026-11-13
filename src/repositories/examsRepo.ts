import { collection, doc, documentId, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { examId } from "../domain/ids";
import type { CourseRef } from "../domain/examConflicts";
import { ExamValidationError, saveWithRevalidation, StaleError, validateExam, type ExamInput, type RoomLite } from "../domain/examSchedule";
import type { Classroom, Exam } from "../types";
import { logActivity } from "./activityRepo";
import { baseCheck, SyncConflict } from "../domain/outbox";
import { cached, invalidate } from "./cache";
import { listCourseEnrollments, type EnrollmentRow } from "./enrollmentsRepo";
import { chunk, docState, fdb, withMeta } from "./shared";

export const roomLite = (c: Classroom): RoomLite => ({ id: c.id, name: c.building ? `${c.name} (${c.building})` : c.name, capacity: typeof c.capacity === "number" ? c.capacity : null });

export const listExams = (scheduleId: string, force = false): Promise<Exam[]> => cached(`data:exams:s:${scheduleId}`, async () =>
  (await getDocs(query(collection(fdb(), "exams"), where("scheduleId", "==", scheduleId)))).docs.map((d) => withMeta<Exam>(d)), { force });
/** Exams of ANY schedule on a date (rooms are physical, so bookings are checked across schedules). */
export const listExamsByDate = (date: string, force = false): Promise<Exam[]> => cached(`data:exams:d:${date}`, async () =>
  (await getDocs(query(collection(fdb(), "exams"), where("date", "==", date)))).docs.map((d) => withMeta<Exam>(d)), { force });

/** All exams of a year + semester (any type), for the dashboard. */
export const listExamsBySemester = (year: string, semester: string, force = false): Promise<Exam[]> => cached(`data:exams:ys:${year}:${semester}`, async () =>
  (await getDocs(query(collection(fdb(), "exams"), where("academicYear", "==", year), where("semester", "==", semester)))).docs.map((d) => withMeta<Exam>(d)), { force });

async function roomsFresh(ids: string[]): Promise<Map<string, RoomLite>> {
  const out = new Map<string, RoomLite>();
  for (const part of chunk(ids, 30)) (await getDocs(query(collection(fdb(), "classrooms"), where(documentId(), "in", part)))).forEach((d) => out.set(d.id, roomLite(withMeta<Classroom>(d))));
  return out;
}

/**
 * Final save. Re-reads the latest exams, room capacities and enrollments, runs the same validateExam() as the form, then commits inside a
 * transaction that also checks the schedule's version counter. Another administrator saving at the same moment forces a re-validation.
 */
export async function saveExam(exam: ExamInput & { examType: string }, notes: string, courses: ReadonlyMap<string, CourseRef>, editing: boolean, opts: { opId?: string; baseUpdatedAt?: number | null; force?: boolean } = {}): Promise<void> {
  const db = fdb();
  const schedRef = doc(db, "examSchedules", exam.scheduleId);
  const examRef = doc(db, "exams", examId(exam.scheduleId, exam.courseId));
  if (opts.opId) { // replay of an already-applied operation does nothing; an exam changed by someone else is reported, not overwritten
    const v0 = baseCheck(docState(await getDoc(examRef)), { id: opts.opId, baseUpdatedAt: opts.baseUpdatedAt, force: opts.force, isNew: !editing });
    if (v0 === "already_applied") return;
    if (v0 === "conflict") throw new SyncConflict("modified_elsewhere");
  }
  const full: ExamInput = { ...exam, id: editing ? examRef.id : undefined }; // new exams have no id, so an existing exam of the same course counts as a duplicate
  interface D { scheduleExams: Exam[]; dateExams: Exam[]; enrollments: EnrollmentRow[]; rooms: Map<string, RoomLite> }
  await saveWithRevalidation<D>({
    readVersion: async () => ((await getDoc(schedRef)).data()?.version as number | undefined) ?? 0,
    load: async () => {
      const [scheduleExams, dateExams, rooms] = await Promise.all([listExams(exam.scheduleId, true), listExamsByDate(exam.date, true), roomsFresh(exam.roomIds)]);
      const courseIds = new Set([exam.courseId, ...scheduleExams.filter((e) => e.date === exam.date && e.id !== examRef.id).map((e) => e.courseId)]);
      const enrollments = (await Promise.all([...courseIds].map((c) => listCourseEnrollments(exam.academicYear, c, true)))).flat();
      return { scheduleExams, dateExams, enrollments, rooms };
    },
    validate: (d) => validateExam({ exam: full, courses, roomsById: d.rooms, scheduleExams: d.scheduleExams, dateExams: d.dateExams, enrollments: d.enrollments }),
    commit: async (version, v) => {
      await runTransaction(db, async (tx) => {
        const s = await tx.get(schedRef);
        if (((s.data()?.version as number | undefined) ?? 0) !== version) throw new StaleError();
        const cur = await tx.get(examRef);
        if (opts.opId) {
          const v1 = baseCheck(docState(cur), { id: opts.opId, baseUpdatedAt: opts.baseUpdatedAt, force: opts.force, isNew: !editing });
          if (v1 === "already_applied") return;
          if (v1 === "conflict") throw new SyncConflict("modified_elsewhere");
        }
        if (cur.exists() && !editing) throw new ExamValidationError([{ code: "duplicate_course" }]);
        tx.set(schedRef, { academicYear: exam.academicYear, semester: exam.semester, examType: exam.examType, version: version + 1, updatedAt: serverTimestamp(), ...(s.exists() ? {} : { createdAt: serverTimestamp() }) }, { merge: true });
        const data = { scheduleId: exam.scheduleId, academicYear: exam.academicYear, semester: exam.semester, examType: exam.examType, courseId: exam.courseId, date: exam.date,
          startMinutes: exam.startMinutes, endMinutes: exam.endMinutes, roomIds: exam.roomIds, roomCapacities: v.roomCapacities, allocation: exam.allocation ?? {}, studentCount: v.students.length, notes, updatedAt: serverTimestamp(), ...(opts.opId ? { lastOpId: opts.opId } : {}) };
        if (cur.exists()) tx.update(examRef, data); else tx.set(examRef, { ...data, createdAt: serverTimestamp() });
      });
    },
  });
  invalidate("data:exams");
  void logActivity("exam", editing ? "update" : "create", exam.courseId);
}

export async function deleteExam(exam: Exam, opts: { opId?: string; baseUpdatedAt?: number | null; force?: boolean } = {}): Promise<void> {
  const db = fdb();
  const schedRef = doc(db, "examSchedules", exam.scheduleId), examRef = doc(db, "exams", exam.id);
  await runTransaction(db, async (tx) => {
    const cur = await tx.get(examRef);
    if (!cur.exists()) return; // already deleted
    if (opts.opId && baseCheck(docState(cur), { id: opts.opId, baseUpdatedAt: opts.baseUpdatedAt, force: opts.force, isNew: false }) === "conflict") throw new SyncConflict("modified_elsewhere");
    const s = await tx.get(schedRef);
    tx.set(schedRef, { version: (((s.data()?.version as number | undefined) ?? 0) + 1), updatedAt: serverTimestamp() }, { merge: true }); // makes in-flight saves re-validate
    tx.delete(examRef);
    tx.delete(doc(db, "invigilations", exam.id)); // its invigilator assignments go with it
  });
  invalidate("data:exams"); invalidate("data:invig");
  void logActivity("exam", "delete", exam.courseId);
}

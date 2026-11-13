import { analyze, EXCLUDED, type CourseRef, type EnrollmentLike, type PairConflict } from "./examConflicts.ts";

export interface RoomLite { id: string; name: string; capacity: number | null }
export interface ExamInput {
  id?: string; scheduleId: string; academicYear: string; semester: string; examType?: string; courseId: string;
  date: string; startMinutes: number; endMinutes: number; roomIds: string[]; allocation?: Record<string, string[]>;
}
export interface ExamLite { id: string; courseId: string; date: string; startMinutes: number; endMinutes: number; roomIds: string[] }
export type IssueCode = "date_invalid" | "time_invalid" | "duplicate_course" | "no_rooms" | "room_unknown_capacity" | "capacity_insufficient"
  | "room_booked" | "student_conflict" | "unverified" | "allocation_invalid" | "busy";
export interface Issue { code: IssueCode; ids?: string[]; n?: number }
export interface CapacitySummary { studentCount: number; roomCount: number; total: number; remaining: number; shortfall: number; unknownRoomIds: string[]; sufficient: boolean }
export interface ExamValidation {
  ok: boolean; issues: Issue[]; students: string[]; capacity: CapacitySummary; conflicts: PairConflict[];
  roomBookings: ExamLite[]; verified: boolean; status: "safe" | "conflict" | "unverified"; roomCapacities: Record<string, number>;
}
export interface AllocationIssue { code: "room_not_selected" | "over_capacity" | "duplicate" | "missing" | "unknown_student"; ids: string[] }

const validCap = (r: RoomLite): boolean => r.capacity != null && Number.isInteger(r.capacity) && r.capacity > 0;
export const timesOverlap = (a: { startMinutes: number; endMinutes: number }, b: { startMinutes: number; endMinutes: number }): boolean => a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;

/** Unique university IDs enrolled in a course for a year + semester. Same filters as the Exam Conflict Checker (analyze). */
export function enrolledStudents(enrollments: readonly EnrollmentLike[], courseId: string, year: string, semester: string): string[] {
  const out = new Set<string>();
  for (const e of enrollments) {
    if (e.courseId !== courseId || e.academicYear !== year || e.semester !== semester) continue;
    if (e.status && EXCLUDED.has(e.status.toLowerCase())) continue;
    const sid = (e.studentId ?? "").trim();
    if (sid) out.add(sid);
  }
  return [...out].sort();
}

/**
 * Multi-room rule: the COMBINED capacity of all selected rooms must cover all students (no single room has to fit everyone).
 * Rooms without a valid capacity are never counted and block confirmation (unknown is not unlimited).
 */
export function capacitySummary(studentCount: number, rooms: readonly RoomLite[]): CapacitySummary {
  const unknownRoomIds = rooms.filter((r) => !validCap(r)).map((r) => r.id);
  const total = rooms.filter(validCap).reduce((a, r) => a + (r.capacity as number), 0);
  return { studentCount, roomCount: rooms.length, total, remaining: Math.max(0, total - studentCount), shortfall: Math.max(0, studentCount - total), unknownRoomIds,
    sufficient: rooms.length > 0 && unknownRoomIds.length === 0 && total >= studentCount };
}

/** Proportional split (largest remainder) in student-ID order. Each room gets <= its capacity; every student exactly once. null if impossible. */
export function distribute(studentIds: readonly string[], rooms: readonly RoomLite[]): Record<string, string[]> | null {
  const ids = [...new Set(studentIds)].sort();
  if (!rooms.length || !rooms.every(validCap)) return null;
  const total = rooms.reduce((a, r) => a + (r.capacity as number), 0);
  if (ids.length > total) return null;
  const quota = rooms.map((r) => Math.floor((ids.length * (r.capacity as number)) / total));
  let left = ids.length - quota.reduce((a, b) => a + b, 0);
  rooms.map((r, i) => ({ i, rem: (ids.length * (r.capacity as number)) % total })).sort((a, b) => b.rem - a.rem || a.i - b.i)
    .forEach((o) => { if (left > 0) { quota[o.i] = (quota[o.i] ?? 0) + 1; left--; } });
  const out: Record<string, string[]> = {};
  let at = 0;
  rooms.forEach((r, i) => { const n = quota[i] ?? 0; out[r.id] = ids.slice(at, at + n); at += n; });
  return out;
}

export function validateAllocation(studentIds: readonly string[], rooms: readonly RoomLite[], allocation: Record<string, string[]>): AllocationIssue[] {
  const enrolled = new Set(studentIds), roomMap = new Map(rooms.map((r) => [r.id, r]));
  const seen = new Set<string>(), dup = new Set<string>(), unknown = new Set<string>(), notSelected: string[] = [], over: string[] = [];
  for (const [roomId, list] of Object.entries(allocation)) {
    const room = roomMap.get(roomId);
    if (!room) { notSelected.push(roomId); continue; }
    if (!validCap(room) || list.length > (room.capacity as number)) over.push(roomId);
    for (const sid of list) { if (!enrolled.has(sid)) unknown.add(sid); else if (seen.has(sid)) dup.add(sid); else seen.add(sid); }
  }
  const missing = studentIds.filter((s) => !seen.has(s));
  const out: AllocationIssue[] = [];
  if (notSelected.length) out.push({ code: "room_not_selected", ids: notSelected });
  if (over.length) out.push({ code: "over_capacity", ids: over });
  if (dup.size) out.push({ code: "duplicate", ids: [...dup] });
  if (unknown.size) out.push({ code: "unknown_student", ids: [...unknown] });
  if (missing.length) out.push({ code: "missing", ids: missing });
  return out;
}

export interface ValidateArgs {
  exam: ExamInput; courses: ReadonlyMap<string, CourseRef>; roomsById: ReadonlyMap<string, RoomLite>;
  scheduleExams: readonly ExamLite[];   // exams of the SAME schedule (year + semester + type): used for the one-exam-per-day student rule
  dateExams: readonly ExamLite[];       // exams of ANY schedule on the exam date: used for room bookings
  enrollments: readonly EnrollmentLike[]; // enrollments of the candidate course and of the courses already on that date
}

/** The single validation used by the form (live) and by the repository (final, against freshly read data). */
export function validateExam(a: ValidateArgs): ExamValidation {
  const { exam, courses, roomsById, scheduleExams, dateExams, enrollments } = a;
  const issues: Issue[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exam.date) || Number.isNaN(Date.parse(exam.date))) issues.push({ code: "date_invalid" });
  if (!(exam.endMinutes > exam.startMinutes)) issues.push({ code: "time_invalid" });
  if (scheduleExams.some((e) => e.id !== exam.id && e.courseId === exam.courseId)) issues.push({ code: "duplicate_course" });

  const students = enrolledStudents(enrollments, exam.courseId, exam.academicYear, exam.semester);
  const rooms = exam.roomIds.map((id) => roomsById.get(id) ?? { id, name: id, capacity: null });
  const capacity = capacitySummary(students.length, rooms);
  if (!rooms.length) issues.push({ code: "no_rooms" });
  else if (capacity.unknownRoomIds.length) issues.push({ code: "room_unknown_capacity", ids: capacity.unknownRoomIds });
  else if (!capacity.sufficient) issues.push({ code: "capacity_insufficient", n: capacity.shortfall });

  const roomBookings = dateExams.filter((e) => e.id !== exam.id && e.date === exam.date && timesOverlap(e, exam) && e.roomIds.some((r) => exam.roomIds.includes(r)));
  if (roomBookings.length) issues.push({ code: "room_booked", ids: roomBookings.map((e) => e.id) });

  // One exam per student per calendar day: any shared student with another exam of this schedule on the same date blocks, whatever the times.
  const sameDay = scheduleExams.filter((e) => e.id !== exam.id && e.courseId !== exam.courseId && e.date === exam.date);
  const cand = courses.get(exam.courseId);
  const others = sameDay.map((e) => courses.get(e.courseId));
  let conflicts: PairConflict[] = [];
  let verified = !!cand && others.every((o) => !!o);
  if (cand && verified) {
    const an = analyze(enrollments, [cand], others as CourseRef[], exam.academicYear, exam.semester);
    conflicts = an.pairs;
    if (an.quality.emptyCourses.length > 0 || an.quality.invalid > 0 || students.length === 0) verified = false;
  }
  if (conflicts.length) issues.push({ code: "student_conflict", ids: conflicts.map((c) => c.courseB) });
  if (!verified) issues.push({ code: "unverified" });

  if (exam.allocation && Object.keys(exam.allocation).length) {
    const bad = validateAllocation(students, rooms, exam.allocation);
    if (bad.length) issues.push({ code: "allocation_invalid", ids: bad.map((b) => b.code) });
  }
  const roomCapacities: Record<string, number> = {};
  rooms.filter(validCap).forEach((r) => { roomCapacities[r.id] = r.capacity as number; });
  return { ok: issues.length === 0, issues, students, capacity, conflicts, roomBookings, verified, roomCapacities,
    status: conflicts.length ? "conflict" : verified ? "safe" : "unverified" };
}

export class ExamValidationError extends Error {
  issues: Issue[];
  constructor(issues: Issue[]) { super("Exam validation failed"); this.issues = issues; }
}
export class StaleError extends Error {}

/**
 * Optimistic concurrency for the final save: read the schedule version, load the LATEST data, validate, then commit only if the version
 * is unchanged (the commit runs in a Firestore transaction). If another administrator saved in between, it re-loads and re-validates.
 */
export async function saveWithRevalidation<D>(deps: {
  readVersion: () => Promise<number>; load: () => Promise<D>; validate: (d: D) => ExamValidation; commit: (version: number, v: ExamValidation) => Promise<void>;
}, attempts = 4): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const version = await deps.readVersion();
    const v = deps.validate(await deps.load());
    if (!v.ok) throw new ExamValidationError(v.issues);
    try { await deps.commit(version, v); return; } catch (e) { if (e instanceof StaleError) continue; throw e; }
  }
  throw new ExamValidationError([{ code: "busy" }]);
}

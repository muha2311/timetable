import { ConflictError } from "../../domain/conflicts";
import type { CourseRef } from "../../domain/examConflicts";
import { ExamValidationError, type ExamInput } from "../../domain/examSchedule";
import { InvigError, type Assignments } from "../../domain/invigilation";
import { isNetworkError, SyncConflict, type OpType, type OutboxOp } from "../../domain/outbox";
import type { Exam, TimetableDraft } from "../../types";
import { deleteExam, saveExam } from "../../repositories/examsRepo";
import { saveInvigilation } from "../../repositories/invigilationRepo";
import { listCourses } from "../../repositories/refData";
import { removeEntry, saveEntry } from "../../repositories/timetableRepo";
import { auth } from "../firebase/init";
import { isOnline } from "./native";
import { kick, queueOp, setRunner } from "./sync";

/**
 * "Critical" operations (timetable, exams, invigilators) need fresh validation against the latest server data, which cannot happen offline.
 * Online they run immediately. Offline (or if the network drops) they are stored in the durable outbox and replayed through the SAME
 * authoritative functions when the connection returns; a rule violation or a record changed elsewhere becomes a visible conflict, never an overwrite.
 * Every operation carries one id, used for both the immediate attempt and any replay, so repeating it can never apply it twice.
 */
export type Submitted = "done" | "queued";
const uuid = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const timeout = (ms: number) => new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "deadline-exceeded" })), ms));

async function submit(op: { id: string; type: OpType; targetKey: string; label: string; payload: unknown }, run: () => Promise<void>): Promise<Submitted> {
  if (isOnline()) {
    try { await Promise.race([run(), timeout(20000)]); return "done"; }
    catch (e) { if (!isNetworkError(e)) throw e; }   // anything else (validation, permission) is a real answer for the user
  }
  await queueOp(op); void kick();
  return "queued";
}

interface TimetablePayload { opId: string; draft: TimetableDraft; id: string | null; newId: string | null; baseUpdatedAt: number | null; force?: boolean }
interface TimetableDelete { opId: string; id: string; label: string; baseUpdatedAt: number | null; force?: boolean }
interface ExamPayload { opId: string; exam: ExamInput & { examType: string }; notes: string; editing: boolean; baseUpdatedAt: number | null; force?: boolean }
interface ExamDelete { opId: string; exam: Exam; baseUpdatedAt: number | null; force?: boolean }
interface InvigPayload { opId: string; examId: string; label: string; assignments: Assignments; baseUpdatedAt: number | null; force?: boolean }

const courseMap = async (): Promise<Map<string, CourseRef>> => new Map((await listCourses()).map((c) => [c.id, { id: c.id, name: c.name, level: c.level }]));
const applyTimetable = (p: TimetablePayload) => saveEntry(p.draft, p.id ?? undefined, { newId: p.newId ?? undefined, baseUpdatedAt: p.baseUpdatedAt, opId: p.opId, force: p.force });
const applyTimetableDelete = (p: TimetableDelete) => removeEntry(p.id, p.label, { baseUpdatedAt: p.baseUpdatedAt, opId: p.opId, force: p.force });
const applyExam = async (p: ExamPayload) => saveExam(p.exam, p.notes, await courseMap(), p.editing, { opId: p.opId, baseUpdatedAt: p.baseUpdatedAt, force: p.force });
const applyExamDelete = (p: ExamDelete) => deleteExam(p.exam, { opId: p.opId, baseUpdatedAt: p.baseUpdatedAt, force: p.force });
const applyInvig = (p: InvigPayload) => saveInvigilation(p.examId, p.assignments, p.label, { opId: p.opId, baseUpdatedAt: p.baseUpdatedAt, force: p.force });

export const saveTimetableEntry = (draft: TimetableDraft, o: { id?: string; baseUpdatedAt?: number | null }): Promise<Submitted> => {
  const opId = uuid(), newId = o.id ? null : `t${uuid().replace(/-/g, "").slice(0, 20)}`; // client-made ID for new sessions, so a replay overwrites instead of duplicating
  const p: TimetablePayload = { opId, draft, id: o.id ?? null, newId, baseUpdatedAt: o.baseUpdatedAt ?? null };
  return submit({ id: opId, type: "timetable.save", targetKey: `timetable:${o.id ?? newId}`, label: draft.courseName, payload: p }, () => applyTimetable(p));
};
export const deleteTimetableEntry = (id: string, label: string, baseUpdatedAt: number | null): Promise<Submitted> => {
  const p: TimetableDelete = { opId: uuid(), id, label, baseUpdatedAt };
  return submit({ id: p.opId, type: "timetable.delete", targetKey: `timetable:${id}`, label, payload: p }, () => applyTimetableDelete(p));
};
export const saveExamCritical = (exam: ExamInput & { examType: string }, notes: string, courses: ReadonlyMap<string, CourseRef>, editing: boolean, baseUpdatedAt: number | null): Promise<Submitted> => {
  const p: ExamPayload = { opId: uuid(), exam, notes, editing, baseUpdatedAt };
  return submit({ id: p.opId, type: "exam.save", targetKey: `exam:${exam.scheduleId}:${exam.courseId}`, label: courses.get(exam.courseId)?.name ?? exam.courseId, payload: p },
    () => saveExam(exam, notes, courses, editing, { opId: p.opId, baseUpdatedAt }));
};
export const deleteExamCritical = (exam: Exam): Promise<Submitted> => {
  const p: ExamDelete = { opId: uuid(), exam, baseUpdatedAt: exam.updatedAt?.getTime() ?? null };
  return submit({ id: p.opId, type: "exam.delete", targetKey: `exam:${exam.scheduleId}:${exam.courseId}`, label: exam.courseId, payload: p }, () => applyExamDelete(p));
};
export const saveInvigilationCritical = (examId: string, assignments: Assignments, label: string, baseUpdatedAt: number | null): Promise<Submitted> => {
  const p: InvigPayload = { opId: uuid(), examId, label, assignments, baseUpdatedAt };
  return submit({ id: p.opId, type: "invigilation.save", targetKey: `invigilation:${examId}`, label, payload: p }, () => applyInvig(p));
};

/** Replays a queued operation. Refusals become SyncConflict (shown to the user); network errors are retried; everything else is a visible failure. */
async function runQueued(op: OutboxOp): Promise<void> {
  try {
    if (op.type === "timetable.save") await applyTimetable(op.payload as TimetablePayload);
    else if (op.type === "timetable.delete") await applyTimetableDelete(op.payload as TimetableDelete);
    else if (op.type === "exam.save") await applyExam(op.payload as ExamPayload);
    else if (op.type === "exam.delete") await applyExamDelete(op.payload as ExamDelete);
    else await applyInvig(op.payload as InvigPayload);
  } catch (e) {
    if (e instanceof SyncConflict) throw e;
    if (e instanceof ConflictError) throw new SyncConflict("scheduling_conflict", e.conflicts.map((c) => c.kind));
    if (e instanceof ExamValidationError) throw new SyncConflict("exam_validation", e.issues.map((i) => i.code));
    if (e instanceof InvigError) throw new SyncConflict("invigilation_invalid", e.issues);
    throw e;
  }
}
setRunner(runQueued);
export const currentUid = (): string | null => auth?.currentUser?.uid ?? null;

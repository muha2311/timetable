import { StaleError } from "./examSchedule.ts";

// FIXED POLICY: every occupied exam room has exactly two invigilators, whatever the number of students.
export const INVIGILATORS_PER_ROOM = 2;
export type Category = "TA" | "ADMIN";
export interface Person { key: string; id: string; name: string; category: Category; active: boolean }
export interface Slot { personId: string; category: Category; assignedAt?: string; assignedBy?: string }
export type Assignments = Record<string, (Slot | null)[]>;
export interface ExamTimes { id: string; courseId: string; date: string; startMinutes: number; endMinutes: number; roomIds: string[]; allocation?: Record<string, string[]> }
export type SlotIssue = "unknown_person" | "inactive" | "category_mismatch" | "duplicate" | "busy_elsewhere" | "room_not_occupied" | "too_many" | "admin_while_ta_available";
export type RoomStatus = "complete" | "incomplete" | "invalid";
export interface RoomEval { roomId: string; occupied: boolean; status: RoomStatus; valid: number; slots: { slot: Slot | null; issues: SlotIssue[]; busyWith: string[] }[] }
export interface ExamEval { rooms: RoomEval[]; occupied: number; required: number; assignedTA: number; assignedAdmin: number; validTotal: number; shortage: number;
  completeRooms: number; incompleteRooms: number; invalidRooms: number; hasInvalid: boolean; staffed: boolean }
export type BusyMap = Map<string, { examId: string; date: string; startMinutes: number; endMinutes: number }[]>;

export const requiredInvigilators = (occupiedRooms: number): number => occupiedRooms * INVIGILATORS_PER_ROOM;
export const personKey = (s: { category: Category; personId: string }): string => `${s.category}:${s.personId}`;
/** Occupied = rooms that actually hold students (from the saved distribution); without a distribution, every selected room hosts the exam. */
export function occupiedRooms(e: { roomIds: string[]; allocation?: Record<string, string[]> }): string[] {
  const a = e.allocation ?? {};
  return Object.values(a).some((l) => l.length > 0) ? e.roomIds.filter((r) => (a[r]?.length ?? 0) > 0) : [...e.roomIds];
}
const overlaps = (a: { startMinutes: number; endMinutes: number }, b: { startMinutes: number; endMinutes: number }) => a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;

/** Who is busy when, from ALL exams (any room, course, level) and their saved assignments. A person counts once per exam. */
export function buildBusy(exams: readonly ExamTimes[], assignmentsByExam: ReadonlyMap<string, Assignments>): BusyMap {
  const m: BusyMap = new Map();
  for (const e of exams) {
    const keys = new Set<string>();
    for (const slots of Object.values(assignmentsByExam.get(e.id) ?? {})) for (const s of slots) if (s) keys.add(personKey(s));
    keys.forEach((k) => m.set(k, [...(m.get(k) ?? []), { examId: e.id, date: e.date, startMinutes: e.startMinutes, endMinutes: e.endMinutes }]));
  }
  return m;
}
/** Real time intervals (not just dates): 09:00-11:00 vs 10:00-12:00 overlaps; 09:00-11:00 vs 11:00-13:00 does not. */
export const busyWith = (key: string, exam: ExamTimes, busy: BusyMap): string[] =>
  (busy.get(key) ?? []).filter((b) => b.examId !== exam.id && b.date === exam.date && overlaps(b, exam)).map((b) => b.examId);

export function evaluateExam(exam: ExamTimes, assignments: Assignments, people: ReadonlyMap<string, Person>, busy: BusyMap): ExamEval {
  const occupied = occupiedRooms(exam);
  const used = new Set<string>();
  Object.values(assignments).forEach((sl) => sl.forEach((s) => { if (s) used.add(personKey(s)); }));
  // Priority rule: administrative staff are only acceptable while no available teaching assistant is left unassigned for this exam.
  const taLeft = [...people.values()].filter((p) => p.category === "TA" && p.active && !used.has(p.key) && busyWith(p.key, exam, busy).length === 0).length;
  const seen = new Set<string>();
  const roomIds = [...occupied, ...Object.keys(assignments).filter((r) => !occupied.includes(r))];
  const rooms: RoomEval[] = roomIds.map((roomId) => {
    const isOcc = occupied.includes(roomId);
    const slots = (assignments[roomId] ?? []).map((slot, i) => {
      const issues: SlotIssue[] = []; let busyIds: string[] = [];
      if (slot) {
        const key = personKey(slot), p = people.get(key);
        if (!isOcc) issues.push("room_not_occupied");
        if (i >= INVIGILATORS_PER_ROOM) issues.push("too_many");
        if (!p) issues.push("unknown_person"); else { if (p.category !== slot.category) issues.push("category_mismatch"); if (!p.active) issues.push("inactive"); }
        if (seen.has(key)) issues.push("duplicate"); else seen.add(key);
        busyIds = busyWith(key, exam, busy); if (busyIds.length) issues.push("busy_elsewhere");
        if (slot.category === "ADMIN" && taLeft > 0) issues.push("admin_while_ta_available");
      }
      return { slot, issues, busyWith: busyIds };
    });
    const valid = slots.filter((s) => s.slot && s.issues.length === 0).length, bad = slots.some((s) => s.issues.length > 0);
    return { roomId, occupied: isOcc, valid, slots, status: bad ? "invalid" : valid === INVIGILATORS_PER_ROOM ? "complete" : "incomplete" };
  });
  const occ = rooms.filter((r) => r.occupied), good = occ.flatMap((r) => r.slots.filter((s) => s.slot && s.issues.length === 0));
  const required = requiredInvigilators(occupied.length), validTotal = good.length;
  const hasInvalid = rooms.some((r) => r.status === "invalid");
  return { rooms, occupied: occupied.length, required, assignedTA: good.filter((s) => s.slot?.category === "TA").length, assignedAdmin: good.filter((s) => s.slot?.category === "ADMIN").length,
    validTotal, shortage: Math.max(0, required - validTotal), completeRooms: occ.filter((r) => r.status === "complete").length, incompleteRooms: occ.filter((r) => r.status === "incomplete").length,
    invalidRooms: rooms.filter((r) => r.status === "invalid").length, hasInvalid, staffed: required > 0 && validTotal === required && !hasInvalid };
}

export function availability(exam: ExamTimes, people: ReadonlyMap<string, Person>, assignments: Assignments, busy: BusyMap) {
  const used = new Set<string>();
  Object.values(assignments).forEach((sl) => sl.forEach((s) => { if (s) used.add(personKey(s)); }));
  const by = (a: Person, b: Person) => a.name.localeCompare(b.name);
  const available: Person[] = [], unavailable: { person: Person; reason: "inactive" | "busy"; busyWith: string[] }[] = [];
  for (const p of people.values()) {
    const b = busyWith(p.key, exam, busy);
    if (!p.active) unavailable.push({ person: p, reason: "inactive", busyWith: [] });
    else if (b.length) unavailable.push({ person: p, reason: "busy", busyWith: b });
    else if (!used.has(p.key)) available.push(p);
  }
  return { available: available.sort((a, b) => (a.category === b.category ? by(a, b) : a.category === "TA" ? -1 : 1)), unavailable: unavailable.sort((a, b) => by(a.person, b.person)) };
}

export const workloadOf = (assignmentsByExam: ReadonlyMap<string, Assignments>): Map<string, number> => {
  const m = new Map<string, number>();
  assignmentsByExam.forEach((a) => Object.values(a).forEach((sl) => sl.forEach((s) => { if (s) m.set(personKey(s), (m.get(personKey(s)) ?? 0) + 1); })));
  return m;
};

/**
 * Keeps every currently valid assignment, clears invalid ones, then fills the empty positions:
 * teaching assistants first (lowest workload first), administrative staff only when no TA is left. First positions of all rooms are filled before any second position.
 */
export function autoAssign(exam: ExamTimes, assignments: Assignments, people: ReadonlyMap<string, Person>, busy: BusyMap, workload: ReadonlyMap<string, number>, by?: { at: string; user: string }) {
  const ev = evaluateExam(exam, assignments, people, busy), occ = occupiedRooms(exam), next: Assignments = {};
  const used = new Set<string>();
  for (const r of ev.rooms.filter((x) => x.occupied)) {
    const slots: (Slot | null)[] = [null, null];
    r.slots.slice(0, INVIGILATORS_PER_ROOM).forEach((s, i) => { if (s.slot && s.issues.length === 0) { slots[i] = s.slot; used.add(personKey(s.slot)); } });
    next[r.roomId] = slots;
  }
  occ.forEach((r) => { if (!next[r]) next[r] = [null, null]; });
  const pool = (cat: Category) => [...people.values()].filter((p) => p.category === cat && p.active && !used.has(p.key) && busyWith(p.key, exam, busy).length === 0)
    .sort((a, b) => (workload.get(a.key) ?? 0) - (workload.get(b.key) ?? 0) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  const tas = pool("TA"), admins = pool("ADMIN");
  for (let pos = 0; pos < INVIGILATORS_PER_ROOM; pos++) for (const room of occ) {
    const slots = next[room] as (Slot | null)[];
    if (slots[pos]) continue;
    const p = tas.shift() ?? admins.shift();
    if (p) slots[pos] = { personId: p.id, category: p.category, ...(by ? { assignedAt: by.at, assignedBy: by.user } : {}) };
  }
  const after = evaluateExam(exam, next, people, busy);
  return { assignments: next, shortage: after.shortage, filled: after.validTotal - ev.validTotal };
}

export class InvigError extends Error {
  issues: { roomId: string; slot: number; issues: SlotIssue[]; busyWith: string[] }[];
  constructor(issues: InvigError["issues"]) { super("Invigilation validation failed"); this.issues = issues; }
}
export const slotProblems = (ev: ExamEval): InvigError["issues"] =>
  ev.rooms.flatMap((r) => r.slots.map((s, slot) => ({ roomId: r.roomId, slot, issues: s.issues, busyWith: s.busyWith })).filter((x) => x.issues.length > 0));

/** Authoritative save: incomplete staffing is allowed, invalid assignments are not. Re-validates against the latest data and commits only if the global version is unchanged. */
export async function saveInvigWithRevalidation<D>(deps: { readVersion: () => Promise<number>; load: () => Promise<D>; evaluate: (d: D) => ExamEval; commit: (version: number, ev: ExamEval) => Promise<void> }, attempts = 4): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const version = await deps.readVersion(), ev = deps.evaluate(await deps.load());
    const bad = slotProblems(ev); if (bad.length) throw new InvigError(bad);
    try { await deps.commit(version, ev); return; } catch (e) { if (e instanceof StaleError) continue; throw e; }
  }
  throw new InvigError([]);
}

/** Teaching assistants come from the existing faculty records (role "Teaching Assistant"); administrative staff from their own collection. */
export function peopleFrom(faculty: readonly { id: string; fullName: string; role: string; isActive?: boolean }[], staff: readonly { id: string; fullName: string; isActive: boolean }[]): Map<string, Person> {
  const m = new Map<string, Person>();
  faculty.filter((f) => f.role === "Teaching Assistant").forEach((f) => m.set(`TA:${f.id}`, { key: `TA:${f.id}`, id: f.id, name: f.fullName, category: "TA", active: f.isActive !== false }));
  staff.forEach((s) => m.set(`ADMIN:${s.id}`, { key: `ADMIN:${s.id}`, id: s.id, name: s.fullName, category: "ADMIN", active: s.isActive }));
  return m;
}

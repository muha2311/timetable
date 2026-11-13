import type { TimetableDraft, TimetableEntry } from "../types";

export type ConflictKind = "instructor" | "classroom" | "section";
export interface Conflict { kind: ConflictKind; other: TimetableEntry }

/** Thrown by the repository when a save would break a hard scheduling constraint. */
export class ConflictError extends Error {
  conflicts: Conflict[];
  constructor(conflicts: Conflict[]) { super("Scheduling conflict"); this.conflicts = conflicts; }
}

/**
 * Pure conflict check. All three kinds are HARD constraints (never bypassable). `existing` should contain entries of all levels; entries from another
 * year/semester/day or without a time overlap are ignored. An entry with no sections is treated
 * as the whole level, so it overlaps any section of that level.
 */
export function findConflicts(c: TimetableDraft & { id?: string }, existing: TimetableEntry[]): Conflict[] {
  const out: Conflict[] = [];
  for (const o of existing) {
    if (o.id === c.id || o.academicYear !== c.academicYear || o.semester !== c.semester || o.day !== c.day) continue;
    if (!(c.startMinutes < o.endMinutes && o.startMinutes < c.endMinutes)) continue;
    if (c.instructorId && c.instructorId === o.instructorId) out.push({ kind: "instructor", other: o });
    if (c.classroomId && c.classroomId === o.classroomId) out.push({ kind: "classroom", other: o });
    const sharesSection = o.level === c.level &&
      (c.sectionIds.length === 0 || o.sectionIds.length === 0 || c.sectionIds.some((s) => o.sectionIds.includes(s)));
    if (sharesSection) out.push({ kind: "section", other: o });
  }
  return out;
}

import { DAYS, DEFAULT_TIME_SLOTS } from "./constants.ts";

export const sessionsByDay = (entries: readonly { day: string }[]): { day: string; n: number }[] => DAYS.map((d) => ({ day: d, n: entries.filter((e) => e.day === d).length }));

export function topInstructors(entries: readonly { instructorId: string | null }[], limit = 5): { id: string; n: number }[] {
  const m = new Map<string, number>();
  entries.forEach((e) => { if (e.instructorId) m.set(e.instructorId, (m.get(e.instructorId) ?? 0) + 1); });
  return [...m.entries()].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)).slice(0, limit);
}

/** Utilization = scheduled minutes of a room / minutes available in a teaching week (5 days x all periods). */
export const WEEK_MINUTES = DAYS.length * DEFAULT_TIME_SLOTS.reduce((a, s) => a + (s.end - s.start), 0);
export function roomUtilization(entries: readonly { classroomId: string | null; startMinutes: number; endMinutes: number }[], limit = 8): { id: string; minutes: number; percent: number }[] {
  const m = new Map<string, number>();
  entries.forEach((e) => { if (e.classroomId) m.set(e.classroomId, (m.get(e.classroomId) ?? 0) + (e.endMinutes - e.startMinutes)); });
  return [...m.entries()].map(([id, minutes]) => ({ id, minutes, percent: Math.round((minutes / WEEK_MINUTES) * 1000) / 10 })).sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id)).slice(0, limit);
}

const JS_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** The weekly timetable repeats, so "upcoming" = the next sessions from now (rest of today, then the following days). */
export function nextSessions<T extends { day: string; startMinutes: number }>(entries: readonly T[], now: Date, limit = 6): (T & { offset: number })[] {
  const nowMin = now.getHours() * 60 + now.getMinutes(), out: (T & { offset: number })[] = [];
  for (let k = 0; k <= 7 && out.length < limit; k++) {
    const day = JS_DAYS[(now.getDay() + k) % 7];
    out.push(...entries.filter((e) => e.day === day && (k > 0 || e.startMinutes >= nowMin)).sort((a, b) => a.startMinutes - b.startMinutes).map((e) => ({ ...e, offset: k })));
  }
  return out.slice(0, limit);
}

export interface ExamLike { id: string; examType: string; courseId: string; date: string; startMinutes: number; endMinutes: number; roomIds: string[]; studentCount: number }
export function examOverview(exams: readonly ExamLike[], courseLevel: (courseId: string) => number | undefined, capacityOf: (roomId: string) => number | null | undefined, today: string, type: "" | "midterm" | "final") {
  const scoped = type ? exams.filter((e) => e.examType === type) : [...exams];
  const byLevel: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  scoped.forEach((e) => { const l = courseLevel(e.courseId); if (l && byLevel[l] !== undefined) byLevel[l]++; });
  const capacityIssues = scoped.filter((e) => {
    const caps = e.roomIds.map(capacityOf);
    return caps.some((c) => typeof c !== "number" || c <= 0) || caps.reduce<number>((a, c) => a + (typeof c === "number" ? c : 0), 0) < e.studentCount;
  }).map((e) => e.id);
  const clashes: [string, string][] = [];
  scoped.forEach((a, i) => scoped.slice(i + 1).forEach((b) => { if (a.date === b.date && a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes && a.roomIds.some((r) => b.roomIds.includes(r))) clashes.push([a.id, b.id]); }));
  return {
    midterm: exams.filter((e) => e.examType === "midterm").length, final: exams.filter((e) => e.examType === "final").length,
    upcoming: scoped.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes),
    byLevel, scheduledCourses: new Set(scoped.map((e) => e.courseId)).size, capacityOk: scoped.length - capacityIssues.length, capacityIssues, roomClashes: clashes,
  };
}

export function enrollmentOverview<C extends { id: string }>(courses: readonly C[], counts: Readonly<Record<string, number>>) {
  const withEnrollments = courses.filter((c) => (counts[c.id] ?? 0) > 0), without = courses.filter((c) => (counts[c.id] ?? 0) === 0);
  return { withEnrollments, without, total: courses.reduce((a, c) => a + (counts[c.id] ?? 0), 0) };
}

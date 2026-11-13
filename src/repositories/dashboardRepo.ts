import { collection, getCountFromServer, query, where, type Query } from "firebase/firestore";
import type { Course, Exam, Section, TimetableEntry } from "../types";
import { cached } from "./cache";
import { listExamsBySemester } from "./examsRepo";
import { fdb } from "./shared";
import { listEntries } from "./timetableRepo";

export interface DashboardData {
  levelCounts: Record<number, number>; unassigned: number; sectionCounts: Record<string, number>; enrollCounts: Record<string, number>;
  entries: TimetableEntry[]; exams: Exam[];
}
const count = async (q: Query): Promise<number> => (await getCountFromServer(q)).data().count;

/**
 * Counts use Firestore aggregation (getCountFromServer): the server counts and returns one number, so no student or enrollment
 * document is downloaded. Each count is a unique student record (students) or a unique (student, course) pair (enrollments).
 * The whole result is cached for 5 minutes and dropped whenever data changes (imports, edits) or on Refresh.
 */
export const loadDashboard = (year: string, semester: "Fall" | "Spring" | "Summer", courses: readonly Course[], sections: readonly Section[], force = false): Promise<DashboardData> =>
  cached(`data:dashboard:${year}:${semester}`, async () => {
    const db = fdb(), students = collection(db, "students"), y = where("academicYear", "==", year);
    const semCourses = courses.filter((c) => c.semester === semester);
    const [levels, unassigned, secs, enr, entries, exams] = await Promise.all([
      Promise.all([1, 2, 3, 4].map((l) => count(query(students, y, where("level", "==", l))))),
      count(query(students, y, where("level", "==", null))),
      Promise.all(sections.map((s) => count(query(students, y, where("sectionId", "==", s.id))))),
      Promise.all(semCourses.map((c) => count(query(collection(db, "courseEnrollments"), y, where("courseId", "==", c.id))))),
      listEntries(year, semester, force), listExamsBySemester(year, semester, force),
    ]);
    return {
      levelCounts: Object.fromEntries(levels.map((n, i) => [i + 1, n])), unassigned,
      sectionCounts: Object.fromEntries(sections.map((s, i) => [s.id, secs[i] ?? 0])), enrollCounts: Object.fromEntries(semCourses.map((c, i) => [c.id, enr[i] ?? 0])), entries, exams,
    };
  }, { force });

import type { Level } from "./constants";

// Deterministic document IDs. scripts/seed/ids.mjs mirrors these (a test checks they match).
// Unicode-aware, so Arabic names/rooms still produce non-empty IDs.
export const slug = (s: string): string => s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
export const levelId = (level: Level): string => `L${level}`;
export const sectionId = (level: Level, name: string): string => `L${level}_${slug(name)}`;
export const facultyId = (fullName: string): string => slug(fullName);
export const courseId = (level: Level, semester: string, name: string): string => `L${level}_${slug(semester)}_${slug(name)}`;
export const studentId = (academicId: string): string => slug(academicId);
export const enrollmentId = (year: string, courseId: string, student: string): string => `${slug(year)}_${courseId}_${student}`;
export const examScheduleId = (year: string, semester: string, type: string): string => `${slug(year)}_${slug(semester)}_${type}`;
export const examId = (scheduleId: string, courseId: string): string => `${scheduleId}__${courseId}`;
export const classroomId = (name: string, building = ""): string => slug(`${building} ${name}`);

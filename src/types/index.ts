import type { AppRole, Day, EnrollmentStatus, ExamType, Level, Role, Semester, SessionType } from "../domain/constants";

interface Timestamps { createdAt: Date | null; updatedAt: Date | null }

export interface FacultyMember extends Timestamps {
  id: string; fullName: string; role: Role; department?: string; notes?: string;
  /** Teaching assistants only: false = not available for invigilation. Missing = active. */ isActive?: boolean;
}
export interface Classroom extends Timestamps {
  id: string; name: string; building?: string; capacity?: number; notes?: string;
}
export interface AcademicLevel extends Timestamps { id: string; level: Level; name: string }
export interface Course extends Timestamps { id: string; level: Level; semester: Semester; name: string }
/** Prepared, empty collection. academicId is the university registration number (the document ID is derived from it). */
export interface Student extends Timestamps {
  id: string; fullName: string; academicId: string; academicYear: string; status: EnrollmentStatus; sectionId: string | null;
  /** The student's ACTUAL level (never the level of a course they take). null = unknown, needs manual assignment. */
  level: Level | null;
  /** "cohort" = computed from the admission year, "manual" = set by an admin (never overwritten), null = unknown, undefined = legacy record. */
  levelSource?: "cohort" | "manual" | null;
  legacyLevel?: number | null;
}
/** One document per (student, course, semester, academic year). ID = enrollmentId(year, courseId, studentId). */
export interface CourseEnrollment extends Timestamps {
  id: string; studentId: string; courseId: string; level: Level; semester: Semester; academicYear: string; importId: string;
}
/** One document per (schedule, course): the ID makes it impossible to schedule a course twice in a schedule. */
export interface Exam extends Timestamps {
  id: string; scheduleId: string; academicYear: string; semester: Semester; examType: ExamType; courseId: string;
  date: string; startMinutes: number; endMinutes: number; roomIds: string[];
  roomCapacities: Record<string, number>; allocation: Record<string, string[]>; studentCount: number; notes: string;
}
export interface Institution {
  universityNameEn: string; universityNameAr: string; facultyNameEn: string; facultyNameAr: string;
  headerEn: string; headerAr: string; footerEn: string; footerAr: string; universityLogo: string; facultyLogo: string;
}
/** users/{authUid}. Written only by the server (Pages Function) except the one-time bootstrap profile and lastLoginAt. */
export interface UserProfile { uid: string; fullName: string; email: string; role: AppRole; isActive: boolean; createdAt: Date | null; updatedAt: Date | null; lastLoginAt: Date | null }
/** Administrative invigilators (a separate collection: faculty roles are never changed). */
export interface AdminStaff extends Timestamps { id: string; fullName: string; isActive: boolean; notes?: string }
export interface InvigDoc { id: string; assignments: import("../domain/invigilation").Assignments; updatedAt: Date | null; updatedBy: string }
export interface Section extends Timestamps { id: string; level: Level; name: string }
export interface TeachingAssignment extends Timestamps {
  id: string; facultyId: string; classroomId: string; level: Level;
  sectionId: string | null; courseName: string;
  day: Day | null; startMinutes: number | null; endMinutes: number | null; notes?: string;
}

export interface TimetableEntry extends Timestamps {
  id: string; academicYear: string; semester: Semester; level: Level; day: Day;
  startMinutes: number; endMinutes: number; courseName: string;
  instructorId: string | null; classroomId: string | null;
  sessionType: SessionType; sectionIds: string[]; notes: string;
}
export type TimetableDraft = Omit<TimetableEntry, "id" | "createdAt" | "updatedAt">;

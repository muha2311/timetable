export const LEVELS = [1, 2, 3, 4] as const;
export type Level = (typeof LEVELS)[number];

export const ROLES = ["Professor", "Lecturer", "Assistant Lecturer", "Teaching Assistant"] as const;
export type Role = (typeof ROLES)[number];

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"] as const;
export type Day = (typeof DAYS)[number];


// Placeholder statuses (no student rules were specified yet); extend when the real rules are known.
export const ENROLLMENT_STATUSES = ["active", "inactive"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const EXAM_TYPES = ["midterm", "final"] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

export const APP_ROLES = ["SUPER_ADMIN", "USER"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const SEMESTERS = ["Fall", "Spring", "Summer"] as const;
export type Semester = (typeof SEMESTERS)[number];
export const ACADEMIC_YEARS = ["2025-2026", "2026-2027", "2027-2028"] as const;

export const SESSION_TYPES = ["lecture", "section", "section_practical"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];
export const SESSION_META: Record<SessionType, { label: string; badge: string; color: string; accent: string }> = {
  lecture: { label: "Lecture", badge: "LEC", color: "bg-[#fdf0c8]", accent: "border-s-amber-500" },
  section: { label: "Section (no practical)", badge: "SEC", color: "bg-[#f7d56e]", accent: "border-s-yellow-700" },
  section_practical: { label: "Section with practical / lab", badge: "LAB", color: "bg-[#cfd8e3]", accent: "border-s-slate-600" },
};

// Default slots (minutes since midnight). Entries store their own start/end, so slots can change later.
export interface TimeSlot { id: string; label: string; start: number; end: number }
export const DEFAULT_TIME_SLOTS: readonly TimeSlot[] = [
  { id: "p1", label: "Period 1", start: 600, end: 675 },
  { id: "p2", label: "Period 2", start: 680, end: 750 },
  { id: "p3", label: "Period 3", start: 755, end: 825 },
  { id: "p4", label: "Period 4", start: 830, end: 900 },
];

export interface EnrollmentLike {
  studentId?: string | null;
  courseId?: string | null;
  academicYear?: string | null;
  semester?: string | null;
  status?: string | null;
}
export interface CourseRef {
  id: string;
  name: string;
  level: number;
}
export interface PairConflict {
  courseA: string;
  courseB: string;
  students: string[];
}
export interface ExamAnalysis {
  pairs: PairConflict[];
  affected: number;
  totalPairs: number;
  safePairs: number;
  quality: { invalid: number; duplicates: number; emptyCourses: string[] };
}
// Enrollments currently have no status field; if one is added, these values are excluded automatically.
export const EXCLUDED = new Set(["inactive", "withdrawn", "dropped"]);

/**
 * Finds course pairs (one course from level A, one from level B) that share at least one student.
 * 1) one pass over enrollments builds course -> Set(studentId) (duplicates collapse),
 * 2) one pass over courses builds student -> courses (A side / B side),
 * 3) each student emits only the pairs they actually take, so cost is O(enrollments + sum of per-student pairs),
 *    never courses x courses x students. Students are matched by ID only, never by name.
 */
export function analyze(
  enrollments: readonly EnrollmentLike[],
  coursesA: readonly CourseRef[],
  coursesB: readonly CourseRef[],
  year: string,
  semester: string,
): ExamAnalysis {
  const inA = new Set(coursesA.map((c) => c.id)),
    inB = new Set(coursesB.map((c) => c.id));
  const byCourse = new Map<string, Set<string>>();
  let invalid = 0,
    duplicates = 0;
  for (const e of enrollments) {
    if (e.academicYear !== year || e.semester !== semester) continue; // never compare other years/semesters
    if (e.status && EXCLUDED.has(e.status.toLowerCase())) continue; // inactive / withdrawn
    const sid = (e.studentId ?? "").trim(),
      cid = e.courseId ?? "";
    if (!sid || !cid) {
      invalid++;
      continue;
    } // incomplete records never match anything
    if (!inA.has(cid) && !inB.has(cid)) continue;
    const set = byCourse.get(cid) ?? new Set<string>();
    if (set.has(sid)) duplicates++;
    else set.add(sid);
    byCourse.set(cid, set);
  }
  const perStudent = new Map<string, { a: string[]; b: string[] }>();
  byCourse.forEach((students, cid) =>
    students.forEach((sid) => {
      const r = perStudent.get(sid) ?? { a: [], b: [] };
      (inA.has(cid) ? r.a : r.b).push(cid);
      perStudent.set(sid, r);
    }),
  );
  const pairMap = new Map<string, PairConflict>();
  perStudent.forEach((r, sid) =>
    r.a.forEach((a) =>
      r.b.forEach((b) => {
        const k = `${a}\u0000${b}`;
        const p = pairMap.get(k) ?? { courseA: a, courseB: b, students: [] };
        p.students.push(sid);
        pairMap.set(k, p);
      }),
    ),
  );
  const pairs = [...pairMap.values()]
    .map((p) => ({ ...p, students: p.students.sort() }))
    .sort(
      (x, y) =>
        y.students.length - x.students.length ||
        x.courseA.localeCompare(y.courseA) ||
        x.courseB.localeCompare(y.courseB),
    );
  const emptyCourses = [...coursesA, ...coursesB]
    .filter((c) => !byCourse.has(c.id))
    .map((c) => c.id);
  return summarize(pairs, coursesA.length * coursesB.length, {
    invalid,
    duplicates,
    emptyCourses,
  });
}

function summarize(
  pairs: PairConflict[],
  totalPairs: number,
  quality: ExamAnalysis["quality"],
): ExamAnalysis {
  const affected = new Set<string>();
  pairs.forEach((p) => p.students.forEach((s) => affected.add(s)));
  return {
    pairs,
    affected: affected.size,
    totalPairs,
    safePairs: totalPairs - pairs.length,
    quality,
  };
}

/** Removes students (e.g. inactive ones) from an analysis; pairs left with nobody become "no conflict". */
// export function applyExclusions(a: ExamAnalysis, excluded: ReadonlySet<string>): ExamAnalysis {
//   if (!excluded.size) return a;
//   const pairs = a.pairs.map((p) => ({ ...p, students: p.students.filter((s) => !excluded.has(s)) })).filter((p) => p.students.length > 0);
//   return summarize(pairs, a.totalPairs, a.quality);
// }
/**
 * Removes students (e.g. inactive ones) from an analysis.
 * Preserves additional properties such as coursesByLevel.
 */
export function applyExclusions<T extends ExamAnalysis>(
  a: T,
  excluded: ReadonlySet<string>,
): T {
  if (!excluded.size) return a;

  const pairs = a.pairs
    .map((p) => ({
      ...p,
      students: p.students.filter((s) => !excluded.has(s)),
    }))
    .filter((p) => p.students.length > 0);

  return {
    ...a,
    ...summarize(pairs, a.totalPairs, a.quality),
  };
}

export interface SelectableCourse extends CourseRef {
  semester: string;
}
export interface LevelScan extends ExamAnalysis {
  coursesByLevel: Record<number, CourseRef[]>;
}

/**
 * Scope rule: the selected levels decide WHICH COURSES are compared (the courses of those levels in this semester).
 * They never decide which STUDENTS take part: every student enrolled in any selected course is compared, whatever their own academic level.
 * Only enrollment records (studentId + courseId) are read; no student level and no level stored on an enrollment is consulted.
 * Every pair of selected levels is compared with the existing analyze() (e.g. levels 1, 2, 3 -> 1x2, 1x3, 2x3).
 */
export function analyzeSelectedLevels(
  enrollments: readonly EnrollmentLike[],
  courses: readonly SelectableCourse[],
  levels: readonly number[],
  year: string,
  semester: string,
): LevelScan {
  const sorted = [...new Set(levels)].sort((a, b) => a - b);
  const groups = sorted.map((l) =>
    courses
      .filter((c) => c.level === l && c.semester === semester)
      .map(({ id, name, level }) => ({ id, name, level })),
  );
  const pairs: PairConflict[] = [];
  let totalPairs = 0;
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) {
      const gi = groups[i] ?? [],
        gj = groups[j] ?? [];
      pairs.push(...analyze(enrollments, gi, gj, year, semester).pairs);
      totalPairs += gi.length * gj.length;
    }
  // Data quality is measured once over all selected courses (not once per pair of levels).
  const quality = analyze(
    enrollments,
    groups.flat(),
    [],
    year,
    semester,
  ).quality;
  pairs.sort(
    (x, y) =>
      y.students.length - x.students.length ||
      x.courseA.localeCompare(y.courseA) ||
      x.courseB.localeCompare(y.courseB),
  );
  const affected = new Set<string>();
  pairs.forEach((p) => p.students.forEach((s) => affected.add(s)));
  return {
    pairs,
    affected: affected.size,
    totalPairs,
    safePairs: totalPairs - pairs.length,
    quality,
    coursesByLevel: Object.fromEntries(
      sorted.map((l, i) => [l, groups[i] ?? []]),
    ),
  };
}

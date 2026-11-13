import { cohortLevel } from "./cohort.ts";
import type { Level } from "./constants";
import { enrollmentId, studentId } from "./ids.ts";

export type Cell = string | number | boolean | null | undefined;
export type Grid = Cell[][];
export type RowStatus = "valid" | "missing_id" | "missing_name" | "duplicate_in_file";
export interface ParsedRow { row: number; id: string; name: string; studentId: string; status: RowStatus }
export interface Detection { headerRow: number; idCol: number; nameCol: number; confident: boolean }
export interface PlanItem { row: ParsedRow; studentExists: boolean; enrollmentId: string; enrolled: boolean; level: Level | null; levelSource: "cohort" | "manual" | null }
export interface Plan {
  items: PlanItem[];
  counts: { total: number; valid: number; invalid: number; newStudents: number; existingStudents: number; newEnrollments: number; skippedEnrollments: number };
}

// Folds Arabic variants/diacritics and drops punctuation/spaces so "الرقم الجامعي" and "Student ID" both compare cleanly.
const fold = (v: Cell): string => String(v ?? "").toLowerCase().replace(/[\u064B-\u065F\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^\p{L}\p{N}]+/gu, "");
const ID_WORDS = ["id", "code", "studentid", "universityid", "academicid", "studentcode", "studentno", "studentnumber", "registrationnumber", "regno", "seatno", "رقم جامعي", "الرقم الجامعي", "كود الطالب", "كود", "الكود", "رقم القيد", "رقم الطالب", "الرقم الاكاديمي", "رقم الجلوس"].map(fold);
const NAME_WORDS = ["name", "student", "studentname", "fullname", "الاسم", "اسم", "اسم الطالب", "الاسم الكامل", "الطالب"].map(fold);
// Short words must match the whole header; longer ones may appear inside it ("Student ID (Univ.)").
const matches = (cell: Cell, list: string[]): boolean => {
  const f = fold(cell);
  return f !== "" && list.some((w) => f === w || (w.length >= 5 && w !== fold("student") && f.includes(w)));
};
const blank = (r: Cell[]): boolean => !r.some((c) => String(c ?? "").trim() !== "");
// An ID looks like a code with at least 4 digits (so labels such as "Col1" are not mistaken for IDs).
const idLike = (v: string): boolean => /^[\p{L}\p{N}][\p{L}\p{N}\-_/.]{3,}$/u.test(v) && (v.match(/\d/g)?.length ?? 0) >= 4;
const nameLike = (v: string): boolean => /^[\p{L}\s.'’-]{3,}$/u.test(v);

/** Looks at the content of columns (used when headers are missing or unfamiliar). */
function guessColumns(rows: Grid, skip: number[]): { id: number; name: number } {
  const sample = rows.filter((r) => !blank(r)).slice(0, 200);
  const width = Math.max(0, ...sample.map((r) => r.length));
  let id = -1, name = -1, nameLen = 0;
  for (let c = 0; c < width; c++) {
    if (skip.includes(c)) continue;
    const vals = sample.map((r) => String(r[c] ?? "").trim()).filter(Boolean);
    if (!vals.length) continue;
    const idShare = vals.filter(idLike).length / vals.length;
    const nameShare = vals.filter(nameLike).length / vals.length;
    const len = vals.reduce((a, v) => a + v.length, 0) / vals.length;
    if (id < 0 && idShare >= 0.8 && new Set(vals).size / vals.length > 0.9) id = c;
    else if (nameShare >= 0.8 && len > nameLen) { name = c; nameLen = len; }
  }
  return { id, name };
}

export function detectColumns(grid: Grid): Detection {
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const row = grid[r] ?? [];
    let idCol = row.findIndex((c) => matches(c, ID_WORDS));
    let nameCol = row.findIndex((c, i) => i !== idCol && !matches(c, ID_WORDS) && matches(c, NAME_WORDS));
    if (idCol < 0 && nameCol < 0) continue;
    const confident = idCol >= 0 && nameCol >= 0;
    if (!confident) {
      const g = guessColumns(grid.slice(r + 1), [idCol, nameCol].filter((x) => x >= 0));
      if (idCol < 0) idCol = g.id;
      if (nameCol < 0) nameCol = g.name;
    }
    return { headerRow: r, idCol, nameCol, confident };
  }
  // No recognizable header: if the first row already looks like data, there is no header row.
  const headerRow = (grid[0] ?? []).some((c) => idLike(String(c ?? "").trim())) ? -1 : 0;
  const g = guessColumns(grid.slice(headerRow + 1), []);
  return { headerRow, idCol: g.id, nameCol: g.name, confident: false };
}

export function columnLabels(grid: Grid, headerRow: number): string[] {
  const width = Math.max(0, ...grid.map((r) => r.length));
  return Array.from({ length: width }, (_, i) => String((headerRow >= 0 ? grid[headerRow]?.[i] : "") ?? "").trim() || `#${i + 1}`);
}

const cleanId = (v: Cell): string => String(v ?? "").trim().replace(/^(\d+)\.0+$/, "$1");

/** Rows after the header. Fully blank rows are ignored. Only leading/trailing whitespace is trimmed from names. */
export function parseRows(grid: Grid, headerRow: number, idCol: number, nameCol: number): ParsedRow[] {
  const seen = new Set<string>();
  const out: ParsedRow[] = [];
  grid.forEach((r, i) => {
    if (i <= headerRow || blank(r)) return;
    const id = cleanId(r[idCol]);
    const name = String(r[nameCol] ?? "").trim();
    const sid = id ? studentId(id) : "";
    let status: RowStatus = "valid";
    if (!sid) status = "missing_id";
    else if (!name) status = "missing_name";
    else if (seen.has(sid)) status = "duplicate_in_file";
    if (status === "valid") seen.add(sid);
    out.push({ row: i + 1, id, name, studentId: sid, status });
  });
  return out;
}

/** existing* come from Firestore (fetched in bulk). Nothing here writes data. */
export function planImport(rows: ParsedRow[], existingStudents: ReadonlySet<string>, existingEnrollments: ReadonlySet<string>, year: string, courseId: string): Plan {
  const items = rows.filter((r) => r.status === "valid").map((row) => {
    const eid = enrollmentId(year, courseId, row.studentId);
    const level = cohortLevel(row.id, year); // the STUDENT's level from the admission cohort; the course level is never used
    return { row, studentExists: existingStudents.has(row.studentId), enrollmentId: eid, enrolled: existingEnrollments.has(eid), level, levelSource: level ? "cohort" as const : null };
  });
  return { items, counts: {
    total: rows.length, valid: items.length, invalid: rows.length - items.length,
    newStudents: items.filter((i) => !i.studentExists).length, existingStudents: items.filter((i) => i.studentExists).length,
    newEnrollments: items.filter((i) => !i.enrolled).length, skippedEnrollments: items.filter((i) => i.enrolled).length } };
}

/** Document for a NEW student. Level/levelSource come from the cohort rule or a manual choice; unknown stays null (needs review). */
export const buildStudentDoc = (it: PlanItem, academicYear: string) =>
  ({ fullName: it.row.name, academicId: it.row.id, level: it.level, levelSource: it.levelSource, sectionId: null, academicYear, status: "active" as const });

/** Only students that do not exist yet are written. Existing students (and their level/section) are never touched by an import. */
export const studentWrites = (items: readonly PlanItem[], academicYear: string) =>
  items.filter((i) => !i.studentExists).map((i) => ({ id: i.row.studentId, data: buildStudentDoc(i, academicYear) }));

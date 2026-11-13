import type { Level } from "./constants";

export interface CohortConfig { idPattern: RegExp; yearDigits: number; century: number; levels: readonly Level[] }
/** The ONLY place that encodes the ID scheme: the first 2 digits of a numeric university ID are the admission year (23 -> 2023). */
export const COHORT: CohortConfig = { idPattern: /^\d{6,}$/, yearDigits: 2, century: 2000, levels: [1, 2, 3, 4] };

export const academicYearStart = (year: string): number | null => { const m = /^(\d{4})-\d{4}$/.exec(year.trim()); return m ? Number(m[1]) : null; };

export function admissionYear(id: string, cfg: CohortConfig = COHORT): number | null {
  const s = id.trim();
  return cfg.idPattern.test(s) ? cfg.century + Number(s.slice(0, cfg.yearDigits)) : null;
}

/** Level for an academic year, or null when it cannot be determined confidently (repeaters, leave, odd IDs). Never guesses. */
export function cohortLevel(id: string, academicYear: string, cfg: CohortConfig = COHORT): Level | null {
  const adm = admissionYear(id, cfg), start = academicYearStart(academicYear);
  if (adm === null || start === null) return null;
  const level = start - adm + 1;
  return (cfg.levels as readonly number[]).includes(level) ? (level as Level) : null;
}

export interface LegacyStudent { id: string; academicId: string; academicYear: string; level: number | null; levelSource?: string | null }
export interface MigrationPlan { fix: { id: string; level: Level; legacyLevel: number | null }[]; review: { id: string; legacyLevel: number | null }[] }

/**
 * Only students with NO levelSource field (created before this fix, when level was copied from the course) are touched.
 * Anything with a levelSource (cohort or manual, even null) is never reconsidered, so this is safe to repeat.
 */
export function planLevelMigration(students: readonly LegacyStudent[]): MigrationPlan {
  const plan: MigrationPlan = { fix: [], review: [] };
  for (const s of students) {
    if (s.levelSource !== undefined) continue;
    const level = cohortLevel(s.academicId, s.academicYear);
    if (level) plan.fix.push({ id: s.id, level, legacyLevel: s.level }); else plan.review.push({ id: s.id, legacyLevel: s.level });
  }
  return plan;
}

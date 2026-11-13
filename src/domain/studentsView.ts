interface Searchable { fullName: string; academicId: string; sectionId: string | null }
export const NO_SECTION = "__none";

/** section: "" = all, NO_SECTION = students without a section, otherwise a section ID. Search matches name or university ID. */
export function filterStudents<T extends Searchable>(rows: T[], query: string, section: string): T[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (section === "" || (section === NO_SECTION ? !r.sectionId : r.sectionId === section))
    && (!q || r.fullName.toLowerCase().includes(q) || r.academicId.toLowerCase().includes(q)));
}

export function levelOverview(students: readonly { level: number | null; sectionId: string | null }[]) {
  const byLevel: Record<number, { total: number; withSection: number; withoutSection: number }> = {};
  for (const l of [1, 2, 3, 4]) byLevel[l] = { total: 0, withSection: 0, withoutSection: 0 };
  let unassigned = 0;
  for (const s of students) {
    const b = s.level == null ? undefined : byLevel[s.level];
    if (!b) { unassigned++; continue; }
    b.total++; if (s.sectionId) b.withSection++; else b.withoutSection++;
  }
  return { byLevel, unassigned };
}

export function paginate<T>(rows: T[], page: number, size: number): { items: T[]; pages: number; page: number; from: number; to: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p - 1) * size;
  return { items: rows.slice(start, start + size), pages, page: p, from: rows.length ? start + 1 : 0, to: Math.min(start + size, rows.length) };
}

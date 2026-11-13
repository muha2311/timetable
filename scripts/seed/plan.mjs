// Pure planning logic (no Firebase), so it can be tested offline.
import { academicLevels, courses, sections } from "./academic.mjs";
import { classroomId, facultyId } from "./ids.mjs";

export const ROLES = ["Professor", "Lecturer", "Assistant Lecturer", "Teaching Assistant"]; // mirrors src/domain/constants.ts
const optional = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

export function validateRecords({ facultyMembers, classrooms }) {
  const errors = [];
  facultyMembers.forEach((f, i) => {
    if (!f.fullName?.trim() || !facultyId(f.fullName)) errors.push(`facultyMembers[${i}]: fullName is required`);
    if (!ROLES.includes(f.role)) errors.push(`facultyMembers[${i}]: role must be one of ${ROLES.join(", ")}`);
  });
  classrooms.forEach((c, i) => {
    if (!c.name?.trim() || !classroomId(c.name, c.building)) errors.push(`classrooms[${i}]: name is required`);
    if (c.capacity != null && !(Number.isInteger(c.capacity) && c.capacity > 0)) errors.push(`classrooms[${i}]: capacity must be a positive integer`);
  });
  return errors;
}

export function buildWanted({ facultyMembers, classrooms }) {
  return [
    ...academicLevels(), ...sections(), ...courses(),
    ...facultyMembers.map((f) => ({ col: "facultyMembers", id: facultyId(f.fullName), data: optional({
      fullName: f.fullName.trim(), nameNormalized: f.fullName.trim().toLowerCase().replace(/\s+/g, " "), role: f.role, department: f.department, notes: f.notes }) })),
    ...classrooms.map((c) => ({ col: "classrooms", id: classroomId(c.name, c.building), data: optional({
      name: c.name.trim(), building: c.building?.trim(), capacity: c.capacity, notes: c.notes }) })),
  ];
}

/** Create-only plan: anything whose "collection/id" already exists is skipped, never updated. */
export function planSeed(wanted, existing) {
  const seen = new Set(), create = [], skip = [];
  for (const w of wanted) {
    const key = `${w.col}/${w.id}`;
    if (seen.has(key)) throw new Error(`Duplicate record in seed data: ${key}`);
    seen.add(key);
    (existing.has(key) ? skip : create).push(w);
  }
  return { create, skip };
}

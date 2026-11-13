// Mirror of src/domain/ids.ts (tests/seed.test.mjs verifies they stay identical).
export const slug = (s) => String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
export const levelId = (l) => `L${l}`;
export const sectionId = (l, name) => `L${l}_${slug(name)}`;
export const facultyId = (fullName) => slug(fullName);
export const courseId = (l, semester, name) => `L${l}_${slug(semester)}_${slug(name)}`;
export const studentId = (academicId) => slug(academicId);
export const classroomId = (name, building = "") => slug(`${building} ${name}`);

import { test } from "node:test";
import assert from "node:assert/strict";
import { admissionYear, cohortLevel, planLevelMigration } from "../src/domain/cohort.ts";
import { buildStudentDoc, parseRows, planImport, studentWrites } from "../src/domain/studentImport.ts";
import { levelOverview } from "../src/domain/studentsView.ts";
import { analyze } from "../src/domain/examConflicts.ts";
import { enrollmentId } from "../src/domain/ids.ts";

const Y = "2026-2027";
const grid = (...ids) => [["Student ID", "Name"], ...ids.map((id, i) => [id, `Student ${i + 1}`])];
const plan = (g, course, existing = new Set(), enrolled = new Set()) => planImport(parseRows(g, 0, 0, 1), existing, enrolled, Y, course);

test("cohort rule: 23 -> Level 4, 24 -> Level 3, 25 -> Level 2, 26 -> Level 1 (for 2026-2027)", () => {
  assert.equal(admissionYear("23411023"), 2023);
  assert.deepEqual(["23411023", "24411055", "25411001", "26411002"].map((id) => cohortLevel(id, Y)), [4, 3, 2, 1]);
});
test("the same ID gives a different level in another academic year (rule is based on the selected year)", () => {
  assert.equal(cohortLevel("24411055", "2025-2026"), 2); assert.equal(cohortLevel("24411055", "2027-2028"), 4);
});
test("cannot be determined confidently -> null (no guessing): older cohorts, future cohorts, odd IDs", () => {
  for (const id of ["22411000", "27411000", "A-77", "2341", "", "23x11023"]) assert.equal(cohortLevel(id, Y), null, id);
  assert.equal(cohortLevel("23411023", "bad-year"), null);
});

test("1. Level 4 student 23411023 imported into a LEVEL 2 course stays Level 4", () => {
  const p = plan(grid("23411023"), "L2_fall_oop");
  const [w] = studentWrites(p.items, Y);
  assert.equal(w.data.level, 4); assert.equal(w.data.levelSource, "cohort");
  assert.equal(p.items[0].enrollmentId, enrollmentId(Y, "L2_fall_oop", "23411023")); // the enrollment is for the Level 2 course
});
test("2. Level 3 student 24411055 imported into a Level 2 course stays Level 3", () => {
  assert.equal(studentWrites(plan(grid("24411055"), "L2_fall_oop").items, Y)[0].data.level, 3);
});
test("student docs never carry the course level; unknown level stays null (needs review), not a guess", () => {
  const p = plan(grid("22411000", "A-77"), "L2_fall_oop");
  for (const w of studentWrites(p.items, Y)) { assert.equal(w.data.level, null); assert.equal(w.data.levelSource, null); assert.ok(!("courseLevel" in w.data)); }
  const manual = buildStudentDoc({ ...p.items[0], level: 3, levelSource: "manual" }, Y);
  assert.deepEqual([manual.level, manual.levelSource], [3, "manual"]);
});
test("3. one student in courses of several levels: ONE student record, one enrollment per course", () => {
  const first = plan(grid("24411055"), "L2_fall_oop");
  const created = new Set(studentWrites(first.items, Y).map((w) => w.id));
  const second = plan(grid("24411055"), "L1_fall_math-1", created);
  const third = plan(grid("24411055"), "L3_fall_net", created);
  assert.equal(studentWrites(second.items, Y).length, 0); assert.equal(studentWrites(third.items, Y).length, 0);
  assert.equal(new Set([first, second, third].map((p) => p.items[0].enrollmentId)).size, 3);
  assert.equal(second.counts.newEnrollments, 1);
});
test("8. an existing student (e.g. level set manually) is NEVER written by a later import", () => {
  const p = plan(grid("23411023", "24411055"), "L1_fall_math-1", new Set(["23411023"]));
  assert.deepEqual(studentWrites(p.items, Y).map((w) => w.id), ["24411055"]); // 23411023 untouched, so its manual level survives
});
test("7. re-importing the same file creates no students and no enrollments", () => {
  const g = grid("23411023", "24411055", "25411001");
  const first = plan(g, "L2_fall_oop");
  const students = new Set(studentWrites(first.items, Y).map((w) => w.id));
  const again = plan(g, "L2_fall_oop", students, new Set(first.items.map((i) => i.enrollmentId)));
  assert.equal(studentWrites(again.items, Y).length, 0); assert.equal(again.counts.newEnrollments, 0); assert.equal(again.counts.skippedEnrollments, 3);
});

test("4/6. overview counts UNIQUE students per ACTUAL level, sections split, unknown separate", () => {
  const students = [{ level: 4, sectionId: null }, { level: 3, sectionId: "L3_1" }, { level: 3, sectionId: null }, { level: 3, sectionId: "L3_2" }, { level: null, sectionId: null }, { level: 2, sectionId: null }];
  const o = levelOverview(students);
  assert.deepEqual(o.byLevel[3], { total: 3, withSection: 2, withoutSection: 1 });
  assert.deepEqual([o.byLevel[1].total, o.byLevel[2].total, o.byLevel[4].total, o.unassigned], [0, 1, 1, 1]);
});

test("migration: legacy records (no levelSource) are corrected only when the cohort is reliable; the rest go to manual review", () => {
  const legacy = (id, level) => ({ id, academicId: id, academicYear: Y, level });
  const p = planLevelMigration([legacy("23411023", 2), legacy("24411055", 2), legacy("22411000", 2), legacy("A-77", 2)]);
  assert.deepEqual(p.fix.map((f) => [f.id, f.level, f.legacyLevel]), [["23411023", 4, 2], ["24411055", 3, 2]]);
  assert.deepEqual(p.review.map((r) => r.id), ["22411000", "A-77"]);
});
test("migration never touches manual or already-processed records and is repeatable", () => {
  const rows = [{ id: "a", academicId: "23411023", academicYear: Y, level: 2, levelSource: "manual" }, { id: "b", academicId: "24411055", academicYear: Y, level: 3, levelSource: "cohort" },
    { id: "c", academicId: "22411000", academicYear: Y, level: null, levelSource: null }];
  assert.deepEqual(planLevelMigration(rows), { fix: [], review: [] });
});

test("9. exam conflicts still compare ENROLLMENTS across levels by ID (student level is irrelevant)", () => {
  const E = (s, c) => ({ studentId: s, courseId: c, academicYear: Y, semester: "Fall" });
  const r = analyze([E("23411023", "oop"), E("23411023", "math1")], [{ id: "math1", name: "Math 1", level: 1 }], [{ id: "oop", name: "OOP", level: 2 }], Y, "Fall");
  assert.deepEqual(r.pairs.map((p) => p.students), [["23411023"]]);
});

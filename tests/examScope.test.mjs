import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyze, analyzeSelectedLevels } from "../src/domain/examConflicts.ts";

const Y = "2026-2027", S = "Fall";
const courses = [
  { id: "disc1", name: "Discrete Mathematics", level: 1, semester: S }, { id: "math1", name: "Math 1", level: 1, semester: S },
  { id: "oop2", name: "OOP", level: 2, semester: S },
  { id: "topics3", name: "Selected Topics in CS", level: 3, semester: S }, { id: "net3", name: "Computer Network", level: 3, semester: S },
  { id: "cloud4", name: "Cloud Computing", level: 4, semester: S }, { id: "spring3", name: "Spring only", level: 3, semester: "Spring" },
];
// A student's own level lives in the students collection and is NOT part of what the checker reads; it is listed here only to document the scenarios.
const ACTUAL_LEVEL = { 234001: 4, 244001: 3, 254001: 2, 264001: 1 };
const E = (studentId, courseId, o = {}) => ({ studentId: String(studentId), courseId, academicYear: Y, semester: S, ...o });
const check = (en, levels) => analyzeSelectedLevels(en, courses, levels, Y, S);
const pair = (r, a, b) => r.pairs.find((p) => p.courseA === a && p.courseB === b);

test("Test 1: a LEVEL 2 student in a Level 1 and a Level 3 course appears when Level 1 and Level 3 are selected", () => {
  const r = check([E(254001, "disc1"), E(254001, "topics3")], [1, 3]);
  assert.deepEqual(pair(r, "disc1", "topics3").students, ["254001"]); assert.equal(ACTUAL_LEVEL[254001], 2); assert.equal(r.affected, 1);
});
test("Test 2: a LEVEL 4 student in a Level 1 and a Level 3 course appears", () => {
  assert.deepEqual(pair(check([E(234001, "disc1"), E(234001, "topics3")], [1, 3]), "disc1", "topics3").students, ["234001"]);
});
test("Test 3: a student of a selected level appears too (Level 1 and Level 3 students)", () => {
  assert.deepEqual(pair(check([E(264001, "disc1"), E(264001, "topics3")], [1, 3]), "disc1", "topics3").students, ["264001"]);
  assert.deepEqual(pair(check([E(244001, "disc1"), E(244001, "topics3")], [1, 3]), "disc1", "topics3").students, ["244001"]);
});
test("the example table: all four students (levels 4, 3, 2, 1) are reported for Discrete x Selected Topics", () => {
  const en = Object.keys(ACTUAL_LEVEL).flatMap((id) => [E(id, "disc1"), E(id, "topics3")]);
  const r = check(en, [1, 3]);
  assert.deepEqual(pair(r, "disc1", "topics3").students, ["234001", "244001", "254001", "264001"]); assert.equal(r.affected, 4);
});
test("Test 4: a student enrolled in only ONE selected course creates no conflict", () => {
  const r = check([E(264001, "disc1"), E(254001, "topics3")], [1, 3]);
  assert.deepEqual([r.pairs.length, r.affected], [0, 0]);
});
test("Test 5: courses without shared student IDs never conflict (similar-looking IDs are different students)", () => {
  const r = check([E(100001, "disc1"), E(100002, "topics3"), E(100010, "net3"), E(10001, "math1")], [1, 3]);
  assert.equal(r.pairs.length, 0); assert.equal(r.safePairs, r.totalPairs); assert.equal(r.totalPairs, 4);
});
test("Test 6: three selected levels (1, 2, 3) with a LEVEL 4 student enrolled across them: every applicable pair is reported", () => {
  const r = check([E(234001, "disc1"), E(234001, "oop2"), E(234001, "topics3")], [1, 2, 3]);
  for (const [a, b] of [["disc1", "oop2"], ["disc1", "topics3"], ["oop2", "topics3"]]) assert.deepEqual(pair(r, a, b)?.students, ["234001"], `${a} x ${b}`);
  assert.equal(r.pairs.length, 3); assert.equal(r.affected, 1);
  assert.equal(r.totalPairs, 2 * 1 + 2 * 2 + 1 * 2); assert.equal(r.safePairs, r.totalPairs - 3); // 1x2 + 1x3 + 2x3 course pairs
});
test("order of selection does not matter, a level can be listed twice, and two levels behave exactly like the existing analyze()", () => {
  const en = [E(254001, "disc1"), E(254001, "topics3"), E(264001, "math1"), E(264001, "net3"), E(1, "disc1")];
  const a = check(en, [3, 1, 3]), b = check(en, [1, 3]);
  assert.deepEqual(a.pairs, b.pairs);
  const old = analyze(en, courses.filter((c) => c.level === 1), courses.filter((c) => c.level === 3 && c.semester === S), Y, S); // the unchanged comparison logic
  assert.deepEqual(b.pairs, old.pairs); assert.deepEqual([b.affected, b.totalPairs, b.safePairs], [old.affected, old.totalPairs, old.safePairs]);
});
test("selected levels choose courses: enrollments in courses of UNSELECTED levels or other semesters never create conflicts", () => {
  assert.equal(check([E(254001, "disc1"), E(254001, "cloud4")], [1, 3]).pairs.length, 0);   // Level 4 course not selected
  assert.equal(check([E(254001, "disc1"), E(254001, "spring3", { semester: "Spring" })], [1, 3]).pairs.length, 0); // other semester
  assert.equal(check([E(254001, "disc1"), E(254001, "topics3", { academicYear: "2025-2026" })], [1, 3]).pairs.length, 0); // other year
});
test("REGRESSION: a wrong or missing `level` stored on an enrollment record (e.g. the student's level) never excludes a student", () => {
  const en = [E(254001, "disc1", { level: 2 }), E(254001, "topics3", { level: 2 }), E(234001, "disc1", { level: 4 }), E(234001, "topics3", { level: undefined })];
  assert.deepEqual(pair(check(en, [1, 3]), "disc1", "topics3").students, ["234001", "254001"]);
});
test("duplicate enrollment records still count a student once; incomplete records still match nothing; quality is reported once, not per pair of levels", () => {
  const en = [E(254001, "disc1"), E(254001, "disc1"), E(254001, "topics3"), E(254001, "oop2"), { courseId: "oop2", academicYear: Y, semester: S }];
  const r = check(en, [1, 2, 3]);
  assert.equal(r.pairs.every((p) => p.students.length === 1), true); assert.equal(r.quality.duplicates, 1); assert.equal(r.quality.invalid, 1);
  assert.deepEqual(r.quality.emptyCourses.sort(), ["math1", "net3"]); // selected courses with no enrollment data are reported, not called safe
});

test("SCOPE GUARD: no student level or enrollment level is used to select who is compared (source scan)", () => {
  const repo = readFileSync("src/repositories/enrollmentsRepo.ts", "utf8"), page = readFileSync("src/pages/ExamConflictsPage.tsx", "utf8");
  const dom = readFileSync("src/domain/examConflicts.ts", "utf8");
  assert.ok(!/where\("level"/.test(repo), "enrollment reads must not filter on a level field");
  assert.ok(!/listEnrollmentsByLevel/.test(repo + page), "the level-scoped read was removed");
  assert.match(repo, /listEnrollmentsForCourses/); assert.match(page, /listEnrollmentsForCourses\(year, courseIds/);
  assert.ok(!/\.level\b/.test(dom.slice(0, dom.indexOf("export interface SelectableCourse"))), "analyze() never reads a level of a student or enrollment");
  assert.ok(!/student\w*\.level|s\.level\s*===|\.level\s*===\s*(a|b|levels)/.test(page.slice(page.indexOf("async function run"), page.indexOf("const name = "))), "run() has no student-level filter");
});

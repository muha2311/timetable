import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, applyExclusions } from "../src/domain/examConflicts.ts";

const Y = "2026-2027", S = "Fall";
const L1 = [{ id: "math1", name: "Math 1", level: 1 }, { id: "phys", name: "Physics", level: 1 }, { id: "prog", name: "Programming Fundamentals", level: 1 }];
const L3 = [{ id: "net", name: "Computer Network", level: 3 }, { id: "ai", name: "Artificial Intelligence", level: 3 }];
const e = (studentId, courseId, o = {}) => ({ studentId, courseId, academicYear: Y, semester: S, ...o });
const run = (en, a = L1, b = L3, y = Y, s = S) => analyze(en, a, b, y, s);
const pairs = (r) => r.pairs.map((p) => `${p.courseA}+${p.courseB}:${p.students.join(",")}`);

test("1. a student in Math 1 (L1) and Computer Network (L3) creates a conflict", () => {
  const r = run([e("10025", "math1"), e("10025", "net")]);
  assert.deepEqual(pairs(r), ["math1+net:10025"]); assert.equal(r.affected, 1);
});
test("2. courses with no shared students do not conflict (and are counted as safe)", () => {
  const r = run([e("1", "math1"), e("2", "net"), e("3", "ai"), e("4", "phys"), e("5", "prog")]);
  assert.equal(r.pairs.length, 0); assert.equal(r.safePairs, 6); assert.equal(r.totalPairs, 6); assert.equal(r.affected, 0);
});
test("3. multiple shared students are counted correctly", () => {
  const r = run([e("10025", "math1"), e("10025", "net"), e("10081", "math1"), e("10081", "net"), e("10120", "math1"), e("10120", "net"), e("9", "math1")]);
  assert.equal(r.pairs.length, 1); assert.deepEqual(r.pairs[0].students, ["10025", "10081", "10120"]); assert.equal(r.affected, 3);
});
test("4. duplicate enrollment records never double count a student", () => {
  const r = run([e("10025", "math1"), e("10025", "math1"), e("10025", "net"), e("10025", "net"), e("10025", "net")]);
  assert.equal(r.pairs[0].students.length, 1); assert.equal(r.quality.duplicates, 3);
});
test("5. similar names with different IDs are different people (matching is by ID only)", () => {
  // "Ali Hassan" is 1001 in Math 1 and a different "Ali Hassan" is 2002 in Network: no shared ID, no conflict
  assert.equal(run([e("1001", "math1"), e("2002", "net")]).pairs.length, 0);
});
test("6. a student in three courses across the levels generates every relevant pair", () => {
  const r = run([e("7", "math1"), e("7", "phys"), e("7", "net")]);
  assert.deepEqual(pairs(r), ["math1+net:7", "phys+net:7"]);
  const r2 = run([e("7", "math1"), e("7", "net"), e("7", "ai")]);
  assert.deepEqual(pairs(r2), ["math1+ai:7", "math1+net:7"]);
  const r3 = run([e("7", "math1"), e("7", "phys"), e("7", "net"), e("7", "ai")]);
  assert.equal(r3.pairs.length, 4); assert.equal(r3.affected, 1);
});
test("7. other semesters are not compared", () => {
  assert.equal(run([e("1", "math1"), e("1", "net", { semester: "Spring" })]).pairs.length, 0);
});
test("8. other academic years are not compared", () => {
  assert.equal(run([e("1", "math1"), e("1", "net", { academicYear: "2025-2026" })]).pairs.length, 0);
});
test("9. inactive / withdrawn enrollments are excluded when an enrollment status exists", () => {
  assert.equal(run([e("1", "math1"), e("1", "net", { status: "withdrawn" })]).pairs.length, 0);
  assert.equal(run([e("1", "math1", { status: "Inactive" }), e("1", "net")]).pairs.length, 0);
  assert.equal(run([e("1", "math1", { status: "active" }), e("1", "net")]).pairs.length, 1);
});
test("9b. inactive STUDENTS can be removed afterwards; their pairs become no-conflict", () => {
  const r = run([e("1", "math1"), e("1", "net"), e("2", "math1"), e("2", "net"), e("3", "phys"), e("3", "ai")]);
  const x = applyExclusions(r, new Set(["1"]));
  assert.deepEqual(pairs(x), ["math1+net:2", "phys+ai:3"]); assert.equal(x.affected, 2);
  const y = applyExclusions(x, new Set(["2", "3"]));
  assert.equal(y.pairs.length, 0); assert.equal(y.safePairs, 6);
});
test("10. incomplete records never match each other or anything else", () => {
  const r = run([{ courseId: "math1", academicYear: Y, semester: S }, { studentId: "", courseId: "net", academicYear: Y, semester: S },
    { studentId: "  ", courseId: "math1", academicYear: Y, semester: S }, { studentId: null, courseId: "net", academicYear: Y, semester: S }, e("5", null)]);
  assert.equal(r.pairs.length, 0); assert.equal(r.quality.invalid, 5);
});
test("courses from other levels are ignored; empty courses are reported (not claimed safe)", () => {
  const r = run([e("1", "math1"), e("1", "other-level-course"), e("2", "net")]);
  assert.equal(r.pairs.length, 0); assert.deepEqual(r.quality.emptyCourses.sort(), ["ai", "phys", "prog"]);
});
test("students in two courses of the SAME level only are not cross-level conflicts", () => {
  assert.equal(run([e("1", "math1"), e("1", "phys")]).pairs.length, 0);
});
test("results are sorted by number of shared students (largest first)", () => {
  const r = run([e("1", "math1"), e("1", "net"), e("2", "phys"), e("2", "ai"), e("3", "phys"), e("3", "ai")]);
  assert.deepEqual(r.pairs.map((p) => p.students.length), [2, 1]);
});
test("performance: 20,000 students x 4 enrollments analyzes quickly", () => {
  const en = []; for (let i = 0; i < 20000; i++) { en.push(e(`s${i}`, "math1"), e(`s${i}`, "phys")); if (i % 4 === 0) en.push(e(`s${i}`, "net")); if (i % 7 === 0) en.push(e(`s${i}`, "ai")); }
  const t0 = Date.now(); const r = run(en);
  assert.ok(Date.now() - t0 < 1500); assert.equal(r.pairs.find((p) => p.courseA === "math1" && p.courseB === "net").students.length, 5000);
});

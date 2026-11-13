import { test } from "node:test";
import assert from "node:assert/strict";
import { columnLabels, detectColumns, parseRows, planImport } from "../src/domain/studentImport.ts";
import { enrollmentId, studentId } from "../src/domain/ids.ts";

const en = [["#", "Student ID", "Student Name"], [1, "20260001", "Ali Hassan"], [2, "20260002", "Mona Said"]];
const ar = [["م", "الرقم الجامعي", "الاسم"], [1, "20260001", "علي حسن"], [2, "20260002", "منى سعيد"]];

test("detects English headers confidently", () => {
  assert.deepEqual(detectColumns(en), { headerRow: 0, idCol: 1, nameCol: 2, confident: true });
});
test("detects Arabic headers confidently (الرقم الجامعي / الاسم)", () => {
  assert.deepEqual(detectColumns(ar), { headerRow: 0, idCol: 1, nameCol: 2, confident: true });
  assert.equal(detectColumns([["كود الطالب", "اسم الطالب"], ["1001", "x"]]).idCol, 0);
});
test("header variations: ID / Name / University ID / Academic ID", () => {
  assert.equal(detectColumns([["ID", "Name"], ["1", "a"]]).confident, true);
  assert.equal(detectColumns([["Name", "University ID"], ["a", "1"]]).idCol, 1);
  assert.equal(detectColumns([["Full Name", "Academic ID (Univ.)"], ["a", "1"]]).idCol, 1);
});
test("header row is found below title rows", () => {
  const d = detectColumns([["Faculty of CS"], ["Math 1 list"], [], ["Seat", "Student ID", "Name"], ["1", "555001", "Ali"]]);
  assert.equal(d.headerRow, 3); assert.equal(d.idCol, 1); assert.equal(d.nameCol, 2);
});
test("no recognizable header: guesses from content but is NOT confident (user must check)", () => {
  const g = [["Col1", "Col2"], ["20260001", "Ali Hassan Omar"], ["20260002", "Mona Said Ali"], ["20260003", "Omar Adel Nabil"]];
  const d = detectColumns(g);
  assert.equal(d.confident, false); assert.equal(d.idCol, 0); assert.equal(d.nameCol, 1);
});
test("headerless data (first row is a student) is not treated as a header", () => {
  const d = detectColumns([["20260001", "Ali Hassan Omar"], ["20260002", "Mona Said Ali"], ["20260003", "Omar Adel Nabil"]]);
  assert.equal(d.headerRow, -1); assert.equal(parseRows([["20260001", "Ali Hassan Omar"], ["20260002", "Mona Said Ali"]], -1, 0, 1).length, 2);
});
test("manual mapping: any columns can be chosen, labels come from the header row", () => {
  const g = [["a", "b", "c"], ["x", "20260001", "Ali"]];
  assert.deepEqual(columnLabels(g, 0), ["a", "b", "c"]);
  assert.equal(parseRows(g, 0, 1, 2)[0].studentId, "20260001");
});

test("validation: trims whitespace, keeps names otherwise untouched, numeric IDs, blank rows ignored", () => {
  const rows = parseRows([["id", "name"], [20260001, "  Ali  Hassan "], ["20260002.0", "Mona"], ["", ""], [null, null]], 0, 0, 1);
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.status]), [["20260001", "Ali  Hassan", "valid"], ["20260002", "Mona", "valid"]]);
});
test("validation: missing ID, missing name, duplicates inside the file (first one wins)", () => {
  const rows = parseRows([["id", "name"], ["1001", "A"], ["", "B"], ["1003", ""], ["1001", "A again"], [" 1001 ", "A3"], ["", "   "]], 0, 0, 1);
  assert.deepEqual(rows.map((r) => r.status), ["valid", "missing_id", "missing_name", "duplicate_in_file", "duplicate_in_file"]);
  assert.deepEqual(rows.map((r) => r.row), [2, 3, 4, 5, 6]);
});
test("student ID, not name, is the identity (same name, different IDs are different students)", () => {
  const rows = parseRows([["id", "name"], ["1", "Ali"], ["2", "Ali"]], 0, 0, 1);
  assert.ok(rows.every((r) => r.status === "valid")); assert.notEqual(rows[0].studentId, rows[1].studentId);
});

const rows = parseRows([["id", "name"], ["1001", "A"], ["1002", "B"], ["1003", "C"], ["1001", "dup"], ["", "no id"]], 0, 0, 1);
test("plan: new vs existing students, new vs existing enrollments, invalid counted", () => {
  const p = planImport(rows, new Set(["1002"]), new Set([enrollmentId("2026-2027", "L1_fall_math-1", "1003")]), "2026-2027", "L1_fall_math-1");
  assert.deepEqual(p.counts, { total: 5, valid: 3, invalid: 2, newStudents: 2, existingStudents: 1, newEnrollments: 2, skippedEnrollments: 1 });
});
test("re-importing the same file: no new students and no new enrollments", () => {
  const first = planImport(rows, new Set(), new Set(), "2026-2027", "L1_fall_math-1");
  const again = planImport(rows, new Set(first.items.map((i) => i.row.studentId)), new Set(first.items.map((i) => i.enrollmentId)), "2026-2027", "L1_fall_math-1");
  assert.equal(first.counts.newStudents, 3); assert.equal(first.counts.newEnrollments, 3);
  assert.equal(again.counts.newStudents, 0); assert.equal(again.counts.newEnrollments, 0); assert.equal(again.counts.skippedEnrollments, 3);
});
test("a student in several courses: one student record, one enrollment per course, distinct deterministic IDs", () => {
  const a = planImport(rows, new Set(), new Set(), "2026-2027", "L1_fall_math-1");
  const b = planImport(rows, new Set(a.items.map((i) => i.row.studentId)), new Set(a.items.map((i) => i.enrollmentId)), "2026-2027", "L1_fall_physics");
  assert.equal(b.counts.newStudents, 0); assert.equal(b.counts.newEnrollments, 3);
  assert.notEqual(a.items[0].enrollmentId, b.items[0].enrollmentId);
  assert.equal(a.items[0].enrollmentId, "2026-2027_L1_fall_math-1_1001");
  assert.equal(a.items[0].row.studentId, studentId("1001"));
});
test("same course in a different academic year is a different enrollment", () => {
  assert.notEqual(enrollmentId("2026-2027", "L1_fall_math-1", "1001"), enrollmentId("2027-2028", "L1_fall_math-1", "1001"));
});
test("large file: 5000 rows plan quickly", () => {
  const big = [["id", "name"], ...Array.from({ length: 5000 }, (_, i) => [String(100000 + i), `Student ${i}`])];
  const t0 = Date.now(); const p = planImport(parseRows(big, 0, 0, 1), new Set(), new Set(), "2026-2027", "L1_fall_math-1");
  assert.equal(p.counts.newEnrollments, 5000); assert.ok(Date.now() - t0 < 1500);
});

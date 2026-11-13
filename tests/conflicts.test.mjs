import { test } from "node:test";
import assert from "node:assert/strict";
import { findConflicts } from "../src/domain/conflicts.ts";

const E = (o) => ({ id: "a", academicYear: "2026-2027", semester: "Fall", level: 1, day: "Monday", startMinutes: 600, endMinutes: 675, courseName: "X",
  instructorId: "i1", classroomId: "r1", sessionType: "section", sectionIds: ["L1_5"], notes: "", createdAt: null, updatedAt: null, ...o });
const kinds = (c, existing) => findConflicts(E({ id: "new", ...c }), existing).map((x) => x.kind).sort();
const base = [E({})];

test("partial overlap with shared instructor, room and section", () => assert.deepEqual(kinds({ startMinutes: 630, endMinutes: 690 }, base), ["classroom", "instructor", "section"]));
test("same time, all different resources is valid", () => assert.deepEqual(kinds({ instructorId: "i2", classroomId: "r2", sectionIds: ["L1_6"] }, base), []));
test("three simultaneous sessions with different resources", () => {
  const ex = [E({ id: "1", instructorId: "i2", classroomId: "r2", sectionIds: ["L1_6"] }), E({ id: "2", instructorId: "i3", classroomId: "r3", sectionIds: ["L1_7"] })];
  assert.deepEqual(kinds({}, ex), []);
});
test("back-to-back sessions do not conflict", () => assert.deepEqual(kinds({ startMinutes: 675, endMinutes: 740 }, base), []));
test("different day / semester / year are ignored", () => {
  assert.deepEqual(kinds({ day: "Sunday" }, base), []);
  assert.deepEqual(kinds({ semester: "Spring" }, base), []);
  assert.deepEqual(kinds({ academicYear: "2027-2028" }, base), []);
});
test("instructor conflict across levels", () => assert.deepEqual(kinds({ level: 3, classroomId: "r2", sectionIds: ["L3_1"] }, base), ["instructor"]));
test("classroom conflict across levels", () => assert.deepEqual(kinds({ level: 2, instructorId: "i2", sectionIds: ["L2_1"] }, base), ["classroom"]));
test("same section in a different course or room conflicts (even lecture vs lab)", () =>
  assert.deepEqual(kinds({ instructorId: "i2", classroomId: "r2", sessionType: "section_practical", courseName: "Other" }, base), ["section"]));
test("lectures of different levels may run simultaneously", () => {
  const lec = [E({ sessionType: "lecture", sectionIds: [], level: 1 })];
  assert.deepEqual(kinds({ sessionType: "lecture", sectionIds: [], level: 2, instructorId: "i2", classroomId: "r2" }, lec), []);
});
test("whole-level lecture vs section of same level conflicts", () => {
  const lec = [E({ sessionType: "lecture", sectionIds: [], instructorId: "i9", classroomId: "r9" })];
  assert.deepEqual(kinds({ instructorId: "i2", classroomId: "r2" }, lec), ["section"]);
  assert.deepEqual(findConflicts(E({ id: "new", sessionType: "lecture", sectionIds: [], instructorId: "i2", classroomId: "r2" }), base).map((x) => x.kind), ["section"]);
});
test("whole-level lecture vs section of another level is valid", () => {
  const lec = [E({ sessionType: "lecture", sectionIds: [], level: 2, instructorId: "i9", classroomId: "r9" })];
  assert.deepEqual(kinds({ instructorId: "i2", classroomId: "r2" }, lec), []);
});
test("multi-period session overlaps each period it covers", () => {
  const long = [E({ startMinutes: 600, endMinutes: 750 })]; // periods 1-2
  assert.deepEqual(kinds({ startMinutes: 680, endMinutes: 750 }, long), ["classroom", "instructor", "section"]);
  assert.deepEqual(kinds({ startMinutes: 755, endMinutes: 825 }, long), []);
});
test("a session with no instructor/room never conflicts on those", () =>
  assert.deepEqual(kinds({ instructorId: null, classroomId: null, sectionIds: ["L1_6"] }, [E({ instructorId: null, classroomId: null })]), []));
test("editing: entry is not compared against itself", () => {
  assert.deepEqual(findConflicts(E({ id: "a", startMinutes: 610 }), base), []);
});
test("editing: moving an entry onto another one is still detected", () => {
  const other = E({ id: "b", startMinutes: 700, endMinutes: 760 });
  assert.deepEqual(findConflicts(E({ id: "a", startMinutes: 720, endMinutes: 780 }), [E({ id: "a" }), other]).map((x) => x.kind).sort(), ["classroom", "instructor", "section"]);
});

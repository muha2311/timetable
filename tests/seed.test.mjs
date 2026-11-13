import { test } from "node:test";
import assert from "node:assert/strict";
import * as js from "../scripts/seed/ids.mjs";
import * as ts from "../src/domain/ids.ts";
import { ROLES } from "../src/domain/constants.ts";
import { ROLES as SEED_ROLES, buildWanted, planSeed, validateRecords } from "../scripts/seed/plan.mjs";
import { COURSES, courses } from "../scripts/seed/academic.mjs";
import { classrooms, facultyMembers } from "../scripts/seed/records.mjs";

const empty = { facultyMembers: [], classrooms: [] };
const keys = (a) => new Set(a.map((w) => `${w.col}/${w.id}`));

test("seed ID formulas match src/domain/ids.ts", () => {
  for (const s of ["Hall 3", "Dr. Aya Fawzi", "مبنى هندسة", " A--B ", "1"]) { assert.equal(js.slug(s), ts.slug(s)); assert.ok(js.slug(s)); }
  assert.equal(js.sectionId(1, "10"), ts.sectionId(1, "10"));
  assert.equal(js.facultyId("Aya Fawzi"), ts.facultyId("Aya Fawzi"));
  assert.equal(js.classroomId("Lab 2", "Eng"), ts.classroomId("Lab 2", "Eng"));
});
test("seed roles match the app's roles", () => assert.deepEqual(SEED_ROLES, [...ROLES]));
test("faculty and classroom records are valid, unique and complete", () => {
  assert.deepEqual(validateRecords({ facultyMembers, classrooms }), []);
  assert.equal(facultyMembers.filter((f) => f.role === "Professor").length, 12);
  assert.equal(facultyMembers.filter((f) => f.role === "Teaching Assistant").length, 12);
  assert.equal(classrooms.length, 25);
  assert.ok(classrooms.every((c) => c.capacity == null));
  const ids = buildWanted({ facultyMembers, classrooms }).map((w) => `${w.col}/${w.id}`);
  assert.equal(new Set(ids).size, ids.length);
});
test("default data: 4 levels and 10/8/4/1 sections linked to their level", () => {
  const w = buildWanted(empty);
  assert.equal(w.filter((x) => x.col === "academicLevels").length, 4);
  const secs = w.filter((x) => x.col === "sections");
  assert.deepEqual([1, 2, 3, 4].map((l) => secs.filter((s) => s.data.level === l).length), [10, 8, 4, 1]);
  assert.ok(secs.every((s) => s.id.startsWith(`L${s.data.level}_`)));
});
test("running twice creates nothing the second time", () => {
  const w = buildWanted(empty);
  const first = planSeed(w, new Set());
  assert.equal(first.create.length, 50);
  const second = planSeed(w, keys(first.create));
  assert.equal(second.create.length, 0);
  assert.equal(second.skip.length, 50);
});
test("existing (user-edited) documents are skipped, never overwritten", () => {
  const w = buildWanted(empty);
  const existing = new Set(["sections/L1_1", "academicLevels/L2"]);
  const { create, skip } = planSeed(w, existing);
  assert.deepEqual(skip.map((s) => `${s.col}/${s.id}`).sort(), ["academicLevels/L2", "sections/L1_1"]);
  assert.equal(create.length, 48);
});
test("added faculty/classroom rows get deterministic IDs and are idempotent", () => {
  const recs = { facultyMembers: [{ fullName: "Aya Fawzi", role: "Lecturer" }], classrooms: [{ name: "Hall 3", capacity: 100 }, { name: "Lab 2", building: "Eng" }] };
  assert.deepEqual(validateRecords(recs), []);
  const w = buildWanted(recs);
  const ids = w.filter((x) => ["facultyMembers", "classrooms"].includes(x.col)).map((x) => `${x.col}/${x.id}`);
  assert.deepEqual(ids, ["facultyMembers/aya-fawzi", "classrooms/hall-3", "classrooms/eng-lab-2"]);
  assert.equal(planSeed(w, keys(w)).create.length, 0);
});
test("invalid or duplicate records are rejected", () => {
  assert.equal(validateRecords({ facultyMembers: [{ fullName: "", role: "Lecturer" }, { fullName: "X", role: "Boss" }], classrooms: [{ name: "A", capacity: -1 }] }).length, 3);
  const dup = buildWanted({ facultyMembers: [{ fullName: "A B", role: "Lecturer" }, { fullName: "a  b", role: "Professor" }], classrooms: [] });
  assert.throws(() => planSeed(dup, new Set()), /Duplicate/);
});

test("23 Fall courses seeded with correct level, unique deterministic IDs, idempotent", () => {
  const c = courses();
  assert.deepEqual([1, 2, 3, 4].map((l) => c.filter((x) => x.data.level === l).length), [6, 6, 6, 5]);
  assert.equal(c.length, 23);
  assert.ok(c.every((x) => x.col === "courses" && x.data.semester === "Fall" && x.id.startsWith(`L${x.data.level}_fall_`)));
  assert.equal(new Set(c.map((x) => x.id)).size, 23);
  assert.deepEqual(c.filter((x) => x.data.level === 4).map((x) => x.data.name), COURSES[4]);
  assert.equal(c[0].id, "L1_fall_math-1");
  assert.equal(js.courseId(2, "Fall", "OOP"), ts.courseId(2, "Fall", "OOP"));
  const w = buildWanted(empty); assert.equal(planSeed(w, keys(w)).create.length, 0);
});
test("students: no seed records, deterministic ID from registration number", () => {
  assert.equal(buildWanted(empty).filter((x) => x.col === "students").length, 0);
  assert.equal(js.studentId("2026/0042"), ts.studentId("2026/0042"));
});
test("classroom capacity is a null placeholder in the seed data and is never written", () => {
  assert.equal(classrooms.length, 25);
  assert.ok(classrooms.every((c) => "capacity" in c && c.capacity === null));
  assert.ok(buildWanted({ facultyMembers, classrooms }).filter((w) => w.col === "classrooms").every((w) => !("capacity" in w.data)));
  const withCap = buildWanted({ facultyMembers: [], classrooms: [{ name: "X", capacity: 80 }] }).find((w) => w.col === "classrooms");
  assert.equal(withCap.data.capacity, 80);
});

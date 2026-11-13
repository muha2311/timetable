import { test } from "node:test";
import assert from "node:assert/strict";
import { filterStudents, NO_SECTION, paginate } from "../src/domain/studentsView.ts";
import { cached, invalidate, peek, clearCache } from "../src/repositories/cache.ts";

const rows = [
  { fullName: "Ali Hassan", academicId: "1001", sectionId: "L1_1" }, { fullName: "Mona Said", academicId: "1002", sectionId: "L1_2" },
  { fullName: "علي حسن", academicId: "A-77", sectionId: null }, { fullName: "Ali Omar", academicId: "1003", sectionId: "L1_1" },
];
test("search matches name or university ID, case-insensitively, Arabic included", () => {
  assert.equal(filterStudents(rows, "ali", "").length, 2); assert.equal(filterStudents(rows, "1002", "")[0].fullName, "Mona Said");
  assert.equal(filterStudents(rows, "a-77", "").length, 1); assert.equal(filterStudents(rows, "علي", "").length, 1); assert.equal(filterStudents(rows, "  ", "").length, 4);
});
test("section filter: one section, all, and students without a section", () => {
  assert.equal(filterStudents(rows, "", "L1_1").length, 2); assert.equal(filterStudents(rows, "", NO_SECTION).length, 1); assert.equal(filterStudents(rows, "ali", "L1_1").length, 2);
  assert.equal(filterStudents(rows, "mona", "L1_1").length, 0);
});
test("pagination: sizes, clamping, ranges", () => {
  const many = Array.from({ length: 120 }, (_, i) => i);
  assert.deepEqual(paginate(many, 1, 50), { items: many.slice(0, 50), pages: 3, page: 1, from: 1, to: 50 });
  const last = paginate(many, 3, 50); assert.equal(last.items.length, 20); assert.equal(last.to, 120);
  assert.equal(paginate(many, 99, 50).page, 3); assert.equal(paginate(many, -4, 50).page, 1);
  assert.deepEqual(paginate([], 1, 50), { items: [], pages: 1, page: 1, from: 0, to: 0 });
});
test("cache: reuses fresh data, de-duplicates simultaneous loads, refreshes on force/invalidate/expiry", async () => {
  clearCache(); let calls = 0; const load = async () => ++calls;
  const [a, b] = await Promise.all([cached("data:x", load), cached("data:x", load)]);
  assert.equal(a, 1); assert.equal(b, 1); assert.equal(calls, 1);
  assert.equal(await cached("data:x", load), 1); assert.equal(peek("data:x"), 1);
  assert.equal(await cached("data:x", load, { force: true }), 2);
  invalidate("data:"); assert.equal(peek("data:x"), undefined); assert.equal(await cached("data:x", load), 3);
  assert.equal(await cached("data:x", load, { ttl: -1 }), 4);
  await assert.rejects(cached("data:bad", async () => { throw new Error("x"); })); assert.equal(await cached("data:bad", async () => 5), 5);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { enrollmentOverview, examOverview, nextSessions, roomUtilization, sessionsByDay, topInstructors, WEEK_MINUTES } from "../src/domain/dashboard.ts";
import { levelOverview } from "../src/domain/studentsView.ts";

const S = (day, startMinutes, o = {}) => ({ id: `${day}${startMinutes}${o.instructorId ?? ""}`, day, startMinutes, endMinutes: startMinutes + 75, instructorId: null, classroomId: null, ...o });

test("student counts come from unique student records: 5 enrollments of one student are still 1 student", () => {
  const students = [{ level: 3, sectionId: null }]; // one student document; their 5 enrollments live in another collection and are never counted here
  assert.deepEqual(levelOverview(students).byLevel[3], { total: 1, withSection: 0, withoutSection: 1 });
});
test("empty data: every calculation returns empty/zero results without errors", () => {
  assert.deepEqual(sessionsByDay([]).map((d) => d.n), [0, 0, 0, 0, 0]); assert.deepEqual(topInstructors([]), []); assert.deepEqual(roomUtilization([]), []);
  assert.deepEqual(nextSessions([], new Date()), []);
  const e = examOverview([], () => 1, () => 10, "2026-12-01", ""); assert.deepEqual([e.midterm, e.final, e.upcoming.length, e.scheduledCourses, e.capacityIssues.length, e.roomClashes.length], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(enrollmentOverview([], {}), { withEnrollments: [], without: [], total: 0 });
});
test("sessions by the five teaching days (Sunday-Thursday only)", () => {
  const r = sessionsByDay([S("Sunday", 600), S("Sunday", 680), S("Tuesday", 600), S("Thursday", 600)]);
  assert.deepEqual(r.map((d) => [d.day, d.n]), [["Sunday", 2], ["Monday", 0], ["Tuesday", 1], ["Wednesday", 0], ["Thursday", 1]]);
});
test("top instructors ranked by number of sessions; sessions without an instructor are ignored", () => {
  const r = topInstructors([S("Sunday", 1, { instructorId: "a" }), S("Sunday", 2, { instructorId: "b" }), S("Monday", 1, { instructorId: "b" }), S("Monday", 2), S("Monday", 3, { instructorId: "b" }), S("Monday", 4, { instructorId: "a" })], 2);
  assert.deepEqual(r, [{ id: "b", n: 3 }, { id: "a", n: 2 }]);
});
test("room utilization = scheduled minutes / available teaching-week minutes", () => {
  assert.equal(WEEK_MINUTES, 5 * (75 + 70 + 70 + 70));
  const r = roomUtilization([S("Sunday", 600, { classroomId: "r1" }), S("Monday", 600, { classroomId: "r1" }), S("Monday", 680, { classroomId: "r2" }), S("Monday", 700)]);
  assert.deepEqual(r.map((x) => [x.id, x.minutes]), [["r1", 150], ["r2", 75]]); assert.equal(r[0].percent, Math.round((150 / WEEK_MINUTES) * 1000) / 10);
});
test("next sessions: rest of today first, then following days; weekend skips to Sunday", () => {
  const entries = [S("Sunday", 600, { id: "a" }), S("Sunday", 900, { id: "b" }), S("Monday", 600, { id: "c" })];
  const sun = new Date(2026, 10, 8, 12, 0); // Sunday 12:00
  assert.equal(sun.getDay(), 0);
  assert.deepEqual(nextSessions(entries, sun).map((e) => [e.id, e.offset]), [["b", 0], ["c", 1], ["a", 7], ["b", 7]]);
  const fri = new Date(2026, 10, 13, 9, 0); assert.equal(fri.getDay(), 5);
  assert.deepEqual(nextSessions(entries, fri).map((e) => e.id), ["a", "b", "c"]);
});
test("exam overview: counts by type, upcoming, by level, scheduled courses; the type filter narrows the detail but not the totals", () => {
  const ex = [
    { id: "1", examType: "midterm", courseId: "m1", date: "2026-12-01", startMinutes: 540, endMinutes: 660, roomIds: ["A"], studentCount: 50 },
    { id: "2", examType: "final", courseId: "n3", date: "2027-01-10", startMinutes: 540, endMinutes: 660, roomIds: ["A", "B"], studentCount: 90 },
    { id: "3", examType: "final", courseId: "m1", date: "2027-01-10", startMinutes: 600, endMinutes: 700, roomIds: ["B"], studentCount: 40 }];
  const lvl = (id) => ({ m1: 1, n3: 3 })[id], cap = (r) => ({ A: 60, B: 30 })[r];
  const all = examOverview(ex, lvl, cap, "2026-12-15", "");
  assert.deepEqual([all.midterm, all.final, all.upcoming.map((e) => e.id), all.byLevel[1], all.byLevel[3], all.scheduledCourses], [1, 2, ["2", "3"], 2, 1, 2]);
  assert.deepEqual(all.capacityIssues, ["3"]); assert.deepEqual(all.roomClashes, [["2", "3"]]); // exam 3: 40 students in a 30-seat room; B is double-booked on Jan 10
  const fin = examOverview(ex, lvl, cap, "2026-12-15", "final"); assert.deepEqual([fin.midterm, fin.final, fin.byLevel[1], fin.upcoming.length], [1, 2, 1, 2]);
  const mid = examOverview(ex, lvl, cap, "2026-12-15", "midterm"); assert.deepEqual([mid.upcoming.length, mid.capacityIssues.length, mid.roomClashes.length], [0, 0, 0]);
});
test("exam capacity warning when a room has unknown capacity (never treated as unlimited)", () => {
  const e = examOverview([{ id: "x", examType: "final", courseId: "c", date: "2027-01-01", startMinutes: 1, endMinutes: 2, roomIds: ["U"], studentCount: 5 }], () => 1, () => null, "2026-01-01", "");
  assert.deepEqual(e.capacityIssues, ["x"]);
});
test("enrollment overview: with/without enrollments and total", () => {
  const r = enrollmentOverview([{ id: "a" }, { id: "b" }, { id: "c" }], { a: 10, b: 0, c: 5 });
  assert.deepEqual([r.withEnrollments.map((c) => c.id), r.without.map((c) => c.id), r.total], [["a", "c"], ["b"], 15]);
});
test("performance: 900 students' worth of data and a 3,000-entry timetable compute instantly", () => {
  const students = Array.from({ length: 900 }, (_, i) => ({ level: (i % 4) + 1, sectionId: i % 3 ? `s${i % 10}` : null }));
  const entries = Array.from({ length: 3000 }, (_, i) => S(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"][i % 5], 600 + (i % 4) * 75, { instructorId: `i${i % 40}`, classroomId: `r${i % 25}` }));
  const t0 = Date.now(); const o = levelOverview(students); sessionsByDay(entries); topInstructors(entries); roomUtilization(entries);
  assert.equal(Object.values(o.byLevel).reduce((a, b) => a + b.total, 0), 900); assert.ok(Date.now() - t0 < 500);
});

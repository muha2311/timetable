import { test } from "node:test";
import assert from "node:assert/strict";
import { autoAssign, availability, buildBusy, evaluateExam, InvigError, INVIGILATORS_PER_ROOM, occupiedRooms, requiredInvigilators, saveInvigWithRevalidation, slotProblems, workloadOf } from "../src/domain/invigilation.ts";
import { StaleError } from "../src/domain/examSchedule.ts";

const P = (category, id, o = {}) => ({ key: `${category}:${id}`, id, name: id, category, active: true, ...o });
const people = (tas, admins, extra = []) => new Map([...Array.from({ length: tas }, (_, i) => P("TA", `ta${String(i).padStart(2, "0")}`)), ...Array.from({ length: admins }, (_, i) => P("ADMIN", `ad${i}`)), ...extra].map((p) => [p.key, p]));
const X = (id, start, end, rooms, o = {}) => ({ id, courseId: `c-${id}`, date: "2026-12-20", startMinutes: start, endMinutes: end, roomIds: rooms, ...o });
const S = (cat, id) => ({ category: cat, personId: id });
const none = () => buildBusy([], new Map());
const rooms = (n) => Array.from({ length: n }, (_, i) => `R${i + 1}`);

test("1/2. required invigilators = occupied rooms x 2 (1->2, 2->4, 5->10, 10->20)", () => {
  assert.equal(INVIGILATORS_PER_ROOM, 2); assert.deepEqual([1, 2, 5, 10].map(requiredInvigilators), [2, 4, 10, 20]);
  assert.equal(evaluateExam(X("e", 540, 660, rooms(5)), {}, people(0, 0), none()).required, 10);
});
test("3. the number of students never changes the requirement; an unoccupied room needs none", () => {
  const few = X("e", 540, 660, rooms(2), { allocation: { R1: ["s1"], R2: ["s2"] } }), many = X("e", 540, 660, rooms(2), { allocation: { R1: Array(500).fill("s"), R2: Array(900).fill("s") } });
  assert.equal(evaluateExam(few, {}, people(0, 0), none()).required, evaluateExam(many, {}, people(0, 0), none()).required);
  assert.deepEqual(occupiedRooms(X("e", 1, 2, rooms(3), { allocation: { R1: ["a"], R2: [], R3: ["b"] } })), ["R1", "R3"]);
  assert.equal(evaluateExam(X("e", 1, 2, rooms(3), { allocation: { R1: ["a"], R2: [], R3: ["b"] } }), {}, people(0, 0), none()).required, 4);
});
test("4. teaching assistants are assigned before administrative staff", () => {
  const ex = X("e", 540, 660, rooms(2)), r = autoAssign(ex, {}, people(4, 4), none(), new Map());
  const cats = Object.values(r.assignments).flat().map((s) => s.category); assert.deepEqual(cats, ["TA", "TA", "TA", "TA"]); assert.equal(r.shortage, 0);
});
test("5. administrative staff fill the shortage only when teaching assistants are insufficient (and every room gets a TA first)", () => {
  const ex = X("e", 540, 660, rooms(3)), r = autoAssign(ex, {}, people(4, 5), none(), new Map());
  const flat = Object.values(r.assignments).flat(); assert.equal(flat.filter((s) => s.category === "TA").length, 4); assert.equal(flat.filter((s) => s.category === "ADMIN").length, 2);
  assert.ok(Object.values(r.assignments).every((sl) => sl.some((s) => s.category === "TA"))); assert.equal(r.shortage, 0);
});
test("9. exact shortage: 6 rooms need 12; 9 TAs + 2 admins = 11 available -> shortage 1; and 4 rooms with 8 TAs -> shortage 0", () => {
  const a = autoAssign(X("e", 540, 660, rooms(6)), {}, people(9, 2), none(), new Map()); assert.deepEqual([a.shortage, evaluateExam(X("e", 540, 660, rooms(6)), a.assignments, people(9, 2), none()).shortage], [1, 1]);
  const b = autoAssign(X("e", 540, 660, rooms(4)), {}, people(8, 0), none(), new Map()); assert.equal(b.shortage, 0);
  assert.equal(evaluateExam(X("e", 540, 660, rooms(4)), b.assignments, people(8, 0), none()).required, 8);
});
test("6/7. overlapping exams block the same person; touching or separate times do not", () => {
  const A = X("A", 540, 660, ["R1"]), pe = people(10, 0), asg = new Map([["A", { R1: [S("TA", "ta00"), S("TA", "ta01")] }]]);
  const busy = (others) => buildBusy([A, ...others], asg);
  for (const [s, e, blocked] of [[540, 660, true], [600, 720, true], [500, 560, true], [550, 600, true], [660, 780, false], [400, 540, false], [700, 800, false]]) {
    const B = X("B", s, e, ["R2"]); assert.equal(availability(B, pe, {}, busy([B])).unavailable.some((u) => u.person.key === "TA:ta00" && u.reason === "busy"), blocked, `${s}-${e}`);
  }
  const otherDay = X("B", 540, 660, ["R2"], { date: "2026-12-21" }); assert.equal(availability(otherDay, pe, {}, busy([otherDay])).unavailable.length, 0);
});
test("6b. an overlapping assignment is invalid and counts as zero valid invigilators", () => {
  const A = X("A", 540, 660, ["R1"]), B = X("B", 600, 720, ["R2"]), pe = people(6, 0), asg = new Map([["A", { R1: [S("TA", "ta00"), S("TA", "ta01")] }]]);
  const ev = evaluateExam(B, { R2: [S("TA", "ta00"), S("TA", "ta02")] }, pe, buildBusy([A, B], asg));
  assert.deepEqual([ev.rooms[0].status, ev.rooms[0].valid, ev.validTotal, ev.shortage], ["invalid", 1, 1, 1]); assert.deepEqual(ev.rooms[0].slots[0].issues, ["busy_elsewhere"]); assert.deepEqual(ev.rooms[0].slots[0].busyWith, ["A"]);
});
test("8. the same person cannot be assigned twice within one exam, even in different rooms", () => {
  const ex = X("E", 540, 660, ["R1", "R2"]), ev = evaluateExam(ex, { R1: [S("TA", "ta00"), S("TA", "ta01")], R2: [S("TA", "ta00"), S("TA", "ta02")] }, people(5, 0), none());
  assert.deepEqual(ev.rooms[1].slots[0].issues, ["duplicate"]); assert.equal(ev.validTotal, 3); assert.equal(ev.shortage, 1);
});
test("10. a room is complete only with exactly two valid invigilators; one -> incomplete; none -> incomplete; invalid slot -> invalid", () => {
  const ex = X("E", 540, 660, ["R1", "R2", "R3"]), pe = people(8, 0, [P("TA", "off", { active: false })]);
  const ev = evaluateExam(ex, { R1: [S("TA", "ta00"), S("TA", "ta01")], R2: [S("TA", "ta02")], R3: [S("TA", "off"), S("TA", "ta03")] }, pe, none());
  assert.deepEqual(ev.rooms.map((r) => r.status), ["complete", "incomplete", "invalid"]); assert.deepEqual([ev.completeRooms, ev.incompleteRooms, ev.invalidRooms, ev.validTotal, ev.shortage], [1, 1, 1, 4, 2]);
  assert.equal(evaluateExam(ex, { R1: [S("TA", "ta00"), S("TA", "ta01"), S("TA", "ta02")] }, pe, none()).rooms[0].status, "invalid"); // a third person is never valid
});
test("11/14. invalid assignments are rejected: inactive, unknown, wrong category, room not occupied", () => {
  const ex = X("E", 540, 660, ["R1"]), pe = people(4, 0, [P("TA", "off", { active: false })]);
  const ev = evaluateExam(ex, { R1: [S("TA", "off"), S("TA", "ghost")], R9: [S("TA", "ta00")] }, pe, none());
  assert.deepEqual(ev.rooms[0].slots.map((s) => s.issues), [["inactive"], ["unknown_person"]]); assert.deepEqual(ev.rooms[1].slots[0].issues, ["room_not_occupied"]);
  assert.equal(slotProblems(ev).length, 3);
  assert.deepEqual(evaluateExam(ex, { R1: [S("ADMIN", "ta00")] }, pe, none()).rooms[0].slots[0].issues.includes("unknown_person"), true);
  assert.equal(availability(ex, pe, {}, none()).available.some((p) => p.key === "TA:off"), false); // inactive people are never offered
  assert.equal(autoAssign(ex, {}, pe, none(), new Map()).assignments.R1.some((s) => s?.personId === "off"), false);
});
test("12. manual assignment follows the same rules: an admin is rejected while an available TA remains; accepted when TAs are exhausted", () => {
  const ex = X("E", 540, 660, ["R1"]);
  assert.deepEqual(evaluateExam(ex, { R1: [S("ADMIN", "ad0"), S("TA", "ta00")] }, people(3, 2), none()).rooms[0].slots[0].issues, ["admin_while_ta_available"]);
  assert.equal(evaluateExam(ex, { R1: [S("TA", "ta00"), S("ADMIN", "ad0")] }, people(1, 2), none()).rooms[0].status, "complete");
  const A = X("A", 540, 660, ["R1"]), busy = buildBusy([A, ex], new Map([["A", { R1: [S("TA", "ta01"), S("TA", "ta02")] }]])); // the other TAs are busy elsewhere, so an admin is legitimate
  assert.equal(evaluateExam(ex, { R1: [S("TA", "ta00"), S("ADMIN", "ad0")] }, people(3, 1), busy).rooms[0].status, "complete");
});
test("13. recalculating keeps existing valid assignments and fills only the gaps (invalid ones are cleared)", () => {
  const ex = X("E", 540, 660, ["R1", "R2"]), pe = people(8, 0), keep = { R1: [S("TA", "ta05"), null], R2: [S("TA", "ta06"), S("TA", "ta06")] };
  const r = autoAssign(ex, keep, pe, none(), new Map());
  assert.deepEqual([r.assignments.R1[0].personId, r.assignments.R2[0].personId], ["ta05", "ta06"]); assert.equal(r.shortage, 0);
  const ids = Object.values(r.assignments).flat().map((s) => s.personId); assert.equal(new Set(ids).size, 4);
});
test("fair distribution: people with the lowest workload are used first; availability still wins", () => {
  const ex = X("E", 540, 660, ["R1"]), pe = people(4, 0), load = new Map([["TA:ta00", 5], ["TA:ta01", 0], ["TA:ta02", 1], ["TA:ta03", 0]]);
  assert.deepEqual(Object.values(autoAssign(ex, {}, pe, none(), load).assignments).flat().map((s) => s.personId), ["ta01", "ta03"]);
  const A = X("A", 540, 660, ["R1"]), busy = buildBusy([A, ex], new Map([["A", { R1: [S("TA", "ta01"), S("TA", "ta03")] }]])); // the least-loaded people are busy
  assert.deepEqual(Object.values(autoAssign(ex, {}, pe, busy, load).assignments).flat().map((s) => s.personId), ["ta02", "ta00"]);
  assert.equal(workloadOf(new Map([["A", { R1: [S("TA", "ta01"), S("TA", "ta03")] }], ["B", { R1: [S("TA", "ta01"), null] }]])).get("TA:ta01"), 2);
});
test("15. conflicts are checked across every exam: different rooms, courses and levels", () => {
  const exams = [X("A", 540, 660, ["R1"], { courseId: "level1" }), X("B", 600, 700, ["R7"], { courseId: "level4" }), X("C", 660, 780, ["R3"])];
  const asg = new Map([["A", { R1: [S("TA", "ta00"), S("TA", "ta01")] }], ["C", { R3: [S("TA", "ta02"), S("TA", "ta03")] }]]);
  const av = availability(exams[1], people(5, 0), {}, buildBusy(exams, asg)).unavailable.map((u) => u.person.id); assert.deepEqual(av, ["ta00", "ta01", "ta02", "ta03"]);
});
test("a completely staffed exam is flagged staffed; no rooms means nothing required and not 'staffed'", () => {
  const ex = X("E", 540, 660, ["R1"]), full = evaluateExam(ex, { R1: [S("TA", "ta00"), S("TA", "ta01")] }, people(3, 0), none()); assert.equal(full.staffed, true);
  assert.equal(evaluateExam(X("E", 1, 2, []), {}, people(3, 0), none()).staffed, false);
});
test("16. authoritative save: invalid assignments are refused, incomplete ones are allowed, and a concurrent conflicting save is caught", async () => {
  const store = { version: 0, asg: new Map() }, pe = people(6, 0), A = X("A", 540, 660, ["R1"]), B = X("B", 600, 720, ["R2"]); let open; const gate = new Promise((r) => { open = r; });
  const save = (exam, assignments) => saveInvigWithRevalidation({ readVersion: async () => store.version, load: async () => { const s = new Map(store.asg); await gate; return s; },
    evaluate: (s) => evaluateExam(exam, assignments, pe, buildBusy([A, B], s)), commit: async (v) => { if (store.version !== v) throw new StaleError(); store.version++; store.asg.set(exam.id, assignments); } });
  const pa = save(A, { R1: [S("TA", "ta00"), S("TA", "ta01")] }), pb = save(B, { R2: [S("TA", "ta00"), S("TA", "ta02")] }); await new Promise((r) => setTimeout(r, 5)); open();
  const [ra, rb] = await Promise.allSettled([pa, pb]);
  assert.equal(ra.status, "fulfilled"); assert.equal(rb.status, "rejected"); assert.ok(rb.reason instanceof InvigError); assert.deepEqual(rb.reason.issues[0].issues, ["busy_elsewhere"]); assert.equal(store.asg.size, 1);
  await save(B, { R2: [S("TA", "ta02")] }); assert.equal(store.asg.size, 2); // incomplete (one invigilator) is accepted
});

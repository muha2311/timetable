import { test } from "node:test";
import assert from "node:assert/strict";
import { capacitySummary, distribute, enrolledStudents, ExamValidationError, saveWithRevalidation, StaleError, validateAllocation, validateExam } from "../src/domain/examSchedule.ts";
import { buildDocumentHtml, brandingFor } from "../src/features/exams/examPdf.ts";

const Y = "2026-2027", S = "Fall", SCH = "2026-2027_fall_final";
const courses = new Map([["math1", { id: "math1", name: "Math 1", level: 1 }], ["net", { id: "net", name: "Computer Network", level: 3 }], ["phys", { id: "phys", name: "Physics", level: 1 }], ["ai", { id: "ai", name: "AI", level: 3 }]]);
const R = (id, capacity) => ({ id, name: id, capacity });
const rooms = new Map([R("A", 100), R("B", 80), R("C", 70), R("D", 50), R("U", null), R("big", 400), R("X", 500), R("Y", 500)].map((r) => [r.id, r]));
const E = (sid, cid, o = {}) => ({ studentId: sid, courseId: cid, academicYear: Y, semester: S, ...o });
const many = (cid, n, prefix = "s") => Array.from({ length: n }, (_, i) => E(`${prefix}${String(i).padStart(4, "0")}`, cid));
const exam = (o) => ({ id: `${SCH}__${o.courseId}`, scheduleId: SCH, academicYear: Y, semester: S, examType: "final", date: "2026-12-20", startMinutes: 540, endMinutes: 660, roomIds: ["X"], ...o });
const lite = (e) => ({ id: e.id, courseId: e.courseId, date: e.date, startMinutes: e.startMinutes, endMinutes: e.endMinutes, roomIds: e.roomIds });
const check = (cand, existing = [], enrollments = []) => validateExam({ exam: cand, courses, roomsById: rooms, scheduleExams: existing.map(lite), dateExams: existing.map(lite), enrollments });
const codes = (v) => v.issues.map((i) => i.code);
const base = [...many("math1", 10, "m"), ...many("net", 10, "n"), ...many("phys", 5, "p"), ...many("ai", 5, "a")];

test("1. two courses on the same day with NO shared students: allowed", () => {
  const v = check(exam({ courseId: "math1", roomIds: ["X"] }), [exam({ courseId: "net", roomIds: ["Y"] })], base);
  assert.equal(v.ok, true); assert.equal(v.status, "safe");
});
test("2. same day WITH shared students: blocked", () => {
  const v = check(exam({ courseId: "math1" }), [exam({ courseId: "net", roomIds: ["Y"] })], [...base, E("shared", "math1"), E("shared", "net")]);
  assert.equal(v.ok, false); assert.equal(v.status, "conflict"); assert.deepEqual(v.conflicts[0].students, ["shared"]); assert.ok(codes(v).includes("student_conflict"));
});
test("3. different days with shared students: allowed", () => {
  const v = check(exam({ courseId: "math1", date: "2026-12-21" }), [exam({ courseId: "net", roomIds: ["Y"] })], [...base, E("shared", "math1"), E("shared", "net")]);
  assert.equal(v.ok, true);
});
test("4. different times on the same day with shared students: still blocked (one exam per student per day)", () => {
  const v = check(exam({ courseId: "math1", startMinutes: 900, endMinutes: 1000 }), [exam({ courseId: "net", roomIds: ["Y"] })], [...base, E("shared", "math1"), E("shared", "net")]);
  assert.ok(codes(v).includes("student_conflict"));
});
test("5. simultaneous exams in different rooms with no shared students: allowed", () => {
  const v = check(exam({ courseId: "phys", roomIds: ["X"] }), [exam({ courseId: "ai", roomIds: ["Y"] })], base);
  assert.equal(v.ok, true); assert.deepEqual(v.roomBookings, []);
});
test("6. same room for overlapping exams: blocked (back-to-back is fine)", () => {
  const other = exam({ courseId: "net", roomIds: ["X"], startMinutes: 540, endMinutes: 660 });
  assert.ok(codes(check(exam({ courseId: "phys", roomIds: ["X"], startMinutes: 600, endMinutes: 700 }), [other], base)).includes("room_booked"));
  assert.ok(!codes(check(exam({ courseId: "phys", roomIds: ["X"], startMinutes: 660, endMinutes: 760 }), [other], base)).includes("room_booked"));
  assert.ok(!codes(check(exam({ courseId: "phys", roomIds: ["X"], date: "2026-12-21" }), [other], base)).includes("room_booked"));
});
test("7. one course in several rooms whose COMBINED capacity is sufficient (300 students; 100+80+70+50): allowed", () => {
  const en = many("math1", 300);
  const v = check(exam({ courseId: "math1", roomIds: ["A", "B", "C", "D"] }), [], en);
  assert.equal(v.ok, true); assert.deepEqual([v.capacity.studentCount, v.capacity.total, v.capacity.remaining, v.capacity.shortfall, v.capacity.sufficient], [300, 300, 0, 0, true]);
});
test("8. combined capacity insufficient (250 for 300): blocked, shortfall 50", () => {
  const v = check(exam({ courseId: "math1", roomIds: ["A", "B", "C"] }), [], many("math1", 300));
  assert.equal(v.ok, false); assert.equal(v.capacity.shortfall, 50); assert.deepEqual(v.issues.find((i) => i.code === "capacity_insufficient"), { code: "capacity_insufficient", n: 50 });
});
test("9. no single room is required to fit the whole course", () => {
  assert.equal(capacitySummary(300, [R("A", 100), R("B", 80), R("C", 70), R("D", 50)]).sufficient, true);
  assert.equal(capacitySummary(300, [R("A", 100)]).sufficient, false);
  assert.equal(capacitySummary(300, [R("A", 100), R("B", 80), R("C", 70), R("D", 50)]).roomCount, 4);
});
test("10. combined capacity updates as rooms are added / removed", () => {
  const sel = [R("A", 100)]; const totals = [capacitySummary(300, sel).total];
  sel.push(R("B", 80)); totals.push(capacitySummary(300, sel).total);
  sel.push(R("C", 70), R("D", 50)); totals.push(capacitySummary(300, sel).total);
  sel.shift(); totals.push(capacitySummary(300, sel).total);
  assert.deepEqual(totals, [100, 180, 300, 200]); assert.equal(capacitySummary(300, sel).shortfall, 100); assert.equal(capacitySummary(150, [R("A", 100), R("B", 80)]).remaining, 30);
});
test("11. distribution never exceeds any room's capacity (300 and 250 students, plus 300 random cases)", () => {
  const rs = [R("A", 100), R("B", 80), R("C", 70), R("D", 50)];
  const full = distribute(Array.from({ length: 300 }, (_, i) => `s${i}`), rs); assert.deepEqual(rs.map((r) => full[r.id].length), [100, 80, 70, 50]);
  for (const n of [250, 1, 0, 299]) { const d = distribute(Array.from({ length: n }, (_, i) => `s${i}`), rs); rs.forEach((r) => assert.ok(d[r.id].length <= r.capacity)); assert.equal(Object.values(d).flat().length, n); }
  for (let k = 0; k < 300; k++) {
    const caps = Array.from({ length: 1 + (k % 5) }, (_, i) => 1 + ((k * 7 + i * 13) % 60)), tot = caps.reduce((a, b) => a + b, 0), n = (k * 11) % (tot + 1);
    const rr = caps.map((c, i) => R(`r${i}`, c)), d = distribute(Array.from({ length: n }, (_, i) => `s${i}`), rr);
    rr.forEach((r) => assert.ok(d[r.id].length <= r.capacity)); assert.equal(Object.values(d).flat().length, n);
  }
  assert.equal(distribute(Array.from({ length: 301 }, (_, i) => `s${i}`), rs), null);
});
test("12/18. every student is in exactly one room; room lists have no duplicates and match the enrollment", () => {
  const ids = Array.from({ length: 300 }, (_, i) => `s${String(i).padStart(4, "0")}`), rs = [R("A", 100), R("B", 80), R("C", 70), R("D", 50)];
  const d = distribute([...ids, ...ids.slice(0, 20)], rs); // duplicate input IDs collapse
  const all = Object.values(d).flat();
  assert.equal(all.length, 300); assert.equal(new Set(all).size, 300); assert.deepEqual([...all].sort(), ids); assert.deepEqual(validateAllocation(ids, rs, d), []);
});
test("13. the same student in two rooms is rejected (also by validateExam)", () => {
  const ids = ["a", "b", "c"], rs = [R("A", 5), R("B", 5)];
  assert.deepEqual(validateAllocation(ids, rs, { A: ["a", "b"], B: ["b", "c"] }).find((i) => i.code === "duplicate").ids, ["b"]);
  assert.deepEqual(validateAllocation(ids, rs, { A: ["a"], B: ["b"] }).map((i) => i.code), ["missing"]);
  assert.ok(validateAllocation(ids, rs, { A: ["a", "b", "c", "a", "b", "c"] }).some((i) => i.code === "over_capacity"));
  assert.ok(validateAllocation(ids, rs, { A: ["a", "zzz"], B: ["b", "c"] }).some((i) => i.code === "unknown_student"));
  const v = check(exam({ courseId: "math1", roomIds: ["A"], allocation: { A: ["m0000", "m0000"] } }), [], base);
  assert.ok(codes(v).includes("allocation_invalid"));
  const ok = check(exam({ courseId: "math1", roomIds: ["A"], allocation: { A: v.students } }), [], base); assert.equal(ok.ok, true);
});
test("14. a room with unknown capacity warns and blocks; it is never counted and never 'unlimited'", () => {
  const v = check(exam({ courseId: "math1", roomIds: ["big", "U"] }), [], many("math1", 50));
  assert.equal(v.ok, false); assert.deepEqual(v.issues.find((i) => i.code === "room_unknown_capacity").ids, ["U"]);
  assert.equal(v.capacity.total, 400); assert.equal(v.capacity.sufficient, false);
  assert.equal(capacitySummary(10, [R("U", null)]).sufficient, false); assert.equal(capacitySummary(10, [R("Z", 0)]).sufficient, false);
  assert.ok(codes(check(exam({ courseId: "math1", roomIds: ["missing-room"] }), [], many("math1", 5))).includes("room_unknown_capacity"));
});
test("15. editing an exam never conflicts with itself, but moving it onto another exam is still detected", () => {
  const mine = exam({ courseId: "math1", roomIds: ["X"] }), other = exam({ courseId: "net", roomIds: ["Y"], date: "2026-12-21" });
  const en = [...base, E("shared", "math1"), E("shared", "net")];
  assert.equal(check(mine, [mine, other], en).ok, true);
  assert.equal(check({ ...mine, startMinutes: 560 }, [mine], en).ok, true);
  assert.ok(codes(check({ ...mine, date: "2026-12-21" }, [mine, other], en)).includes("student_conflict"));
});
test("a course cannot be scheduled twice in the same schedule", () => {
  assert.ok(codes(check({ ...exam({ courseId: "math1" }), id: "another-id" }, [exam({ courseId: "math1" })], base)).includes("duplicate_course"));
});
test("unverifiable data blocks: no enrollments for the course, an empty course already that day, or incomplete records", () => {
  assert.ok(codes(check(exam({ courseId: "math1" }), [], [])).includes("unverified"));
  const v = check(exam({ courseId: "math1" }), [exam({ courseId: "ai", roomIds: ["Y"] })], many("math1", 5)); // 'ai' has no enrollment data
  assert.equal(v.status, "unverified"); assert.equal(v.ok, false);
  assert.ok(codes(check(exam({ courseId: "math1" }), [], [...base, { studentId: "", courseId: "math1", academicYear: Y, semester: S }])).includes("unverified"));
});
test("students are counted once by university ID; other years/semesters and inactive enrollments are not counted", () => {
  const en = [E("1", "math1"), E("1", "math1"), E("2", "math1"), E("3", "math1", { semester: "Spring" }), E("4", "math1", { academicYear: "2025-2026" }), E("5", "math1", { status: "withdrawn" }), E(" 6 ", "math1")];
  assert.deepEqual(enrolledStudents(en, "math1", Y, S), ["1", "2", "6"]);
});
test("date and time must be valid", () => {
  assert.ok(codes(check(exam({ courseId: "math1", date: "2026-13-45" }), [], base)).includes("date_invalid"));
  assert.ok(codes(check(exam({ courseId: "math1", startMinutes: 600, endMinutes: 600 }), [], base)).includes("time_invalid"));
});

test("16. two administrators saving conflicting exams at the same moment: the final validation blocks the second", async () => {
  const store = { version: 0, exams: [] };
  const en = [...base, E("shared", "math1"), E("shared", "net")];
  let open; const gate = new Promise((r) => { open = r; });
  const session = (cand) => saveWithRevalidation({
    readVersion: async () => store.version,
    load: async () => { const snap = [...store.exams]; await gate; return snap; }, // both sessions load BEFORE either commits
    validate: (snap) => validateExam({ exam: cand, courses, roomsById: rooms, scheduleExams: snap, dateExams: snap, enrollments: en }),
    commit: async (version) => { if (store.version !== version) throw new StaleError(); store.version++; store.exams.push(lite(cand)); },
  });
  const a = exam({ courseId: "math1", roomIds: ["X"] }), b = exam({ courseId: "net", roomIds: ["Y"], startMinutes: 900, endMinutes: 1000 });
  const p = [session(a), session(b)]; await new Promise((r) => setTimeout(r, 5)); open();
  const [ra, rb] = await Promise.allSettled(p);
  assert.equal(ra.status, "fulfilled"); assert.equal(rb.status, "rejected");
  assert.ok(rb.reason instanceof ExamValidationError); assert.ok(rb.reason.issues.some((i) => i.code === "student_conflict")); assert.equal(store.exams.length, 1);
});
test("16b. a concurrent save that does NOT conflict succeeds after re-validation", async () => {
  const store = { version: 0, exams: [] }; let open; const gate = new Promise((r) => { open = r; });
  const session = (cand) => saveWithRevalidation({ readVersion: async () => store.version, load: async () => { const s = [...store.exams]; await gate; return s; },
    validate: (s) => validateExam({ exam: cand, courses, roomsById: rooms, scheduleExams: s, dateExams: s, enrollments: base }),
    commit: async (v) => { if (store.version !== v) throw new StaleError(); store.version++; store.exams.push(lite(cand)); } });
  const p = [session(exam({ courseId: "math1", roomIds: ["X"] })), session(exam({ courseId: "net", roomIds: ["Y"] }))]; await new Promise((r) => setTimeout(r, 5)); open();
  assert.deepEqual((await Promise.allSettled(p)).map((r) => r.status), ["fulfilled", "fulfilled"]); assert.equal(store.exams.length, 2);
});

const brand = { universityName: "Uni", facultyName: "Faculty of CS", header: "", footer: "Confidential", universityLogo: "data:image/png;base64,AAA", facultyLogo: "" };
const doc = (o = {}) => buildDocumentHtml({ lang: "en", dir: "ltr", branding: brand, title: "Examination Schedule", meta: ["2026-2027", "Fall", "Final"], columns: ["Date", "Course"], rows: [["2026-12-20", "Math 1"]], generated: "Generated on x", pageLabel: "Page", emptyText: "none", ...o });
test("17. English PDF: LTR, branded header, repeated table header, page numbers, footer, data", () => {
  const h = doc();
  for (const s of ['dir="ltr"', "Uni", "Faculty of CS", "data:image/png;base64,AAA", "Math 1", "table-header-group", "counter(page)", "counter(pages)", "Confidential", "A4 landscape", "print-color-adjust:exact"]) assert.ok(h.includes(s), s);
});
test("17. Arabic PDF: RTL with Arabic course and student names", () => {
  const h = doc({ lang: "ar", dir: "rtl", title: "جدول الامتحانات", columns: ["التاريخ", "المقرر"], rows: [["2026-12-20", "الرياضيات 1"], ["", "علي حسن"]], pageLabel: "صفحة", orientation: "portrait" });
  for (const s of ['dir="rtl"', 'lang="ar"', "جدول الامتحانات", "الرياضيات 1", "علي حسن", "@bottom-right", "A4 portrait", "صفحة"]) assert.ok(h.includes(s), s);
});
test("PDF template is configurable (no hardcoded names/logos), escapes text, ignores non-image logo values", () => {
  const empty = doc({ branding: brandingFor({ universityNameEn: "", universityNameAr: "", facultyNameEn: "", facultyNameAr: "", headerEn: "", headerAr: "", footerEn: "", footerAr: "", universityLogo: "", facultyLogo: "" }, "en") });
  assert.ok(!empty.includes('class="u"') && !empty.includes("<img"));
  const b = brandingFor({ universityNameEn: "E", universityNameAr: "ع", facultyNameEn: "", facultyNameAr: "كلية", headerEn: "", headerAr: "", footerEn: "", footerAr: "", universityLogo: "", facultyLogo: "" }, "ar");
  assert.deepEqual([b.universityName, b.facultyName], ["ع", "كلية"]); assert.equal(brandingFor({ ...{ universityNameEn: "E", universityNameAr: "", facultyNameEn: "F", facultyNameAr: "", headerEn: "", headerAr: "", footerEn: "", footerAr: "", universityLogo: "", facultyLogo: "" } }, "ar").universityName, "E");
  const evil = doc({ rows: [["<script>x</script>", "a"]], branding: { ...brand, universityLogo: "javascript:alert(1)", footer: 'a"b' } });
  assert.ok(!evil.includes("<script>x") && evil.includes("&lt;script&gt;") && !evil.includes("javascript:") && evil.includes('a\\"b'));
  assert.ok(doc({ rows: [] }).includes("none"));
});

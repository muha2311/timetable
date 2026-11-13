import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimetableHtml } from "../src/features/timetable/exportPdf.ts";

const cell = (o = {}) => ({ type: "lecture", badge: "LEC", time: "10:00 – 11:15", course: "Math 1", instructor: "Aya Fawzy", room: "Hall 3 (Building A)", sections: "Sec 1, 2", ...o });
const base = (o = {}) => ({ lang: "en", dir: "ltr", title: "Timetable — Level 1", org: "CS", meta: ["Fall"], dayHeader: "Day",
  slots: [{ label: "Period 1", time: "10:00" }, { label: "Period 2", time: "11:20" }],
  rows: [{ dayLabel: "Sunday", cells: [[cell(), cell({ type: "section_practical", badge: "LAB", course: "Physics" })], []] }, { dayLabel: "Monday", cells: [[], []] }],
  legend: [{ type: "lecture", badge: "LEC", label: "Lecture" }], footer: "f", ...o });

test("English export is LTR and contains all saved data, both simultaneous sessions, and all days", () => {
  const h = buildTimetableHtml(base());
  for (const s of ['dir="ltr"', 'lang="en"', "Math 1", "Physics", "Aya Fawzy", "Hall 3 (Building A)", "Sec 1, 2", "Sunday", "Monday", "Period 2", "LEC", "LAB"]) assert.ok(h.includes(s), s);
});
test("Arabic export is RTL and keeps Arabic text and Latin room numbers", () => {
  const h = buildTimetableHtml(base({ lang: "ar", dir: "rtl", title: "الجدول الدراسي", rows: [{ dayLabel: "الأحد", cells: [[cell({ course: "الرياضيات 1", room: "قاعة 3" })], []] }] }));
  for (const s of ['dir="rtl"', 'lang="ar"', "الجدول الدراسي", "الأحد", "الرياضيات 1", "قاعة 3", "Cairo"]) assert.ok(h.includes(s), s);
});
test("print layout: A4 landscape, colors kept, rows not split across pages, three type colors", () => {
  const h = buildTimetableHtml(base());
  for (const s of ["A4 landscape", "print-color-adjust:exact", "break-inside:avoid", "#fdf0c8", "#cfd8e3"]) assert.ok(h.includes(s), s);
});
test("user text is HTML-escaped", () => {
  const h = buildTimetableHtml(base({ rows: [{ dayLabel: "D", cells: [[cell({ course: "<script>alert(1)</script>" })], []] }] }));
  assert.ok(!h.includes("<script>alert") && h.includes("&lt;script&gt;"));
});

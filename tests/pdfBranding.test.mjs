import { test } from "node:test";
import assert from "node:assert/strict";
import { brandingFor, buildDocumentHtml } from "../src/features/exams/examPdf.ts";
import { buildTimetableHtml } from "../src/features/timetable/exportPdf.ts";

const inst = (o = {}) => ({ universityNameEn: "East Port Said National University", universityNameAr: "جامعة شرق بورسعيد الأهلية", facultyNameEn: "Faculty of CS", facultyNameAr: "كلية علوم الحاسب", headerEn: "", headerAr: "", footerEn: "Official", footerAr: "رسمي", universityLogo: "data:image/png;base64,UNI1", facultyLogo: "data:image/png;base64,FAC1", ...o });
const tt = (branding, o = {}) => buildTimetableHtml({ lang: "en", dir: "ltr", title: "Timetable — Level 1", meta: ["2026-2027"], dayHeader: "Day", slots: [{ label: "P1", time: "10:00" }], rows: [{ dayLabel: "Sunday", cells: [[{ type: "lecture", badge: "LEC", time: "10:00", course: "Math 1", instructor: "Dr A", room: "H1", sections: "All" }]] }], legend: [{ type: "lecture", badge: "LEC", label: "Lecture" }], footer: "gen", branding, pageLabel: "Page", ...o });
const ex = (branding, o = {}) => buildDocumentHtml({ lang: "en", dir: "ltr", branding, title: "Exam Schedule", meta: [], columns: ["Date"], rows: [["2026-12-20"]], generated: "g", pageLabel: "Page", emptyText: "-", ...o });

test("8/9. changing the university logo or faculty logo changes BOTH the timetable and the exam PDF (one shared configuration)", () => {
  const a = brandingFor(inst(), "en"), b = brandingFor(inst({ universityLogo: "data:image/png;base64,UNI2", facultyLogo: "data:image/png;base64,FAC2" }), "en");
  for (const build of [tt, ex]) {
    assert.ok(build(a).includes("UNI1") && build(a).includes("FAC1")); assert.ok(!build(a).includes("UNI2"));
    assert.ok(build(b).includes("UNI2") && build(b).includes("FAC2")); assert.ok(!build(b).includes("UNI1") && !build(b).includes("FAC1"));
  }
});
test("10. university and faculty names (and footer) appear in both templates, in the right language", () => {
  for (const build of [tt, ex]) {
    const en = build(brandingFor(inst(), "en")); assert.ok(en.includes("East Port Said National University") && en.includes("Faculty of CS") && en.includes("Official"));
    const ar = build(brandingFor(inst(), "ar"), { lang: "ar", dir: "rtl" }); assert.ok(ar.includes("جامعة شرق بورسعيد الأهلية") && ar.includes("كلية علوم الحاسب") && ar.includes("رسمي") && ar.includes('dir="rtl"'));
  }
});
test("11/12. both templates share the same header, fonts, footer position, repeated table header and page numbers (RTL aware)", () => {
  const b = brandingFor(inst(), "ar");
  for (const build of [tt, ex]) {
    const h = build(b, { lang: "ar", dir: "rtl" });
    for (const s of ["table-header-group", "counter(page)", "counter(pages)", "@bottom-right", "Cairo", "border-bottom:2px solid #184f5c", "print-color-adjust:exact", "A4 landscape"]) assert.ok(h.includes(s), s);
    assert.ok(build(b).includes("@bottom-left")); // LTR footer on the other side
  }
});
test("same header markup in both documents (same document family)", () => {
  const b = brandingFor(inst(), "en"), head = (h) => /<div class="head">.*?<\/div><\/div>/s.exec(h)[0];
  assert.equal(head(tt(b)), head(ex(b)));
});
test("no branding configured: no names, no logo images, still a valid document", () => {
  const empty = brandingFor({ universityNameEn: "", universityNameAr: "", facultyNameEn: "", facultyNameAr: "", headerEn: "", headerAr: "", footerEn: "", footerAr: "", universityLogo: "", facultyLogo: "" }, "en");
  for (const build of [tt, ex]) { const h = build(empty); assert.ok(!h.includes("<img") && !h.includes('class="u"')); assert.ok(h.includes("Math 1") || h.includes("2026-12-20")); }
});
test("timetable list export: row tint per session type, Arabic text kept, text escaped", () => {
  const h = ex(brandingFor(inst(), "ar"), { lang: "ar", dir: "rtl", columns: ["اليوم", "المقرر"], rows: [["الأحد", "الرياضيات 1"], ["الاثنين", "<b>x</b>"]], rowColors: ["#fdf0c8", "#cfd8e3"] });
  assert.ok(h.includes("background:#fdf0c8") && h.includes("background:#cfd8e3") && h.includes("الرياضيات 1") && h.includes("&lt;b&gt;"));
});
test("a non-image logo value is never embedded", () => { assert.ok(!tt({ ...brandingFor(inst(), "en"), universityLogo: "javascript:alert(1)" }).includes("javascript:")); });

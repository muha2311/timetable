import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { ACADEMIC_YEARS, EXAM_TYPES, LEVELS, SEMESTERS, type ExamType, type Level, type Semester } from "../domain/constants";
import { timesOverlap } from "../domain/examSchedule";
import { examScheduleId } from "../domain/ids";
import { rangeLabel } from "../domain/time";
import { ExamDetails } from "../features/exams/ExamDetails";
import { ExamForm } from "../features/exams/ExamForm";
import { brandingFor, buildDocumentHtml } from "../features/exams/examPdf";
import { printHtml } from "../features/timetable/exportPdf";
import { useRefData } from "../features/timetable/useRefData";
import { useI18n } from "../i18n";
import { listCourseRoster } from "../repositories/enrollmentsRepo";
import { listExams } from "../repositories/examsRepo";
import { deleteExamCritical } from "../services/offline/critical";
import { getInstitution } from "../repositories/settingsRepo";
import type { Exam } from "../types";

const sel = "mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const lbl = "text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const th = "px-3 py-2 text-start font-semibold";
type Scope = "all" | "level" | "date";

export function ExamSchedulePage() {
  const { t, tc, lang, dir } = useI18n();
  const toast = useToast();
  const refs = useRefData();
  const [year, setYear] = useState<string>("2026-2027");
  const [semester, setSemester] = useState<Semester>("Fall");
  const [type, setType] = useState<ExamType>("midterm");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<{ exam: Exam | null } | null>(null);
  const [detail, setDetail] = useState<Exam | null>(null);
  const [toDelete, setToDelete] = useState<Exam | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [scopeLevel, setScopeLevel] = useState<Level>(1);
  const [scopeDate, setScopeDate] = useState("");
  const [month, setMonth] = useState("");
  const scheduleId = examScheduleId(year, semester, type);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(false);
    listExams(scheduleId, tick > 0).then((r) => { if (alive) setExams(r.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes)); }).catch(() => { if (alive) setError(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [scheduleId, tick]);
  const reload = () => setTick((x) => x + 1);

  const fmt = useMemo(() => new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", year: "numeric", month: "short", day: "numeric" }), [lang]);
  const dateLabel = (d: string) => fmt.format(new Date(`${d}T00:00:00`));
  const courseOf = (id: string) => refs.courses.find((c) => c.id === id);
  const room = (id: string) => { const c = refs.classrooms.find((x) => x.id === id); return c ? (c.building ? `${c.name} (${c.building})` : c.name) : id; };
  const capNow = (e: Exam) => { const caps = e.roomIds.map((r) => refs.classrooms.find((c) => c.id === r)?.capacity); return { total: caps.reduce<number>((a, c) => a + (typeof c === "number" ? c : 0), 0), unknown: caps.some((c) => typeof c !== "number") }; };
  const clash = useMemo(() => { const s = new Set<string>(); exams.forEach((a, i) => exams.slice(i + 1).forEach((b) => { if (a.date === b.date && timesOverlap(a, b) && a.roomIds.some((r) => b.roomIds.includes(r))) { s.add(a.id); s.add(b.id); } })); return s; }, [exams]);
  const dates = useMemo(() => [...new Set(exams.map((e) => e.date))], [exams]);
  const schedule = { id: scheduleId, year, semester, type };

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try { const r = await deleteExamCritical(toDelete); toast.success(t(r === "queued" ? "sync.savedOffline" : "exam.deleted")); setToDelete(null); reload(); } catch { toast.error(t("timetable.deleteFailed")); } finally { setDeleting(false); }
  }

  // ---- PDF exports: always built from the SAVED exams (state loaded from Firestore), never from the open form ----
  const meta = () => [`${t("timetable.year")}: ${year}`, `${t("timetable.semester")}: ${t(`semester.${semester}`)}`, `${t("exam.type")}: ${t(`examType.${type}`)}`];
  async function out(title: string, extra: string[], columns: string[], rows: string[][], orientation: "landscape" | "portrait") {
    try {
      const branding = brandingFor(await getInstitution(), lang);
      printHtml(buildDocumentHtml({ lang, dir, branding, title, meta: [...meta(), ...extra], columns, rows, generated: t("pdf.generated", { date: new Date().toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB") }), pageLabel: t("pdf.page"), emptyText: t("exam.empty"), orientation }));
      toast.success(t("export.opened"));
    } catch { toast.error(t("export.failed")); }
  }
  function exportSchedule() {
    const list = exams.filter((e) => scope === "all" || (scope === "level" ? courseOf(e.courseId)?.level === scopeLevel : e.date === scopeDate));
    const extra = scope === "level" ? [t("level", { n: scopeLevel })] : scope === "date" ? [dateLabel(scopeDate)] : [];
    void out(t("pdf.examTitle"), extra, [t("exam.date"), t("col.day"), t("import.course"), t("col.level"), t("form.start"), t("form.end"), t("exam.duration"), t("col.rooms"), t("col.capacity"), t("col.count")],
      list.map((e) => { const c = courseOf(e.courseId); const d = new Date(`${e.date}T00:00:00`); const [s, f] = rangeLabel(e.startMinutes, e.endMinutes).replace(/[\u2066\u2069]/g, "").split(" – ");
        return [e.date, new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long" }).format(d), tc(c?.name ?? e.courseId), c ? t("level", { n: c.level }) : "", s ?? "", f ?? "", String(e.endMinutes - e.startMinutes), e.roomIds.map(room).join(", "), String(capNow(e).total), String(e.studentCount)]; }), "landscape");
  }
  async function studentList(e: Exam, roomId?: string) {
    try {
      const roster = await listCourseRoster(e.academicYear, e.courseId);
      const uniq = new Map(roster.map((r) => [r.studentId, r]));
      let ids = [...uniq.keys()];
      if (roomId) { ids = e.allocation?.[roomId] ?? []; if (!ids.length) { toast.error(t("exam.noDistribution")); return; } }
      const sec = new Map(refs.sections.map((s) => [s.id, s.name]));
      const rows = [...new Set(ids)].sort().map((id, i) => { const s = uniq.get(id)?.student; return [String(i + 1), s?.academicId ?? id, s?.fullName ?? "—", s?.level ? t("level", { n: s.level }) : "—", s?.sectionId ? sec.get(s.sectionId) ?? "—" : "—"]; });
      await out(t("pdf.studentList"), [`${t("import.course")}: ${tc(courseOf(e.courseId)?.name ?? e.courseId)}`, dateLabel(e.date), rangeLabel(e.startMinutes, e.endMinutes), ...(roomId ? [`${t("col.room")}: ${room(roomId)}`] : []), t("students.total", { n: rows.length })],
        ["#", t("col.studentId"), t("col.studentName"), t("col.level"), t("col.section")], rows, "portrait");
    } catch { toast.error(t("export.failed")); }
  }

  const monthKey = month || exams[0]?.date.slice(0, 7) || new Date().toISOString().slice(0, 7);
  const [my, mm] = monthKey.split("-").map(Number) as [number, number];
  const shift = (n: number) => { const d = new Date(my, mm - 1 + n, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const cells = useMemo(() => { const first = new Date(my, mm - 1, 1).getDay(), n = new Date(my, mm, 0).getDate(); return [...Array(first).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)] as (number | null)[]; }, [my, mm]);
  const wk = useMemo(() => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "short" }).format(new Date(2024, 0, 7 + i))), [lang]);

  return (
    <>
      <PageHeader title={t("nav.examSchedule")} description={t("exam.description")} action={<Button onClick={() => setForm({ exam: null })}>+ {t("exam.add")}</Button>} />
      <div className={`${card} mb-4 flex flex-wrap items-end gap-x-4 gap-y-3`}>
        <label className={lbl}>{t("timetable.year")}<select className={sel} value={year} onChange={(e) => setYear(e.target.value)}>{ACADEMIC_YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className={lbl}>{t("timetable.semester")}<select className={sel} value={semester} onChange={(e) => setSemester(e.target.value as Semester)}>{SEMESTERS.map((s) => <option key={s} value={s}>{t(`semester.${s}`)}</option>)}</select></label>
        <label className={lbl}>{t("exam.type")}<select className={sel} value={type} onChange={(e) => setType(e.target.value as ExamType)}>{EXAM_TYPES.map((x) => <option key={x} value={x}>{t(`examType.${x}`)}</option>)}</select></label>
        <div role="group" aria-label={t("timetable.view")} className="flex gap-1">
          <Button variant={view === "list" ? "primary" : "secondary"} aria-pressed={view === "list"} onClick={() => setView("list")}>{t("timetable.list")}</Button>
          <Button variant={view === "calendar" ? "primary" : "secondary"} aria-pressed={view === "calendar"} onClick={() => setView("calendar")}>{t("exam.calendar")}</Button>
        </div>
        <Button variant="secondary" onClick={reload} disabled={loading}>{t("common.refresh")}</Button>
        <div className="ms-auto flex flex-wrap items-end gap-2">
          <label className={lbl}>{t("exam.exportScope")}<select className={sel} value={scope} onChange={(e) => setScope(e.target.value as Scope)}><option value="all">{t("exam.scopeAll")}</option><option value="level">{t("exam.scopeLevel")}</option><option value="date">{t("exam.scopeDate")}</option></select></label>
          {scope === "level" && <select aria-label={t("timetable.level")} className={sel} value={scopeLevel} onChange={(e) => setScopeLevel(Number(e.target.value) as Level)}>{LEVELS.map((l) => <option key={l} value={l}>{t("level", { n: l })}</option>)}</select>}
          {scope === "date" && <select aria-label={t("exam.date")} className={sel} value={scopeDate} onChange={(e) => setScopeDate(e.target.value)}><option value="">{t("import.select")}</option>{dates.map((d) => <option key={d} value={d}>{dateLabel(d)}</option>)}</select>}
          <Button onClick={exportSchedule} disabled={loading || (scope === "date" && !scopeDate)}>{t("exam.exportSchedule")}</Button>
        </div>
      </div>
      {error && <p role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {t("exam.loadFailed")}</p>}
      {loading || refs.loading ? <p className="text-sm text-slate-500" role="status">{t("common.loading")}</p> : view === "list" ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-slate-100 dark:bg-slate-800"><tr><th className={th}>{t("import.course")}</th><th className={th}>{t("col.level")}</th><th className={th}>{t("exam.date")}</th><th className={th}>{t("col.time")}</th><th className={th}>{t("exam.duration")}</th><th className={th}>{t("col.rooms")}</th><th className={th}>{t("col.capacity")}</th><th className={th}>{t("col.count")}</th><th className={th}>{t("col.status")}</th><th className={th}><span className="sr-only">{t("col.actions")}</span></th></tr></thead>
            <tbody>
              {exams.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">{t("exam.empty")}</td></tr>}
              {exams.map((e) => { const c = courseOf(e.courseId), cap = capNow(e), low = cap.unknown || cap.total < e.studentCount; return (
                <tr key={e.id} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="px-3 py-2 font-medium" dir="auto">{tc(c?.name ?? e.courseId)}</td><td className="px-3 py-2">{c ? t("level", { n: c.level }) : "—"}</td><td className="px-3 py-2" dir="auto">{dateLabel(e.date)}</td>
                  <td className="px-3 py-2">{rangeLabel(e.startMinutes, e.endMinutes)}</td><td className="px-3 py-2">{t("exam.minutes", { n: e.endMinutes - e.startMinutes })}</td>
                  <td className="px-3 py-2" dir="auto">{e.roomIds.map(room).join(", ")}</td><td className="px-3 py-2" dir="ltr">{cap.total}</td><td className="px-3 py-2" dir="ltr">{e.studentCount}</td>
                  <td className="px-3 py-2"><span className="block text-xs">✓ {t("exam.statusScheduled")}</span>{low && <span className="block text-xs text-amber-700">⚠ {t("exam.capacityWarning")}</span>}{clash.has(e.id) && <span className="block text-xs text-red-700">⛔ {t("exam.roomBooked")}</span>}</td>
                  <td className="px-3 py-2"><div className="flex gap-1"><Button variant="secondary" onClick={() => setDetail(e)}>{t("common.view")}</Button><Button variant="secondary" onClick={() => setForm({ exam: e })}>{t("common.edit")}</Button><Button variant="danger" onClick={() => setToDelete(e)}>{t("common.delete")}</Button></div></td></tr>); })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={card}>
          <div className="mb-3 flex items-center justify-between"><Button variant="secondary" onClick={() => shift(-1)}>{t("common.prev")}</Button><b dir="auto">{new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { month: "long", year: "numeric" }).format(new Date(my, mm - 1, 1))}</b><Button variant="secondary" onClick={() => shift(1)}>{t("common.next")}</Button></div>
          <div className="overflow-x-auto"><div className="grid min-w-[44rem] grid-cols-7 gap-1 text-sm">
            {wk.map((d) => <div key={d} className="px-1 py-1 text-center text-xs font-semibold text-slate-500">{d}</div>)}
            {cells.map((d, i) => { const key = d ? `${monthKey}-${String(d).padStart(2, "0")}` : ""; const list = d ? exams.filter((e) => e.date === key) : []; return (
              <div key={i} className={`min-h-[5.5rem] rounded border p-1 ${d ? "border-slate-200 dark:border-slate-700" : "border-transparent"}`}>
                {d && <div className="text-xs text-slate-500" dir="ltr">{d}</div>}
                {list.map((e) => <button key={e.id} onClick={() => setDetail(e)} className={`mb-1 block w-full rounded border-s-4 px-1 py-0.5 text-start text-xs ${clash.has(e.id) ? "border-red-600 bg-red-50 text-red-900" : "border-brand-600 bg-brand-50 text-slate-900"}`} dir="auto">{tc(courseOf(e.courseId)?.name ?? e.courseId)} <span dir="ltr">{rangeLabel(e.startMinutes, e.endMinutes)}</span></button>)}
              </div>); })}
          </div></div>
        </div>
      )}

      <Modal wide open={form !== null} title={form?.exam ? t("exam.edit") : t("exam.add")} onClose={() => setForm(null)}>
        {form && <ExamForm refs={refs} schedule={schedule} exam={form.exam} scheduleExams={exams} onCancel={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      </Modal>
      <Modal open={detail !== null} title={t("exam.details")} onClose={() => setDetail(null)}>
        {detail && <ExamDetails exam={detail} refs={refs} dateLabel={dateLabel(detail.date)} onEdit={() => { setForm({ exam: detail }); setDetail(null); }} onExportRoom={(r) => void studentList(detail, r)} onExportCourse={() => void studentList(detail)} />}
      </Modal>
      <ConfirmDialog open={toDelete !== null} title={t("exam.deleteTitle")} busy={deleting} message={t("exam.deleteMessage", { name: toDelete ? tc(courseOf(toDelete.courseId)?.name ?? toDelete.courseId) : "" })} onConfirm={() => void confirmDelete()} onCancel={() => setToDelete(null)} />
    </>
  );
}

import { useMemo, useState, type FormEvent } from "react";
import { useAuth } from "../app/AuthProvider";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { ACADEMIC_YEARS, EXAM_TYPES, SEMESTERS, type ExamType, type Semester } from "../domain/constants";
import { personKey } from "../domain/invigilation";
import { rangeLabel } from "../domain/time";
import { brandingFor, buildDocumentHtml } from "../features/exams/examPdf";
import { ExamStaffing } from "../features/invigilation/ExamStaffing";
import { useInvigData, type InvigData } from "../features/invigilation/useInvigData";
import { printHtml } from "../features/timetable/exportPdf";
import { useDebounced } from "../hooks/useDebounced";
import { useI18n } from "../i18n";
import { createAdminStaff, updateAdminStaff } from "../repositories/invigilationRepo";
import { getInstitution } from "../repositories/settingsRepo";
import { invalidate } from "../repositories/cache";
import type { AdminStaff, Exam } from "../types";

const sel = "mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const lbl = "text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const th = "px-3 py-2 text-start font-semibold";
type Status = "staffed" | "incomplete" | "invalid";

const Stat = ({ n, label, warn }: { n: number; label: string; warn?: boolean }) => (
  <div className={`${card} ${warn && n > 0 ? "border-amber-400" : ""}`}><div className="text-3xl font-semibold tabular-nums" dir="ltr">{n}</div><div className="text-xs text-slate-600 dark:text-slate-400">{label}</div></div>);

export function InvigilationPage() {
  const { t, tc, lang, dir } = useI18n();
  const toast = useToast();
  const [year, setYear] = useState<string>("2026-2027");
  const [semester, setSemester] = useState<Semester>("Fall");
  const [type, setType] = useState<"" | ExamType>("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<"" | Status>("");
  const [tab, setTab] = useState<"overview" | "staff">("overview");
  const [managing, setManaging] = useState<Exam | null>(null);
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const data = useInvigData(year, semester);
  const today = new Date().toISOString().slice(0, 10);
  const fmt = useMemo(() => new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }), [lang]);

  const statusOf = (e: Exam): Status => { const v = data.evals.get(e.id); return !v ? "incomplete" : v.hasInvalid ? "invalid" : v.staffed ? "staffed" : "incomplete"; };
  const shown = useMemo(() => data.exams.filter((e) => (!type || e.examType === type) && (!date || e.date === date) && (!status || statusOf(e) === status)), // eslint-disable-line react-hooks/exhaustive-deps
    [data.exams, data.evals, type, date, status]);
  const dates = useMemo(() => [...new Set(data.exams.map((e) => e.date))], [data.exams]);
  const totals = useMemo(() => {
    const ev = shown.map((e) => data.evals.get(e.id)).filter((x): x is NonNullable<typeof x> => !!x);
    return { upcoming: shown.filter((e) => e.date >= today).length, rooms: ev.reduce((a, x) => a + x.occupied, 0), required: ev.reduce((a, x) => a + x.required, 0), ta: ev.reduce((a, x) => a + x.assignedTA, 0),
      admin: ev.reduce((a, x) => a + x.assignedAdmin, 0), shortage: ev.reduce((a, x) => a + x.shortage, 0), staffed: ev.filter((x) => x.staffed).length, incomplete: ev.filter((x) => !x.staffed).length };
  }, [shown, data.evals, today]);
  const courseName = (id: string) => tc(data.refs.courses.find((c) => c.id === id)?.name ?? id);
  const room = (id: string) => { const c = data.refs.classrooms.find((x) => x.id === id); return c ? (c.building ? `${c.name} (${c.building})` : c.name) : id; };
  const people = useMemo(() => [...data.people.values()].filter((p) => !dq.trim() || p.name.toLowerCase().includes(dq.trim().toLowerCase()))
    .sort((a, b) => (data.workload.get(b.key) ?? 0) - (data.workload.get(a.key) ?? 0) || a.name.localeCompare(b.name)), [data.people, data.workload, dq]);

  async function exportReport() {
    const nm = (s: { personId: string; category: "TA" | "ADMIN" } | null) => { if (!s) return "—"; const p = data.people.get(personKey(s)); return `${p?.name ?? s.personId} (${t(`invCat.${s.category}`)})`; };
    const rows: string[][] = [];
    shown.forEach((e) => { const ev = data.evals.get(e.id), asg = data.byExam.get(e.id) ?? {}; (ev?.rooms ?? []).filter((r) => r.occupied).forEach((r) => {
      const sl = asg[r.roomId] ?? [null, null]; rows.push([courseName(e.courseId), e.date, rangeLabel(e.startMinutes, e.endMinutes), room(r.roomId), nm(sl[0] ?? null), nm(sl[1] ?? null), t(`inv.room.${r.status}`)]); }); });
    try {
      const branding = brandingFor(await getInstitution(), lang);
      printHtml(buildDocumentHtml({ lang, dir, branding, title: t("inv.reportTitle"), orientation: "landscape",
        meta: [`${t("timetable.year")}: ${year}`, `${t("timetable.semester")}: ${t(`semester.${semester}`)}`, t("inv.sumRooms", { n: totals.rooms }), t("inv.sumRequired", { n: totals.required }), t("inv.sumTA", { n: totals.ta }), t("inv.sumAdmin", { n: totals.admin }), t("inv.sumShortage", { n: totals.shortage })],
        columns: [t("import.course"), t("exam.date"), t("col.time"), t("col.room"), t("inv.first"), t("inv.second"), t("col.status")], rows,
        generated: t("pdf.generated", { date: new Date().toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB") }), pageLabel: t("pdf.page"), emptyText: t("inv.noExams") }));
      toast.success(t("export.opened"));
    } catch { toast.error(t("export.failed")); }
  }

  return (
    <>
      <PageHeader title={t("nav.invigilation")} description={t("inv.description")} action={<Button variant="secondary" onClick={() => void exportReport()} disabled={data.loading}>{t("inv.exportReport")}</Button>} />
      <div className={`${card} mb-4 flex flex-wrap items-end gap-x-4 gap-y-3`}>
        <label className={lbl}>{t("timetable.year")}<select className={sel} value={year} onChange={(e) => setYear(e.target.value)}>{ACADEMIC_YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className={lbl}>{t("timetable.semester")}<select className={sel} value={semester} onChange={(e) => setSemester(e.target.value as Semester)}>{SEMESTERS.map((s) => <option key={s} value={s}>{t(`semester.${s}`)}</option>)}</select></label>
        <label className={lbl}>{t("exam.type")}<select className={sel} value={type} onChange={(e) => setType(e.target.value as "" | ExamType)}><option value="">{t("dash.allTypes")}</option>{EXAM_TYPES.map((x) => <option key={x} value={x}>{t(`examType.${x}`)}</option>)}</select></label>
        <label className={lbl}>{t("exam.date")}<select className={sel} value={date} onChange={(e) => setDate(e.target.value)}><option value="">{t("inv.all")}</option>{dates.map((d) => <option key={d} value={d}>{fmt.format(new Date(`${d}T00:00:00`))}</option>)}</select></label>
        <label className={lbl}>{t("inv.filterStatus")}<select className={sel} value={status} onChange={(e) => setStatus(e.target.value as "" | Status)}><option value="">{t("inv.all")}</option>{(["staffed", "incomplete", "invalid"] as const).map((s) => <option key={s} value={s}>{t(`inv.status.${s}`)}</option>)}</select></label>
        <Button variant="secondary" onClick={() => { invalidate("data:"); data.reload(); }} disabled={data.loading}>{t("common.refresh")}</Button>
      </div>
      <div className="mb-4 flex gap-1" role="group" aria-label={t("nav.invigilation")}>
        <Button variant={tab === "overview" ? "primary" : "secondary"} aria-pressed={tab === "overview"} onClick={() => setTab("overview")}>{t("inv.tabOverview")}</Button>
        <Button variant={tab === "staff" ? "primary" : "secondary"} aria-pressed={tab === "staff"} onClick={() => setTab("staff")}>{t("inv.tabStaff")}</Button>
      </div>
      {data.error && <p role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {t("exam.loadFailed")}</p>}
      {data.loading ? <p className="text-sm text-slate-500" role="status">{t("common.loading")}</p> : tab === "overview" ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat n={totals.upcoming} label={t("inv.upcomingExams")} /><Stat n={totals.rooms} label={t("inv.occupiedRooms")} /><Stat n={totals.required} label={t("inv.required")} /><Stat n={totals.shortage} label={t("inv.shortage")} warn />
            <Stat n={totals.ta} label={t("inv.assignedTA")} /><Stat n={totals.admin} label={t("inv.assignedAdmin")} /><Stat n={totals.staffed} label={t("inv.staffedExams")} /><Stat n={totals.incomplete} label={t("inv.incompleteExams")} warn /></div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[52rem] text-sm"><thead className="bg-slate-100 dark:bg-slate-800"><tr><th className={th}>{t("inv.colExam")}</th><th className={th}>{t("exam.date")}</th><th className={th}>{t("col.time")}</th><th className={th}>{t("inv.occupiedRooms")}</th><th className={th}>{t("inv.required")}</th><th className={th}>{t("inv.totalAssigned")}</th><th className={th}>{t("inv.shortage")}</th><th className={th}>{t("col.status")}</th><th className={th}><span className="sr-only">{t("col.actions")}</span></th></tr></thead>
              <tbody>{shown.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-500">{t("inv.noExams")}</td></tr>}
                {shown.map((e) => { const v = data.evals.get(e.id), st = statusOf(e); return (
                  <tr key={e.id} className="border-t border-slate-200 dark:border-slate-700"><td className="px-3 py-2 font-medium" dir="auto">{courseName(e.courseId)} <span className="text-xs text-slate-500">({t(`examType.${e.examType}`)})</span></td>
                    <td className="px-3 py-2" dir="auto">{fmt.format(new Date(`${e.date}T00:00:00`))}</td><td className="px-3 py-2">{rangeLabel(e.startMinutes, e.endMinutes)}</td>
                    <td className="px-3 py-2" dir="ltr">{v?.occupied ?? 0}</td><td className="px-3 py-2" dir="ltr">{v?.required ?? 0}</td><td className="px-3 py-2" dir="ltr">{v?.validTotal ?? 0}</td><td className="px-3 py-2" dir="ltr">{v?.shortage ?? 0}</td>
                    <td className="px-3 py-2">{st === "staffed" ? "✓" : st === "invalid" ? "⛔" : "…"} {t(`inv.status.${st}`)}</td><td className="px-3 py-2"><Button variant="secondary" onClick={() => setManaging(e)}>{t("inv.manage")}</Button></td></tr>); })}</tbody></table>
          </div>
          <section className={card}><div className="mb-2 flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-base font-semibold">{t("inv.workload")}</h2><p className="text-xs text-slate-500">{t("inv.workloadHint")}</p></div>
            <input type="search" className={`${sel} w-56`} placeholder={t("common.search")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <div className="max-h-80 overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-100 dark:bg-slate-800"><tr><th className={th}>{t("inv.person")}</th><th className={th}>{t("inv.category")}</th><th className={th}>{t("inv.assignments")}</th></tr></thead>
              <tbody>{people.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-500">{t("inv.noPeople")}</td></tr>}
                {people.map((p) => <tr key={p.key} className="border-t border-slate-200 dark:border-slate-700"><td className="px-3 py-1.5" dir="auto">{p.name}{!p.active && <span className="ms-1 text-xs text-slate-500">({t("inv.inactive")})</span>}</td><td className="px-3 py-1.5">{t(`invCat.${p.category}`)}</td><td className="px-3 py-1.5" dir="ltr">{data.workload.get(p.key) ?? 0}</td></tr>)}</tbody></table></div></section>
        </div>
      ) : <StaffPanel data={data} />}
      <Modal wide open={managing !== null} title={managing ? t("inv.manageTitle", { course: courseName(managing.courseId) }) : ""} onClose={() => setManaging(null)}>
        {managing && <ExamStaffing exam={managing} data={data} onCancel={() => setManaging(null)} onSaved={() => { setManaging(null); invalidate("data:invig"); data.reload(); }} />}
      </Modal>
    </>
  );
}

function StaffPanel({ data }: { data: InvigData }) {
  const { t } = useI18n();
  const toast = useToast();
  const { isSuper } = useAuth();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"" | "active" | "inactive">("");
  const [editing, setEditing] = useState<AdminStaff | "new" | null>(null);
  const dq = useDebounced(q, 250);
  const rows = useMemo(() => data.staff.filter((s) => (!filter || (filter === "active") === s.isActive) && (!dq.trim() || s.fullName.toLowerCase().includes(dq.trim().toLowerCase()))), [data.staff, filter, dq]);
  const toggle = async (s: AdminStaff) => { try { await updateAdminStaff(s.id, { fullName: s.fullName, notes: s.notes ?? "", isActive: !s.isActive }); data.reload(); } catch { toast.error(t("faculty.failed")); } };
  const input = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input type="search" className={`${input} w-64`} placeholder={t("common.search")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={input} aria-label={t("col.status")} value={filter} onChange={(e) => setFilter(e.target.value as "" | "active" | "inactive")}><option value="">{t("inv.all")}</option><option value="active">{t("users.active")}</option><option value="inactive">{t("users.disabled")}</option></select>
        {isSuper && <Button className="ms-auto" onClick={() => setEditing("new")}>+ {t("staff.add")}</Button>}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[34rem] text-sm"><thead className="bg-slate-100 dark:bg-slate-800"><tr><th className={th}>{t("col.name")}</th><th className={th}>{t("col.status")}</th><th className={th}>{t("inv.assignments")}</th><th className={th}>{t("col.notes")}</th><th className={th}><span className="sr-only">{t("col.actions")}</span></th></tr></thead>
          <tbody>{rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">{t("staff.empty")}</td></tr>}
            {rows.map((s) => <tr key={s.id} className="border-t border-slate-200 dark:border-slate-700"><td className="px-3 py-2 font-medium" dir="auto">{s.fullName}</td><td className="px-3 py-2">{s.isActive ? `✓ ${t("users.active")}` : `⛔ ${t("users.disabled")}`}</td>
              <td className="px-3 py-2" dir="ltr">{data.workload.get(`ADMIN:${s.id}`) ?? 0}</td><td className="px-3 py-2" dir="auto">{s.notes || "—"}</td>
              <td className="px-3 py-2">{isSuper && <div className="flex gap-1"><Button variant="secondary" onClick={() => setEditing(s)}>{t("common.edit")}</Button><Button variant="secondary" onClick={() => void toggle(s)}>{s.isActive ? t("staff.deactivate") : t("staff.activate")}</Button></div>}</td></tr>)}</tbody></table>
      </div>
      <Modal open={editing !== null} title={editing === "new" ? t("staff.add") : t("staff.edit")} onClose={() => setEditing(null)}>
        {editing !== null && <StaffForm initial={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); data.reload(); }} />}
      </Modal>
    </>
  );
}

function StaffForm({ initial, onSaved, onCancel }: { initial: AdminStaff | null; onSaved: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(initial?.fullName ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [active, setActive] = useState(initial?.isActive ?? true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) { setErr(t("form.nameRequired")); return; }
    setBusy(true); setErr("");
    try { if (initial) await updateAdminStaff(initial.id, { fullName: name, notes, isActive: active }); else await createAdminStaff(name, notes, active); toast.success(t("staff.saved")); onSaved(); }
    catch (ex) { setErr(t(ex instanceof Error && ex.message.startsWith("error.") ? ex.message : "faculty.failed")); } finally { setBusy(false); }
  }
  const field = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3">
      <label className="text-sm font-medium">{t("form.fullName")}<input className={field} value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label className="text-sm font-medium">{t("form.notes")}<textarea className={field} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("users.active")}</label>
      {err && <p role="alert" className="text-sm text-red-600">⚠ {err}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button><Button type="submit" disabled={busy}>{busy ? t("form.saving") : t("common.save")}</Button></div>
    </form>
  );
}

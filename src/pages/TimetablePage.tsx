import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { ACADEMIC_YEARS, DAYS, DEFAULT_TIME_SLOTS, LEVELS, SEMESTERS, SESSION_META, SESSION_TYPES, type Day, type Level, type Semester, type TimeSlot } from "../domain/constants";
import { rangeLabel, slotIndexFor } from "../domain/time";
import { instructorName, roomLabel, sectionsLabel } from "../features/timetable/labels";
import { brandingFor, buildDocumentHtml } from "../features/exams/examPdf";
import { buildTimetableHtml, printHtml, TYPE_COLORS, type PdfCell } from "../features/timetable/exportPdf";
import { SessionForm } from "../features/timetable/SessionForm";
import { SessionList } from "../features/timetable/SessionList";
import { TimetableGrid } from "../features/timetable/TimetableGrid";
import { useRefData } from "../features/timetable/useRefData";
import { useI18n } from "../i18n";
import { getInstitution } from "../repositories/settingsRepo";
import { subscribeEntries } from "../repositories/timetableRepo";
import { deleteTimetableEntry } from "../services/offline/critical";
import type { TimetableDraft, TimetableEntry } from "../types";

const sel = "mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const lbl = "text-xs font-medium text-slate-500 dark:text-slate-400";

export function TimetablePage() {
  const toast = useToast();
  const { t, tc, lang, dir } = useI18n();
  const refs = useRefData();
  const [year, setYear] = useState<string>("2026-2027");
  const [semester, setSemester] = useState<Semester>("Fall");
  const [level, setLevel] = useState<Level>(1);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<{ initial: TimetableDraft; editingId?: string; baseUpdatedAt?: number | null } | null>(null);
  const [detail, setDetail] = useState<TimetableEntry | null>(null);
  const [toDelete, setToDelete] = useState<TimetableEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setLoading(true); setError("");
    return subscribeEntries(year, semester, (e) => { setEntries(e); setLoading(false); },
      () => { setError("timetable.loadFailed"); setLoading(false); });
  }, [year, semester]);

  const levelEntries = useMemo(() => entries.filter((e) => e.level === level), [entries, level]);

  const blank = (day: Day = "Sunday", slot: TimeSlot = DEFAULT_TIME_SLOTS[0] ?? { id: "p1", label: "", start: 600, end: 675 }): TimetableDraft => ({
    academicYear: year, semester, level, day, startMinutes: slot.start, endMinutes: slot.end, courseName: "",
    instructorId: null, classroomId: null, sessionType: "lecture", sectionIds: [], notes: "",
  });
  const draftOf = (e: TimetableEntry): TimetableDraft => ({
    academicYear: e.academicYear, semester: e.semester, level: e.level, day: e.day, startMinutes: e.startMinutes, endMinutes: e.endMinutes,
    courseName: e.courseName, instructorId: e.instructorId, classroomId: e.classroomId, sessionType: e.sessionType, sectionIds: e.sectionIds, notes: e.notes,
  });

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try { const r = await deleteTimetableEntry(toDelete.id, toDelete.courseName, toDelete.updatedAt?.getTime() ?? null); toast.success(t(r === "queued" ? "sync.savedOffline" : "timetable.deleted")); setToDelete(null); }
    catch { toast.error(t("timetable.deleteFailed")); }
    finally { setDeleting(false); }
  }

  // Exports the SAVED data (levelEntries comes from Firestore, never from the open form).
  async function exportPdf() {
    const cell = (e: TimetableEntry): PdfCell => ({ type: e.sessionType, badge: t(`badge.${e.sessionType}`), time: rangeLabel(e.startMinutes, e.endMinutes), course: tc(e.courseName),
      instructor: instructorName(refs, e.instructorId), room: roomLabel(refs, e.classroomId), sections: sectionsLabel(refs, e.sectionIds, t) });
    const rows = DAYS.map((day) => ({ dayLabel: t(`day.${day}`), cells: DEFAULT_TIME_SLOTS.map((_, i) =>
      levelEntries.filter((e) => e.day === day && slotIndexFor(DEFAULT_TIME_SLOTS, e.startMinutes) === i).sort((a, b) => a.startMinutes - b.startMinutes).map(cell)) }));
    try {
      printHtml(buildTimetableHtml({ branding: brandingFor(await getInstitution(), lang), pageLabel: t("pdf.page"), lang, dir, title: `${t("timetable.title")} — ${t("level", { n: level })} — ${t(`semester.${semester}`)} ${year}`,
        meta: [`${t("timetable.year")}: ${year}`, `${t("timetable.semester")}: ${t(`semester.${semester}`)}`, `${t("timetable.level")}: ${t("level", { n: level })}`],
        dayHeader: t("grid.day"), slots: DEFAULT_TIME_SLOTS.map((s) => ({ label: t(`slot.${s.id}`), time: rangeLabel(s.start, s.end) })), rows,
        legend: SESSION_TYPES.map((s) => ({ type: s, badge: t(`badge.${s}`), label: t(`session.${s}`) })), footer: t("pdf.generated", { date: new Date().toLocaleDateString(lang) }) }));
      toast.success(t("export.opened"));
    } catch { toast.error(t("export.failed")); }
  }

  // Flat list of the same saved sessions (Day, time, course, instructor, room, type, sections) in the same official template.
  async function exportList() {
    const order = (d: string) => DAYS.indexOf(d as Day);
    const list = [...levelEntries].sort((a, b) => order(a.day) - order(b.day) || a.startMinutes - b.startMinutes);
    try {
      printHtml(buildDocumentHtml({ lang, dir, branding: brandingFor(await getInstitution(), lang), title: `${t("timetable.title")} — ${t("level", { n: level })} — ${t(`semester.${semester}`)} ${year}`,
        meta: [`${t("timetable.year")}: ${year}`, `${t("timetable.semester")}: ${t(`semester.${semester}`)}`, `${t("timetable.level")}: ${t("level", { n: level })}`],
        columns: [t("grid.day"), t("col.time"), t("col.course"), t("col.instructor"), t("col.room"), t("col.type"), t("col.sections")],
        rows: list.map((e) => [t(`day.${e.day}`), rangeLabel(e.startMinutes, e.endMinutes), tc(e.courseName), instructorName(refs, e.instructorId), roomLabel(refs, e.classroomId), `${t(`badge.${e.sessionType}`)} · ${t(`session.${e.sessionType}`)}`, sectionsLabel(refs, e.sectionIds, t)]),
        rowColors: list.map((e) => TYPE_COLORS[e.sessionType].bg), generated: t("pdf.generated", { date: new Date().toLocaleDateString(lang) }), pageLabel: t("pdf.page"), emptyText: t("list.empty"), orientation: "landscape" }));
      toast.success(t("export.opened"));
    } catch { toast.error(t("export.failed")); }
  }

  const card = "rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";
  return (
    <>
      <PageHeader title={t("timetable.title")} description={t("timetable.description")}
        action={<div className="flex gap-2"><Button variant="secondary" onClick={() => void exportPdf()} disabled={loading || refs.loading}>{t("export.button")}</Button><Button variant="secondary" onClick={() => void exportList()} disabled={loading || refs.loading}>{t("export.listButton")}</Button><Button onClick={() => setForm({ initial: blank() })}>+ {t("timetable.addSession")}</Button></div>} />
      {(refs.error || error) && <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"><span aria-hidden="true">⚠ </span>{refs.error ? t("refs.loadFailed") : t(error)}</p>}

      <div className={`${card} mb-4 flex flex-wrap items-end gap-x-5 gap-y-3 p-4`}>
        <label className={lbl}>{t("timetable.year")}
          <select className={sel} value={year} onChange={(e) => setYear(e.target.value)}>{ACADEMIC_YEARS.map((y) => <option key={y}>{y}</option>)}</select>
        </label>
        <label className={lbl}>{t("timetable.semester")}
          <select className={sel} value={semester} onChange={(e) => setSemester(e.target.value as Semester)}>{SEMESTERS.map((s) => <option key={s} value={s}>{t(`semester.${s}`)}</option>)}</select>
        </label>
        <div role="group" aria-label={t("timetable.level")}>
          <div className={lbl}>{t("timetable.level")}</div>
          <div className="mt-1 flex gap-1">{LEVELS.map((l) => <Button key={l} variant={l === level ? "primary" : "secondary"} aria-pressed={l === level} onClick={() => setLevel(l)}>{t("level", { n: l })}</Button>)}</div>
        </div>
        <div role="group" aria-label={t("timetable.view")} className="ms-auto">
          <div className={lbl}>{t("timetable.view")}</div>
          <div className="mt-1 flex gap-1">
            <Button variant={view === "grid" ? "primary" : "secondary"} aria-pressed={view === "grid"} onClick={() => setView("grid")}>{t("timetable.grid")}</Button>
            <Button variant={view === "list" ? "primary" : "secondary"} aria-pressed={view === "list"} onClick={() => setView("list")}>{t("timetable.list")}</Button>
          </div>
        </div>
      </div>

      <ul className="mb-4 flex flex-wrap items-center gap-2 text-xs" aria-label={t("timetable.legend")}>
        {SESSION_TYPES.map((s) => (
          <li key={s} className={`${SESSION_META[s].color} ${SESSION_META[s].accent} rounded-md border border-s-4 border-black/10 px-2 py-1 text-slate-900`}>
            <b>{t(`badge.${s}`)}</b> · {t(`session.${s}`)}
          </li>
        ))}
      </ul>

      {loading || refs.loading ? <p className="text-sm text-slate-500" role="status">{t("timetable.loading")}</p> : view === "grid"
        ? <>
            {levelEntries.length === 0 && <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{t("timetable.empty", { level: t("level", { n: level }) })}</p>}
            <TimetableGrid days={DAYS} slots={DEFAULT_TIME_SLOTS} entries={levelEntries} refs={refs}
              onAdd={(day, slot) => setForm({ initial: blank(day, slot) })} onOpen={setDetail} />
          </>
        : <SessionList entries={levelEntries} refs={refs} onOpen={setDetail} />}

      <Modal open={form !== null} title={form?.editingId ? t("form.editTitle") : t("form.addTitle")} onClose={() => setForm(null)}>
        {form && <SessionForm initial={form.initial} editingId={form.editingId} baseUpdatedAt={form.baseUpdatedAt} refs={refs} entries={entries}
          onDone={() => setForm(null)} onCancel={() => setForm(null)} />}
      </Modal>

      <Modal open={detail !== null} title={t("detail.title")} onClose={() => setDetail(null)}>
        {detail && (
          <div className="text-sm">
            <p className={`${SESSION_META[detail.sessionType].color} ${SESSION_META[detail.sessionType].accent} mb-3 inline-block rounded-md border border-s-4 border-black/10 px-2 py-1 text-slate-900`}>
              <b>{t(`badge.${detail.sessionType}`)}</b> · {t(`session.${detail.sessionType}`)}
            </p>
            <h3 className="text-base font-semibold">{tc(detail.courseName)}</h3>
            <dl className="mt-2 grid grid-cols-[9rem_1fr] gap-y-1.5">
              <dt className="text-slate-500">{t("timetable.level")}</dt><dd>{t("level", { n: detail.level })}</dd>
              <dt className="text-slate-500">{t("detail.when")}</dt><dd>{t(`day.${detail.day}`)}, {rangeLabel(detail.startMinutes, detail.endMinutes)}</dd>
              <dt className="text-slate-500">{t("detail.yearSemester")}</dt><dd>{detail.academicYear} · {t(`semester.${detail.semester}`)}</dd>
              <dt className="text-slate-500">{t("col.instructor")}</dt><dd>{instructorName(refs, detail.instructorId) || "—"}</dd>
              <dt className="text-slate-500">{t("col.room")}</dt><dd>{roomLabel(refs, detail.classroomId) || "—"}</dd>
              <dt className="text-slate-500">{t("col.sections")}</dt><dd>{sectionsLabel(refs, detail.sectionIds, t)}</dd>
              <dt className="text-slate-500">{t("detail.notes")}</dt><dd>{detail.notes || "—"}</dd>
            </dl>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setDetail(null)}>{t("common.close")}</Button>
              <Button variant="secondary" onClick={() => { setForm({ initial: draftOf(detail) }); setDetail(null); }}>{t("common.duplicate")}</Button>
              <Button variant="secondary" onClick={() => { setForm({ initial: draftOf(detail), editingId: detail.id, baseUpdatedAt: detail.updatedAt?.getTime() ?? null }); setDetail(null); }}>{t("common.edit")}</Button>
              <Button variant="danger" onClick={() => { setToDelete(detail); setDetail(null); }}>{t("common.delete")}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={toDelete !== null} title={t("timetable.deleteTitle")} busy={deleting}
        message={t("timetable.deleteMessage", { name: toDelete ? tc(toDelete.courseName) : "" })} onConfirm={() => void confirmDelete()} onCancel={() => setToDelete(null)} />
    </>
  );
}

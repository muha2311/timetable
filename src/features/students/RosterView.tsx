import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { Pagination } from "../../components/ui/Pagination";
import { useToast } from "../../components/ui/Toast";
import { ACADEMIC_YEARS, ENROLLMENT_STATUSES, LEVELS, type Level } from "../../domain/constants";
import { filterStudents, NO_SECTION, paginate } from "../../domain/studentsView";
import { useDebounced } from "../../hooks/useDebounced";
import { useI18n } from "../../i18n";
import { listStudentsByYear, updateStudent } from "../../repositories/studentsRepo";
import type { Student } from "../../types";
import type { RefData } from "../timetable/useRefData";
import { StudentTable, type StudentRow } from "./StudentTable";

export type LevelKey = Level | "none";
const sel = "mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const lbl = "text-xs font-medium text-slate-500 dark:text-slate-400";
const PAGE = 50;

/** One query per academic year; every roster/overview is derived from these unique student records (never from enrollments). */
export function useYearStudents(year: string) {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  const force = useRef(false);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(false);
    listStudentsByYear(year, force.current).then((r) => { if (alive) setStudents(r); }).catch(() => { if (alive) setError(true); }).finally(() => { force.current = false; if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year, tick]);
  const reload = useCallback(() => { force.current = true; setTick((x) => x + 1); }, []);
  return { students, loading, error, reload };
}

function EditForm({ student, refs, onSaved, onCancel }: { student: Student; refs: RefData; onSaved: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [level, setLevel] = useState<Level | "">(student.level ?? "");
  const [section, setSection] = useState(student.sectionId ?? "");
  const [busy, setBusy] = useState(false);
  const sections = useMemo(() => refs.sections.filter((s) => s.level === level).sort((a, b) => Number(a.name) - Number(b.name)), [refs.sections, level]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await updateStudent(student, { level: level === "" ? null : level, sectionId: level === "" ? null : section || null }); toast.success(t("roster.saved")); onSaved(); }
    catch (ex) { toast.error(t(ex instanceof Error && ex.message.startsWith("error.") ? ex.message : "roster.saveFailed")); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3">
      <p className="text-sm"><b dir="ltr">{student.academicId}</b> — {student.fullName}</p>
      <label className="text-sm font-medium">{t("timetable.level")}
        <select className={`${sel} w-full`} value={level} onChange={(e) => { setLevel(e.target.value === "" ? "" : (Number(e.target.value) as Level)); setSection(""); }}>
          <option value="">{t("students.unassigned")}</option>{LEVELS.map((l) => <option key={l} value={l}>{t("level", { n: l })}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">{t("col.section")}
        <select className={`${sel} w-full`} value={section} disabled={level === ""} onChange={(e) => setSection(e.target.value)}>
          <option value="">{t("roster.noSection")}</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <p className="text-xs text-slate-500">{t("roster.manualNote")}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
        <Button type="submit" disabled={busy}>{busy ? t("form.saving") : t("common.save")}</Button>
      </div>
    </form>
  );
}

export function RosterPanel({ students, levelKey, refs, onChanged }: { students: Student[]; levelKey: LevelKey; refs: RefData; onChanged: () => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [section, setSection] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"id" | "name">("id");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Student | null>(null);
  const dq = useDebounced(q, 250);
  const sectionName = useMemo(() => new Map(refs.sections.map((s) => [s.id, s.name])), [refs.sections]);
  const inLevel = useMemo(() => students.filter((s) => (levelKey === "none" ? s.level == null : s.level === levelKey)), [students, levelKey]);
  const filtered = useMemo(() => {
    const r = filterStudents(inLevel, dq, section).filter((s) => !status || s.status === status);
    return r.sort(sort === "id" ? (a, b) => a.academicId.localeCompare(b.academicId, undefined, { numeric: true }) : (a, b) => a.fullName.localeCompare(b.fullName));
  }, [inLevel, dq, section, status, sort]);
  useEffect(() => { setPage(1); }, [dq, section, status, sort, levelKey]);
  const pg = useMemo(() => paginate(filtered, page, PAGE), [filtered, page]);
  const rows = useMemo<StudentRow[]>(() => pg.items.map((s) => ({ id: s.id, student: s })), [pg.items]);
  const levelSections = useMemo(() => (levelKey === "none" ? [] : refs.sections.filter((s) => s.level === levelKey).sort((a, b) => Number(a.name) - Number(b.name))), [refs.sections, levelKey]);
  const edit = useCallback((s: Student) => setEditing(s), []);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <label className={lbl}>{t("common.search")}<input type="search" className={`${sel} w-64`} placeholder={t("students.search")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className={lbl}>{t("col.section")}<select className={sel} value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="">{t("students.allSections")}</option><option value={NO_SECTION}>{t("students.noSection")}</option>{levelSections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className={lbl}>{t("col.status")}<select className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("roster.allStatuses")}</option>{ENROLLMENT_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}</select></label>
        <label className={lbl}>{t("roster.sortBy")}<select className={sel} value={sort} onChange={(e) => setSort(e.target.value as "id" | "name")}>
          <option value="id">{t("col.studentId")}</option><option value="name">{t("col.studentName")}</option></select></label>
      </div>
      <p className="mb-2 text-sm font-medium" dir="auto">{t("students.total", { n: inLevel.length })}{filtered.length !== inLevel.length && ` · ${t("students.filtered", { n: filtered.length })}`}</p>
      <StudentTable rows={rows} sectionName={sectionName} onEdit={edit} />
      <Pagination {...pg} total={filtered.length} onPage={setPage} />
      <Modal open={editing !== null} title={t("roster.editTitle")} onClose={() => setEditing(null)}>
        {editing && <EditForm student={editing} refs={refs} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
      </Modal>
    </>
  );
}

/** "By level" tab of the Students page. */
export function YearLevelRoster({ refs }: { refs: RefData }) {
  const { t } = useI18n();
  const [year, setYear] = useState<string>("2026-2027");
  const [level, setLevel] = useState<LevelKey>(1);
  const { students, loading, error, reload } = useYearStudents(year);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <label className={lbl}>{t("timetable.year")}<select className={sel} value={year} onChange={(e) => setYear(e.target.value)}>{ACADEMIC_YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className={lbl}>{t("timetable.level")}<select className={sel} value={level} onChange={(e) => setLevel(e.target.value === "none" ? "none" : (Number(e.target.value) as Level))}>
          {LEVELS.map((l) => <option key={l} value={l}>{t("level", { n: l })}</option>)}<option value="none">{t("levels.unassigned")}</option></select></label>
        <Button variant="secondary" onClick={reload} disabled={loading}>{t("common.refresh")}</Button>
      </div>
      {error && <p role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {t("students.loadFailed")}</p>}
      {loading ? <p className="text-sm text-slate-500" role="status">{t("common.loading")}</p> : <RosterPanel students={students} levelKey={level} refs={refs} onChanged={reload} />}
    </>
  );
}

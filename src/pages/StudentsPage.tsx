import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { ACADEMIC_YEARS, LEVELS, SEMESTERS, type Level, type Semester } from "../domain/constants";
import { paginate } from "../domain/studentsView";
import { YearLevelRoster } from "../features/students/RosterView";
import { StudentTable, type StudentRow } from "../features/students/StudentTable";
import { useRefData, type RefData } from "../features/timetable/useRefData";
import { useDebounced } from "../hooks/useDebounced";
import { useI18n } from "../i18n";
import { listCourseRoster, type RosterRow } from "../repositories/enrollmentsRepo";

const PAGE = 50;
const sel = "mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const lbl = "text-xs font-medium text-slate-500 dark:text-slate-400";
const bar = "mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const useSectionNames = (refs: RefData) => useMemo(() => new Map(refs.sections.map((s) => [s.id, s.name])), [refs.sections]);

function CourseView({ refs }: { refs: RefData }) {
  const { t, tc } = useI18n();
  const [year, setYear] = useState<string>("2026-2027");
  const [semester, setSemester] = useState<Semester>("Fall");
  const [level, setLevel] = useState<Level>(1);
  const [courseId, setCourseId] = useState("");
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const force = useRef(false);
  const dq = useDebounced(q, 250);
  const sectionName = useSectionNames(refs);
  const courses = useMemo(() => refs.courses.filter((c) => c.level === level && c.semester === semester).sort((a, b) => a.name.localeCompare(b.name)), [refs.courses, level, semester]);

  useEffect(() => {
    if (!courseId) { setRoster([]); return; }
    let alive = true;
    setLoading(true); setError(false);
    listCourseRoster(year, courseId, force.current).then((r) => { if (alive) setRoster(r); }).catch(() => { if (alive) setError(true); }).finally(() => { force.current = false; if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year, courseId, tick]);
  useEffect(() => { setPage(1); }, [dq, courseId, year]);

  const filtered = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return s ? roster.filter((r) => r.studentId.toLowerCase().includes(s) || (r.student?.academicId ?? "").toLowerCase().includes(s) || (r.student?.fullName ?? "").toLowerCase().includes(s)) : roster;
  }, [roster, dq]);
  const pg = useMemo(() => paginate(filtered, page, PAGE), [filtered, page]);
  const tableRows = useMemo<StudentRow[]>(() => pg.items.map((r) => ({ id: r.studentId, student: r.student, enrollment: `${t(`semester.${r.enrollment.semester}`)} ${r.enrollment.academicYear}` })), [pg.items, t]);
  return (
    <>
      <div className={bar}>
        <label className={lbl}>{t("timetable.year")}<select className={sel} value={year} onChange={(e) => setYear(e.target.value)}>{ACADEMIC_YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className={lbl}>{t("timetable.level")}<select className={sel} value={level} onChange={(e) => { setLevel(Number(e.target.value) as Level); setCourseId(""); }}>{LEVELS.map((l) => <option key={l} value={l}>{t("level", { n: l })}</option>)}</select></label>
        <label className={lbl}>{t("timetable.semester")}<select className={sel} value={semester} onChange={(e) => { setSemester(e.target.value as Semester); setCourseId(""); }}>{SEMESTERS.map((s) => <option key={s} value={s}>{t(`semester.${s}`)}</option>)}</select></label>
        <label className={lbl}>{t("import.course")}<select className={sel} value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">{t("import.select")}</option>{courses.map((c) => <option key={c.id} value={c.id}>{tc(c.name)}</option>)}</select></label>
        <label className={lbl}>{t("common.search")}<input type="search" className={`${sel} w-56`} placeholder={t("students.search")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <Button variant="secondary" onClick={() => { force.current = true; setTick((x) => x + 1); }} disabled={!courseId || loading}>{t("common.refresh")}</Button>
      </div>
      {error && <p role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {t("students.loadFailed")}</p>}
      {!courseId ? <p className="text-sm text-slate-500">{t("students.selectCourse")}</p> : loading ? <p className="text-sm text-slate-500" role="status">{t("common.loading")}</p> : (
        <>
          <p className="mb-2 text-sm font-medium" dir="auto">{t("students.enrolledTotal", { n: roster.length })}{filtered.length !== roster.length && ` · ${t("students.filtered", { n: filtered.length })}`}</p>
          <StudentTable rows={tableRows} sectionName={sectionName} showEnrollment />
          <Pagination {...pg} total={filtered.length} onPage={setPage} />
        </>
      )}
    </>
  );
}

export function StudentsPage() {
  const { t } = useI18n();
  const refs = useRefData();
  const [tab, setTab] = useState<"level" | "course">("level");
  return (
    <>
      <PageHeader title={t("nav.students")} description={t("students.description")} />
      <div className="mb-4 flex gap-1" role="group" aria-label={t("nav.students")}>
        <Button variant={tab === "level" ? "primary" : "secondary"} aria-pressed={tab === "level"} onClick={() => setTab("level")}>{t("students.tabLevel")}</Button>
        <Button variant={tab === "course" ? "primary" : "secondary"} aria-pressed={tab === "course"} onClick={() => setTab("course")}>{t("students.tabCourse")}</Button>
      </div>
      {tab === "level" ? <YearLevelRoster refs={refs} /> : <CourseView refs={refs} />}
    </>
  );
}

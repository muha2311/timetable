import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BarList } from "../components/ui/BarList";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { ACADEMIC_YEARS, EXAM_TYPES, LEVELS, SEMESTERS, type Semester } from "../domain/constants";
import { enrollmentOverview, examOverview, nextSessions, roomUtilization, sessionsByDay, topInstructors } from "../domain/dashboard";
import { rangeLabel } from "../domain/time";
import { useRefData } from "../features/timetable/useRefData";
import { useI18n } from "../i18n";
import { useSyncStatus } from "../services/offline/sync";
import { listActivity, type Activity } from "../repositories/activityRepo";
import { loadDashboard, type DashboardData } from "../repositories/dashboardRepo";

const sel = "mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const lbl = "text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";

const Stat = ({ n, label, to, tone }: { n: number; label: string; to?: string; tone?: "warn" }) => {
  const body = <><div className="text-3xl font-semibold tabular-nums" dir="ltr">{n}</div><div className="text-xs text-slate-600 dark:text-slate-400">{label}</div></>;
  const cls = `${card} block ${tone === "warn" && n > 0 ? "border-amber-400" : ""}`;
  return to ? <Link to={to} className={`${cls} transition hover:shadow-md`}>{body}</Link> : <div className={cls}>{body}</div>;
};
const Section = ({ title, children, links }: { title: string; children: ReactNode; links?: { to: string; label: string }[] }) => (
  <section className={card}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2>
    <div className="flex gap-2">{links?.map((l) => <Link key={l.to} to={l.to} className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">{l.label} →</Link>)}</div></div>{children}</section>
);

export function DashboardPage() {
  const { t, tc, lang } = useI18n();
  const refs = useRefData();
  const { online } = useSyncStatus();
  const [year, setYear] = useState<string>("2026-2027");
  const [semester, setSemester] = useState<Semester>("Fall");
  const [examType, setExamType] = useState<"" | "midterm" | "final">("");
  const [data, setData] = useState<DashboardData | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (refs.loading) return;
    let alive = true;
    setLoading(true); setError(false);
    const force = tick > 0;
    Promise.all([loadDashboard(year, semester, refs.courses, refs.sections, force), listActivity(force).catch(() => [] as Activity[])])
      .then(([d, a]) => { if (alive) { setData(d); setActivity(a); } }).catch(() => { if (alive) setError(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [year, semester, tick, refs.loading, refs.courses, refs.sections]);
  const refresh = useCallback(() => { void refs.reload(); setTick((x) => x + 1); }, [refs]);

  const today = new Date().toISOString().slice(0, 10);
  const fmt = useMemo(() => new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short" }), [lang]);
  const dt = useMemo(() => new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" }), [lang]);
  const courseName = (id: string) => tc(refs.courses.find((c) => c.id === id)?.name ?? id);
  const instructor = (id: string) => refs.faculty.find((f) => f.id === id)?.fullName ?? id;
  const roomName = (id: string) => { const c = refs.classrooms.find((x) => x.id === id); return c ? (c.building ? `${c.name} (${c.building})` : c.name) : id; };

  const calc = useMemo(() => {
    if (!data) return null;
    const semCourses = refs.courses.filter((c) => c.semester === semester);
    const total = LEVELS.reduce((a, l) => a + (data.levelCounts[l] ?? 0), 0) + data.unassigned;
    const sectioned = refs.sections.reduce((a, s) => a + (data.sectionCounts[s.id] ?? 0), 0);
    const enr = enrollmentOverview(semCourses, data.enrollCounts);
    const exams = examOverview(data.exams, (id) => refs.courses.find((c) => c.id === id)?.level, (id) => refs.classrooms.find((c) => c.id === id)?.capacity, today, examType);
    return { semCourses, total, sectioned, enr, exams, days: sessionsByDay(data.entries), top: topInstructors(data.entries), rooms: roomUtilization(data.entries), next: nextSessions(data.entries, new Date()) };
  }, [data, refs.courses, refs.sections, refs.classrooms, semester, examType, today]);

  const L = (l: number) => t("level", { n: l });
  const actLine = (a: Activity) => t("activity.line", { actor: a.actorEmail || "—", action: t(`activity.${a.type}.${a.action}`), target: a.type === "exam" ? courseName(a.target) : a.target });
  return (
    <>
      <PageHeader title={t("nav.dashboard")} description={t("dash.description")} />
      <div className={`${card} mb-4 flex flex-wrap items-end gap-x-4 gap-y-3`}>
        <label className={lbl}>{t("timetable.year")}<select className={sel} value={year} onChange={(e) => setYear(e.target.value)}>{ACADEMIC_YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className={lbl}>{t("timetable.semester")}<select className={sel} value={semester} onChange={(e) => setSemester(e.target.value as Semester)}>{SEMESTERS.map((s) => <option key={s} value={s}>{t(`semester.${s}`)}</option>)}</select></label>
        <label className={lbl}>{t("exam.type")}<select className={sel} value={examType} onChange={(e) => setExamType(e.target.value as "" | "midterm" | "final")}><option value="">{t("dash.allTypes")}</option>{EXAM_TYPES.map((x) => <option key={x} value={x}>{t(`examType.${x}`)}</option>)}</select></label>
        <Button variant="secondary" onClick={refresh} disabled={loading}>{t("common.refresh")}</Button>
      </div>
      {error && <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {online ? t("dash.loadFailed") : t("sync.needsConnection")}</p>}
      {(loading || refs.loading) && !calc ? <p className="text-sm text-slate-500" role="status">{t("common.loading")}</p> : calc && data && (
        <div className="grid gap-4" aria-busy={loading}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat n={calc.total} label={t("dash.totalStudents")} to="/students" />
            {LEVELS.map((l) => <Stat key={l} n={data.levelCounts[l] ?? 0} label={t("dash.studentsInLevel", { level: L(l) })} to="/levels" />)}
            <Stat n={refs.courses.length} label={t("dash.totalCourses")} /><Stat n={refs.faculty.length} label={t("dash.totalFaculty")} to="/faculty" /><Stat n={refs.classrooms.length} label={t("dash.totalClassrooms")} to="/classrooms" />
            <Stat n={data.entries.length} label={t("dash.totalSessions")} to="/timetable" /><Stat n={data.exams.length} label={t("dash.totalExams")} to="/exam-schedule" />
          </div>
          {data.unassigned > 0 && <p role="alert" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">⚠ {t("dash.unassignedWarn", { n: data.unassigned })} <Link className="underline" to="/levels">{t("nav.levels")}</Link></p>}

          <Section title={t("dash.academic")} links={[{ to: "/students", label: t("nav.students") }, { to: "/levels", label: t("nav.levels") }]}>
            <div className="grid gap-6 lg:grid-cols-2">
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.byLevel")}</h3><BarList emptyText={t("dash.noData")} items={[...LEVELS.map((l) => ({ label: L(l), value: data.levelCounts[l] ?? 0 })), { label: t("levels.unassigned"), value: data.unassigned }]} /></div>
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.coursesByLevel")}</h3><BarList emptyText={t("dash.noData")} items={LEVELS.map((l) => ({ label: L(l), value: refs.courses.filter((c) => c.level === l).length }))} /></div>
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.bySection")}</h3><div className="max-h-72 overflow-auto pe-2"><BarList emptyText={t("dash.noData")} items={[...refs.sections].sort((a, b) => a.level - b.level || Number(a.name) - Number(b.name)).map((s) => ({ label: `${L(s.level)} · ${s.name}`, value: data.sectionCounts[s.id] ?? 0 }))} /></div>
                <p className="mt-1 text-xs text-slate-500">{t("dash.noSectionN", { n: calc.total - calc.sectioned })}</p></div>
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.enrollments")}</h3>
                <dl className="mb-2 grid grid-cols-[1fr_auto] gap-y-1 text-sm"><dt>{t("dash.totalEnrollments")}</dt><dd dir="ltr">{calc.enr.total}</dd><dt>{t("dash.coursesWith")}</dt><dd dir="ltr">{calc.enr.withEnrollments.length}</dd><dt>{t("dash.coursesWithout")}</dt><dd dir="ltr">{calc.enr.without.length}</dd></dl>
                {calc.semCourses.length === 0 ? <p className="text-sm text-slate-500">{t("dash.noCoursesSemester")}</p> : <BarList emptyText={t("dash.noEnrollments")} items={calc.semCourses.map((c) => ({ label: tc(c.name), value: data.enrollCounts[c.id] ?? 0 }))} />}
                {calc.enr.without.length > 0 && <details className="mt-2 text-sm"><summary className="cursor-pointer">⚠ {t("dash.coursesWithout")} ({calc.enr.without.length})</summary><ul className="ms-4 list-disc">{calc.enr.without.map((c) => <li key={c.id} dir="auto">{L(c.level)} — {tc(c.name)}</li>)}</ul></details>}</div>
            </div>
          </Section>

          <Section title={t("dash.timetable")} links={[{ to: "/timetable", label: t("nav.timetable") }]}>
            <div className="grid gap-6 lg:grid-cols-2">
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.sessionsByDay")}</h3><BarList emptyText={t("dash.noSessions")} items={calc.days.map((d) => ({ label: t(`day.${d.day}`), value: d.n }))} /></div>
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.topInstructors")}</h3><BarList emptyText={t("dash.noSessions")} items={calc.top.map((x) => ({ label: instructor(x.id), value: x.n }))} /></div>
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.roomUse")}</h3><BarList suffix="%" emptyText={t("dash.noSessions")} items={calc.rooms.map((r) => ({ label: roomName(r.id), value: r.percent }))} /><p className="mt-1 text-xs text-slate-500">{t("dash.roomUseNote")}</p></div>
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.nextSessions")}</h3>
                {calc.next.length === 0 ? <p className="text-sm text-slate-500">{t("dash.noSessions")}</p> : <ul className="grid gap-1 text-sm">{calc.next.map((e) => <li key={e.id} dir="auto"><b>{tc(e.courseName)}</b> <span className="text-xs text-slate-500">{e.offset === 0 ? t("dash.today") : t(`day.${e.day}`)} · {rangeLabel(e.startMinutes, e.endMinutes)} · {L(e.level)}</span></li>)}</ul>}</div>
            </div>
          </Section>

          <Section title={t("dash.exams")} links={[{ to: "/exam-schedule", label: t("nav.examSchedule") }, { to: "/exams", label: t("nav.exams") }]}>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat n={calc.exams.midterm} label={t("dash.midterms")} /><Stat n={calc.exams.final} label={t("dash.finals")} /><Stat n={calc.exams.scheduledCourses} label={t("dash.examCourses")} /><Stat n={calc.exams.capacityIssues.length + calc.exams.roomClashes.length} label={t("dash.warnings")} tone="warn" /></div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.upcomingExams")}</h3>
                {calc.exams.upcoming.length === 0 ? <p className="text-sm text-slate-500">{t("dash.noExams")}</p> : <ul className="grid gap-1 text-sm">{calc.exams.upcoming.slice(0, 6).map((e) => <li key={e.id} dir="auto"><b>{courseName(e.courseId)}</b> <span className="text-xs text-slate-500">{fmt.format(new Date(`${e.date}T00:00:00`))} · {rangeLabel(e.startMinutes, e.endMinutes)}</span></li>)}</ul>}</div>
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.examsByLevel")}</h3><BarList emptyText={t("dash.noExams")} items={LEVELS.map((l) => ({ label: L(l), value: calc.exams.byLevel[l] ?? 0 }))} /></div>
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.capacityStatus")}</h3>
                <p className="text-sm">✓ {t("dash.capOk", { n: calc.exams.capacityOk })} · ⚠ {t("dash.capIssue", { n: calc.exams.capacityIssues.length })}</p></div>
              <div><h3 className="mb-2 text-sm font-semibold">{t("dash.warnings")}</h3>
                {calc.exams.capacityIssues.length + calc.exams.roomClashes.length === 0 ? <p className="text-sm text-emerald-800">✓ {t("dash.noWarnings")}</p> : <ul className="grid gap-1 text-sm text-amber-900">
                  {calc.exams.capacityIssues.map((id) => <li key={id} dir="auto">⚠ {t("dash.warnCapacity", { course: courseName(data.exams.find((e) => e.id === id)?.courseId ?? id) })}</li>)}
                  {calc.exams.roomClashes.map(([a, b]) => <li key={a + b} dir="auto">⛔ {t("dash.warnClash", { a: courseName(data.exams.find((e) => e.id === a)?.courseId ?? a), b: courseName(data.exams.find((e) => e.id === b)?.courseId ?? b) })}</li>)}</ul>}
                <p className="mt-1 text-xs text-slate-500">{t("dash.studentConflictNote")}</p></div>
            </div>
          </Section>

          <Section title={t("dash.activity")}>
            {activity.length === 0 ? <p className="text-sm text-slate-500">{t("dash.noActivity")}</p> : <ul className="grid gap-1 text-sm">{activity.map((a) => <li key={a.id} dir="auto" className="flex flex-wrap justify-between gap-2"><span>{actLine(a)}</span><span className="text-xs text-slate-500">{a.createdAt ? dt.format(a.createdAt) : ""}</span></li>)}</ul>}
          </Section>
        </div>
      )}
    </>
  );
}

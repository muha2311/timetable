import { useMemo, useState } from "react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { ACADEMIC_YEARS, LEVELS, SEMESTERS, type Level, type Semester } from "../domain/constants";
import { analyzeSelectedLevels, applyExclusions, type ExamAnalysis, type PairConflict } from "../domain/examConflicts";
import { useRefData } from "../features/timetable/useRefData";
import { useI18n } from "../i18n";
import { useSyncStatus } from "../services/offline/sync";
import { listEnrollmentsForCourses } from "../repositories/enrollmentsRepo";
import { getStudentsByIds } from "../repositories/studentsRepo";
import type { Student } from "../types";

const sel = "mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const lbl = "text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const SHOW = 50;

function Stat({ n, label, tone }: { n: number; label: string; tone?: "bad" | "ok" }) {
  const c = tone === "bad" && n > 0 ? "border-red-300 bg-red-50 text-red-900" : tone === "ok" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 dark:border-slate-700";
  return <div className={`rounded-lg border p-3 ${c}`}><div className="text-2xl font-semibold" dir="ltr">{n}</div><div className="text-xs">{label}</div></div>;
}

export function ExamConflictsPage() {
  const { t, tc } = useI18n();
  const toast = useToast();
  const { online } = useSyncStatus();
  const refs = useRefData();
  const [year, setYear] = useState<string>("2026-2027");
  const [semester, setSemester] = useState<Semester>("Fall");
  const [levels, setLevels] = useState<Level[]>([]);
  const [busy, setBusy] = useState(false);
  const [read, setRead] = useState(0);
  const [error, setError] = useState(false);
  const [res, setRes] = useState<{ analysis: ExamAnalysis; students: Map<string, Student>; excluded: number; lv: Level[]; read: number } | null>(null);

  const courseOf = useMemo(() => new Map(refs.courses.map((c) => [c.id, c])), [refs.courses]);
  const sectionName = useMemo(() => new Map(refs.sections.map((s) => [s.id, s.name])), [refs.sections]);
  const pick = (l: Level) => refs.courses.filter((c) => c.level === l && c.semester === semester);
  const ready = levels.length >= 2;

  async function run() {
    if (levels.length < 2) return;
    const selected = [...levels].sort((x, y) => x - y);
    const courseIds = selected.flatMap((l) => pick(l).map((c) => c.id)); // the selected levels choose the COURSES...
    setBusy(true); setError(false); setRes(null); setRead(0);
    try {
      const enrollments = await listEnrollmentsForCourses(year, courseIds, true, setRead); // ...and ALL their enrolled students take part, whatever their own level
      let analysis = analyzeSelectedLevels(enrollments, refs.courses, selected, year, semester);
      const ids = [...new Set(analysis.pairs.flatMap((p) => p.students))];
      const students = await getStudentsByIds(ids); // only the affected students, in bulk (for names / level shown as information)
      const inactive = new Set(ids.filter((id) => students.get(id)?.status === "inactive"));
      analysis = applyExclusions(analysis, inactive);
      setRes({ analysis, students, excluded: inactive.size, lv: selected, read: enrollments.length });
    } catch { setError(true); toast.error(t("exams.failed")); }
    finally { setBusy(false); }
  }

  const name = (id: string) => { const c = courseOf.get(id); return c ? `${t("level", { n: c.level })} — ${tc(c.name)}` : id; };
  const q = res?.analysis.quality;
  const conflictKeys = useMemo(() => new Set((res?.analysis.pairs ?? []).map((p) => `${p.courseA}|${p.courseB}`)), [res]);
  const safe = useMemo(() => {
    if (!res) return [];
    const gs = res.lv.map(pick), out: [{ id: string }, { id: string }][] = [];
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) for (const x of gs[i] ?? []) for (const y of gs[j] ?? []) if (!conflictKeys.has(`${x.id}|${y.id}`)) out.push([x, y]);
    return out;
  }, [res, conflictKeys, refs.courses]); // eslint-disable-line react-hooks/exhaustive-deps
  const missing = res ? [...new Set(res.analysis.pairs.flatMap((p) => p.students))].filter((id) => !res.students.has(id)).length : 0;

  return (
    <>
      <PageHeader title={t("nav.exams")} description={t("exams.description")} />
      {!online && <p role="alert" className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">⚠ {t("sync.needsConnection")}</p>}
      <div className={`${card} mb-4 flex flex-wrap items-end gap-x-4 gap-y-3`}>
        <label className={lbl}>{t("timetable.year")}<select className={sel} value={year} onChange={(e) => { setYear(e.target.value); setRes(null); }}>{ACADEMIC_YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
        <label className={lbl}>{t("timetable.semester")}<select className={sel} value={semester} onChange={(e) => { setSemester(e.target.value as Semester); setRes(null); }}>{SEMESTERS.map((s) => <option key={s} value={s}>{t(`semester.${s}`)}</option>)}</select></label>
        <fieldset className="text-sm"><legend className={lbl}>{t("exams.pickLevels")}</legend>
          <div className="mt-1 flex flex-wrap gap-2">{LEVELS.map((l) => (
            <label key={l} className="flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1.5 dark:border-slate-700">
              <input type="checkbox" checked={levels.includes(l)} onChange={(e) => { setLevels((p) => (e.target.checked ? [...p, l] : p.filter((x) => x !== l))); setRes(null); }} />{t("level", { n: l })}</label>))}</div>
        </fieldset>
        <Button variant="secondary" onClick={() => { setLevels([]); setRes(null); }} disabled={levels.length === 0}>{t("form.clear")}</Button>
        <Button onClick={() => void run()} disabled={!ready || busy || refs.loading || !online}>{t("exams.run")}</Button>
      </div>
      {levels.length === 1 && <p className="mb-3 text-sm text-amber-700">⚠ {t("exams.pickLevels")}</p>}
      {busy && <p className="text-sm" role="status">{t("exams.running")} {read > 0 && `(${t("exams.read", { n: read })})`}</p>}
      {error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {t("exams.failed")}</p>}

      {res && q && (
        <div className="grid gap-4">
          <p className="text-sm font-medium" dir="auto">{t("exams.levelsN", { levels: res.lv.map((l) => t("level", { n: l })).join(", ") })} · {year} · {t(`semester.${semester}`)}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {res.lv.map((l) => <Stat key={l} n={pick(l).length} label={t("exams.coursesIn", { level: t("level", { n: l }) })} />)}
            <Stat n={res.analysis.pairs.length} label={t("exams.conflictPairs")} tone="bad" />
            <Stat n={res.analysis.affected} label={t("exams.affected")} tone="bad" />
            <Stat n={res.analysis.safePairs} label={t("exams.safePairs")} tone="ok" />
          </div>

          {(res.read === 0 || q.emptyCourses.length > 0 || q.invalid > 0 || q.duplicates > 0 || res.excluded > 0 || missing > 0) && (
            <div role="alert" className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
              {res.read === 0 && <p>⚠ {t("exams.warnNoData")}</p>}
              {q.emptyCourses.length > 0 && res.read > 0 && <p>⚠ {t("exams.warnEmpty", { courses: q.emptyCourses.map((id) => tc(courseOf.get(id)?.name ?? id)).join(", ") })}</p>}
              {q.invalid > 0 && <p>⚠ {t("exams.warnInvalid", { n: q.invalid })}</p>}
              {q.duplicates > 0 && <p>ℹ {t("exams.warnDup", { n: q.duplicates })}</p>}
              {res.excluded > 0 && <p>ℹ {t("exams.warnExcluded", { n: res.excluded })}</p>}
              {missing > 0 && <p>⚠ {t("exams.warnMissing", { n: missing })}</p>}
            </div>
          )}

          <section aria-labelledby="conf"><h2 id="conf" className="mb-2 text-lg font-semibold">⚠ {t("exams.conflictsTitle")} ({res.analysis.pairs.length})</h2>
            {res.analysis.pairs.length === 0 ? <p className={`${card} text-sm`}>{t("exams.noConflicts")}</p> : (
              <div className="grid gap-2">{res.analysis.pairs.map((p) => <PairCard key={`${p.courseA}|${p.courseB}`} p={p} open={res.analysis.pairs.length <= 5} name={name} students={res.students} sectionName={sectionName} />)}</div>
            )}
          </section>

          <section aria-labelledby="safe"><details className={card}>
            <summary id="safe" className="cursor-pointer font-semibold">✓ {t("exams.safeTitle")} ({safe.length})</summary>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">{safe.map(([x, y]) => <li key={`${x.id}|${y.id}`} dir="auto">{name(x.id)} ↔ {name(y.id)}</li>)}</ul>
          </details></section>
        </div>
      )}
    </>
  );
}

function PairCard({ p, open, name, students, sectionName }: { p: PairConflict; open: boolean; name: (id: string) => string; students: Map<string, Student>; sectionName: ReadonlyMap<string, string> }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const list = all ? p.students : p.students.slice(0, SHOW);
  const th = "px-3 py-1.5 text-start font-semibold";
  return (
    <details open={open} className="rounded-xl border border-red-200 bg-white shadow-sm dark:border-red-900 dark:bg-slate-900">
      <summary className="cursor-pointer p-3">
        <span className="font-semibold" dir="auto">{name(p.courseA)} ↔ {name(p.courseB)}</span>
        <span className="ms-2 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">⚠ {t("exams.sharedStudents", { n: p.students.length })}</span>
      </summary>
      <div className="border-t border-slate-200 p-3 dark:border-slate-700">
        <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">{t("exams.mustNot")}</p>
        <div className="overflow-x-auto"><table className="w-full min-w-[30rem] text-sm">
          <thead className="bg-slate-100 dark:bg-slate-800"><tr><th className={th}>{t("col.studentId")}</th><th className={th}>{t("col.studentName")}</th><th className={th}>{t("col.level")}</th><th className={th}>{t("col.section")}</th></tr></thead>
          <tbody>{list.map((id) => { const s = students.get(id); return (
            <tr key={id} className="border-t border-slate-200 dark:border-slate-700"><td className="px-3 py-1" dir="ltr">{s?.academicId ?? id}</td><td className="px-3 py-1">{s?.fullName ?? "—"}</td>
              <td className="px-3 py-1">{s?.level ? t("level", { n: s.level }) : "—"}</td><td className="px-3 py-1">{s?.sectionId ? sectionName.get(s.sectionId) ?? "—" : "—"}</td></tr>); })}</tbody>
        </table></div>
        {p.students.length > SHOW && <Button variant="secondary" className="mt-2" onClick={() => setAll((x) => !x)}>{all ? t("exams.showFirst", { n: SHOW }) : t("exams.showAll", { n: p.students.length })}</Button>}
      </div>
    </details>
  );
}

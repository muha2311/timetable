import { useMemo, useState, type ChangeEvent } from "react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { ACADEMIC_YEARS, LEVELS, SEMESTERS, type Level, type Semester } from "../domain/constants";
import { columnLabels, detectColumns, parseRows, planImport, type Detection, type Grid, type ParsedRow, type Plan, type PlanItem } from "../domain/studentImport";
import { readGrid } from "../features/student-import/readWorkbook";
import { useRefData } from "../features/timetable/useRefData";
import { useI18n } from "../i18n";
import { useSyncStatus } from "../services/offline/sync";
import { findExistingEnrollmentIds, runImport, type ImportResult } from "../repositories/enrollmentsRepo";
import { getStudentsByIds } from "../repositories/studentsRepo";
import type { Student } from "../types";

type Step = "setup" | "mapping" | "preview" | "importing" | "done";
const sel = "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const lbl = "text-xs font-medium text-slate-500 dark:text-slate-400";
const card = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";

function Stat({ n, label, warn }: { n: number; label: string; warn?: boolean }) {
  return <div className={`rounded-lg border p-3 ${warn && n > 0 ? "border-red-300 bg-red-50 text-red-900" : "border-slate-200 dark:border-slate-700"}`}><div className="text-2xl font-semibold" dir="ltr">{n}</div><div className="text-xs">{label}</div></div>;
}

export function StudentImportPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { online } = useSyncStatus();
  const refs = useRefData();
  const [year, setYear] = useState<string>("2026-2027");
  const [semester, setSemester] = useState<Semester>("Fall");
  const [level, setLevel] = useState<Level>(1);
  const [courseId, setCourseId] = useState("");
  const [step, setStep] = useState<Step>("setup");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<Grid>([]);
  const [det, setDet] = useState<Detection | null>(null);
  const [idCol, setIdCol] = useState(-1);
  const [nameCol, setNameCol] = useState(-1);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [knownStudents, setKnownStudents] = useState<Map<string, Student>>(new Map());
  const [overrides, setOverrides] = useState<Record<string, Level>>({});
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);

  const courses = useMemo(() => refs.courses.filter((c) => c.level === level && c.semester === semester).sort((a, b) => a.name.localeCompare(b.name)), [refs.courses, level, semester]);
  const course = courses.find((c) => c.id === courseId);
  const labels = useMemo(() => (det ? columnLabels(grid, det.headerRow) : []), [grid, det]);
  const { tc } = useI18n();

  function reset() { setStep("setup"); setGrid([]); setDet(null); setRows([]); setPlan(null); setResult(null); setError(""); setFileName(""); }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !course) return;
    setError(""); setBusy("import.parsing");
    try {
      const g = await readGrid(file);
      if (g.length < 2) { setError("import.empty"); return; }
      const d = detectColumns(g);
      setGrid(g); setDet(d); setIdCol(d.idCol); setNameCol(d.nameCol); setFileName(file.name); setStep("mapping");
    } catch { setError("import.unreadable"); }
    finally { setBusy(""); }
  }

  async function toPreview() {
    if (!det || !course || idCol < 0 || nameCol < 0) return;
    setBusy("import.checking"); setError("");
    try {
      const parsed = parseRows(grid, det.headerRow, idCol, nameCol);
      const ids = parsed.filter((r) => r.status === "valid").map((r) => r.studentId);
      const [known, existingEnrollments] = await Promise.all([getStudentsByIds(ids), findExistingEnrollmentIds(year, course.id)]);
      setKnownStudents(known); setOverrides({});
      setRows(parsed); setPlan(planImport(parsed, new Set(known.keys()), existingEnrollments, year, course.id)); setStep("preview");
    } catch { setError("import.failed"); }
    finally { setBusy(""); }
  }

  // Manual level choices apply to NEW students only; existing students are never changed by an import.
  const withOverrides = (items: PlanItem[]): PlanItem[] => items.map((it) => (!it.studentExists && overrides[it.row.studentId] ? { ...it, level: overrides[it.row.studentId] as Level, levelSource: "manual" as const } : it));

  function levelCell(it: PlanItem | undefined) {
    if (!it) return "—";
    const sid = it.row.studentId;
    if (it.studentExists) { const lv = knownStudents.get(sid)?.level; return lv ? <>{t("level", { n: lv })} <small className="text-slate-500">({t("import.levelExisting")})</small></> : <span className="text-amber-700">⚠ {t("import.levelReview")}</span>; }
    const o = overrides[sid];
    if (o) return <>{t("level", { n: o })} <small className="text-slate-500">({t("import.levelManual")})</small></>;
    if (it.level) return <>{t("level", { n: it.level })} <small className="text-slate-500">({t("import.levelAuto")})</small></>;
    return (
      <select aria-label={t("import.levelReview")} className="rounded border border-amber-400 bg-amber-50 px-1 py-0.5 text-xs text-amber-900" value="" onChange={(e) => e.target.value && setOverrides((p) => ({ ...p, [sid]: Number(e.target.value) as Level }))}>
        <option value="">⚠ {t("import.levelReview")}</option>{LEVELS.map((l) => <option key={l} value={l}>{t("level", { n: l })}</option>)}
      </select>
    );
  }

  async function confirm() {
    if (!plan || !course) return;
    setStep("importing"); setError("");
    try {
      const r = await runImport(withOverrides(plan.items), { fileName, course, academicYear: year, totalRows: plan.counts.total, invalidRows: plan.counts.invalid }, (done, total) => setProgress({ done, total }));
      setResult(r); setStep("done");
      (r.failedRows.length ? toast.error : toast.success)(t(r.failedRows.length ? "import.partialTitle" : "import.doneTitle"));
    } catch { setError("import.failed"); setStep("preview"); }
  }

  const byRow = useMemo(() => new Map((plan?.items ?? []).map((i) => [i.row.row, i])), [plan]);
  const shown = onlyProblems ? rows.filter((r) => r.status !== "valid") : rows;
  const c = plan?.counts;
  const reviewCount = (plan?.items ?? []).filter((i) => !i.studentExists && i.level === null && !overrides[i.row.studentId]).length;
  return (
    <>
      <PageHeader title={t("nav.import")} description={t("import.description")} />
      {!online && <p role="alert" className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">⚠ {t("sync.needsConnection")}</p>}
      {error && <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {t(error)}</p>}

      {step === "setup" && (
        <div className={`${card} grid gap-4 sm:grid-cols-2 lg:grid-cols-4`}>
          <label className={lbl}>{t("timetable.year")}<select className={sel} value={year} onChange={(e) => setYear(e.target.value)}>{ACADEMIC_YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
          <label className={lbl}>{t("timetable.semester")}<select className={sel} value={semester} onChange={(e) => { setSemester(e.target.value as Semester); setCourseId(""); }}>{SEMESTERS.map((s) => <option key={s} value={s}>{t(`semester.${s}`)}</option>)}</select></label>
          <label className={lbl}>{t("timetable.level")}<select className={sel} value={level} onChange={(e) => { setLevel(Number(e.target.value) as Level); setCourseId(""); }}>{LEVELS.map((l) => <option key={l} value={l}>{t("level", { n: l })}</option>)}</select></label>
          <label className={lbl}>{t("import.course")}
            <select className={sel} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">{t("import.select")}</option>{courses.map((x) => <option key={x.id} value={x.id}>{tc(x.name)}</option>)}
            </select>
          </label>
          {!refs.loading && courses.length === 0 && <p className="text-sm text-amber-700 sm:col-span-2 lg:col-span-4">{t("import.noCourses")}</p>}
          <div className="sm:col-span-2 lg:col-span-4">
            <label className={lbl}>{t("import.file")}
              <input type="file" accept=".xlsx,.xls" disabled={!course || busy !== "" || !online} onChange={(e) => void onFile(e)} className={`${sel} file:me-3 file:rounded file:border-0 file:bg-brand-600 file:px-3 file:py-1 file:text-white`} />
            </label>
            {!course && <p className="mt-1 text-xs text-slate-500">{t("import.chooseCourse")}</p>}
            {busy && <p className="mt-2 text-sm" role="status">{t(busy)}</p>}
          </div>
        </div>
      )}

      {step === "mapping" && det && (
        <div className={`${card} grid gap-4 sm:grid-cols-2`}>
          <p className={`text-sm sm:col-span-2 ${det.confident ? "text-slate-600" : "text-amber-700"}`}>{det.confident ? t("import.detectedOk") : `⚠ ${t("import.lowConfidence")}`}</p>
          <p className="text-xs text-slate-500 sm:col-span-2">{t("import.fileLabel", { name: fileName })}</p>
          {([["import.idCol", idCol, setIdCol], ["import.nameCol", nameCol, setNameCol]] as const).map(([k, val, set]) => (
            <label key={k} className={lbl}>{t(k)}
              <select className={sel} value={val} onChange={(e) => set(Number(e.target.value))}>
                <option value={-1}>{t("import.select")}</option>{labels.map((l, i) => <option key={i} value={i}>{l}</option>)}
              </select>
            </label>
          ))}
          <div className="flex gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={reset}>{t("common.cancel")}</Button>
            <Button onClick={() => void toPreview()} disabled={idCol < 0 || nameCol < 0 || idCol === nameCol || busy !== ""}>{t("common.continue")}</Button>
            {busy && <span className="self-center text-sm" role="status">{t(busy)}</span>}
          </div>
        </div>
      )}

      {step === "preview" && c && (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Stat n={c.total} label={t("stat.total")} /><Stat n={c.valid} label={t("stat.valid")} /><Stat n={c.invalid} label={t("stat.invalid")} warn />
            <Stat n={c.newStudents} label={t("stat.newStudents")} /><Stat n={c.existingStudents} label={t("stat.existingStudents")} />
            <Stat n={c.newEnrollments} label={t("stat.newEnrollments")} /><Stat n={c.skippedEnrollments} label={t("stat.skipped")} />
            <Stat n={reviewCount} label={t("stat.needsReview")} warn />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />{t("import.onlyProblems")}</label>
          <div className="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800"><tr>{["col.row", "col.studentId", "col.studentName", "col.studentLevel", "col.courseLevel", "col.status"].map((k) => <th key={k} className="px-3 py-2 text-start font-semibold">{t(k)}</th>)}</tr></thead>
              <tbody>{shown.map((r) => {
                const it = byRow.get(r.row);
                const st = r.status !== "valid" ? `row.${r.status}` : it?.enrolled ? "row.enrolled" : it?.studentExists ? "row.existing" : "row.new";
                return <tr key={r.row} className={`border-t border-slate-200 dark:border-slate-700 ${r.status !== "valid" ? "bg-red-50 text-red-900" : ""}`}>
                  <td className="px-3 py-1.5" dir="ltr">{r.row}</td><td className="px-3 py-1.5" dir="ltr">{r.id || "—"}</td><td className="px-3 py-1.5">{r.name || "—"}</td><td className="px-3 py-1.5">{levelCell(it)}</td><td className="px-3 py-1.5">{course ? t("level", { n: course.level }) : "—"}</td>
                  <td className="px-3 py-1.5">{r.status !== "valid" && <span aria-hidden="true">⚠ </span>}{t(st)}</td></tr>;
              })}</tbody>
            </table>
          </div>
          {c.valid === 0 && <p className="text-sm text-amber-700">⚠ {t("import.noValid")}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setStep("mapping")}>{t("common.back")}</Button>
            <Button variant="secondary" onClick={reset}>{t("common.cancel")}</Button>
            <Button onClick={() => void confirm()} disabled={c.valid === 0 || !online}>{t("import.confirm")}</Button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className={card} role="status">
          <p className="mb-2 text-sm">{t("import.importing", { done: progress.done, total: progress.total })}</p>
          <progress className="h-3 w-full" value={progress.done} max={Math.max(progress.total, 1)} />
        </div>
      )}

      {step === "done" && result && c && (
        <div className={`${card} grid gap-4`}>
          <h2 className="text-lg font-semibold">{result.failedRows.length ? `⚠ ${t("import.partialTitle")}` : `✓ ${t("import.doneTitle")}`}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat n={result.newStudents} label={t("stat.newStudents")} /><Stat n={result.existingStudents} label={t("stat.existingStudents")} />
            <Stat n={result.newEnrollments} label={t("stat.newEnrollments")} /><Stat n={result.skippedEnrollments} label={t("stat.skipped")} />
            <Stat n={c.invalid} label={t("stat.invalid")} /><Stat n={result.failedRows.length} label={t("stat.failed")} warn />
          </div>
          {result.failedRows.length > 0 && <p className="text-sm text-red-800" dir="auto">{t("import.failedRows", { rows: result.failedRows.join(", ") })}</p>}
          <p className="text-xs text-slate-500">{result.historySaved ? t("import.historySaved") : t("import.historyFailed")}</p>
          <div><Button onClick={reset}>{t("import.another")}</Button></div>
        </div>
      )}
    </>
  );
}

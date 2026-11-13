import { Fragment, useMemo, useState } from "react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { ACADEMIC_YEARS, LEVELS } from "../domain/constants";
import { planLevelMigration } from "../domain/cohort";
import { levelOverview } from "../domain/studentsView";
import { RosterPanel, useYearStudents, type LevelKey } from "../features/students/RosterView";
import { useRefData } from "../features/timetable/useRefData";
import { useI18n } from "../i18n";
import { useSyncStatus } from "../services/offline/sync";
import { applyLevelMigration } from "../repositories/studentsRepo";

const card = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";
const sel = "mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";

export function AcademicLevelsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { online } = useSyncStatus();
  const refs = useRefData();
  const [year, setYear] = useState<string>("2026-2027");
  const [open, setOpen] = useState<LevelKey | null>(null);
  const [showFix, setShowFix] = useState(false);
  const [busy, setBusy] = useState(false);
  const { students, loading, error, reload } = useYearStudents(year);
  const ov = useMemo(() => levelOverview(students), [students]);
  const plan = useMemo(() => planLevelMigration(students.filter((s) => s.levelSource === undefined)), [students]);
  const legacy = plan.fix.length + plan.review.length;

  async function apply() {
    setBusy(true);
    try { await applyLevelMigration(plan); toast.success(t("levels.migrationDone", { fix: plan.fix.length, review: plan.review.length })); setShowFix(false); reload(); }
    catch { toast.error(t("levels.migrationFailed")); }
    finally { setBusy(false); }
  }
  const levelCard = ({ k, total, withSection, without }: { k: LevelKey; total: number; withSection?: number; without?: number }) => (
    <div className={`${card} flex flex-col gap-2 ${k === "none" && total > 0 ? "border-amber-400" : ""}`}>
      <h2 className="text-lg font-semibold">{k === "none" ? `⚠ ${t("levels.unassigned")}` : t("level", { n: k })}</h2>
      <div className="text-3xl font-semibold" dir="ltr">{total}</div>
      <div className="text-xs text-slate-500">{t("stat.students")}</div>
      {k !== "none" && <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm"><dt>{t("levels.withSection")}</dt><dd dir="ltr">{withSection}</dd><dt>{t("levels.withoutSection")}</dt><dd dir="ltr">{without}</dd></dl>}
      <Button variant={open === k ? "primary" : "secondary"} aria-pressed={open === k} onClick={() => setOpen(open === k ? null : k)} className="mt-auto">{t("levels.viewRoster")}</Button>
    </div>
  );
  return (
    <>
      <PageHeader title={t("nav.levels")} description={t("levels.description")} />
      <div className={`${card} mb-4 flex flex-wrap items-end gap-4`}>
        <label className="text-xs font-medium text-slate-500">{t("timetable.year")}<select className={sel} value={year} onChange={(e) => { setYear(e.target.value); setOpen(null); }}>{ACADEMIC_YEARS.map((y) => <option key={y}>{y}</option>)}</select></label>
        <Button variant="secondary" onClick={reload} disabled={loading}>{t("common.refresh")}</Button>
      </div>
      {error && <p role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {t("students.loadFailed")}</p>}
      {loading ? <p className="text-sm text-slate-500" role="status">{t("common.loading")}</p> : (
        <>
          {legacy > 0 && (
            <div role="alert" className="mb-4 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
              <p>⚠ {t("levels.migrationText", { n: legacy })}</p>
              {showFix && <p className="mt-1">{t("levels.migrationFix", { fix: plan.fix.length, review: plan.review.length })}</p>}
              <div className="mt-2 flex gap-2">
                {!showFix ? <Button variant="secondary" onClick={() => setShowFix(true)}>{t("levels.migrationReview")}</Button>
                  : <><Button onClick={() => void apply()} disabled={busy || !online}>{busy ? t("common.working") : t("levels.migrationApply")}</Button><Button variant="secondary" onClick={() => setShowFix(false)} disabled={busy}>{t("common.cancel")}</Button></>}
              </div>
            </div>
          )}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {LEVELS.map((l) => <Fragment key={l}>{levelCard({ k: l, total: ov.byLevel[l]?.total ?? 0, withSection: ov.byLevel[l]?.withSection ?? 0, without: ov.byLevel[l]?.withoutSection ?? 0 })}</Fragment>)}
            {levelCard({ k: "none", total: ov.unassigned })}
          </div>
          {open !== null && (
            <section aria-label={t("levels.rosterTitle", { level: open === "none" ? t("levels.unassigned") : t("level", { n: open }), year })}>
              <h2 className="mb-3 text-lg font-semibold" dir="auto">{t("levels.rosterTitle", { level: open === "none" ? t("levels.unassigned") : t("level", { n: open }), year })}</h2>
              <RosterPanel students={students} levelKey={open} refs={refs} onChanged={reload} />
            </section>
          )}
        </>
      )}
    </>
  );
}

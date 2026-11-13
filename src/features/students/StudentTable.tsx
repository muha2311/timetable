import { memo } from "react";
import { useI18n } from "../../i18n";
import type { Student } from "../../types";
import { Button } from "../../components/ui/Button";

export interface StudentRow { id: string; student: Student | null; enrollment?: string }
const th = "px-3 py-2 text-start font-semibold";

/** Memoized: only re-renders when its rows change (not on every keystroke elsewhere on the page). */
export const StudentTable = memo(function StudentTable({ rows, sectionName, showEnrollment = false, onEdit }: { rows: StudentRow[]; sectionName: ReadonlyMap<string, string>; showEnrollment?: boolean; onEdit?: (s: Student) => void }) {
  const { t } = useI18n();
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="bg-slate-100 dark:bg-slate-800"><tr>
          <th className={th}>{t("col.studentId")}</th><th className={th}>{t("col.studentName")}</th><th className={th}>{t("col.level")}</th><th className={th}>{t("col.section")}</th>
          <th className={th}>{showEnrollment ? t("col.enrollment") : t("col.year")}</th>{!showEnrollment && <th className={th}>{t("col.status")}</th>}{onEdit && <th className={th}><span className="sr-only">{t("col.actions")}</span></th>}
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">{t("students.empty")}</td></tr>}
          {rows.map(({ id, student: s, enrollment }) => (
            <tr key={id} className="border-t border-slate-200 dark:border-slate-700">
              <td className="px-3 py-1.5" dir="ltr">{s?.academicId ?? id}</td>
              <td className="px-3 py-1.5">{s?.fullName ?? "—"}</td>
              <td className="px-3 py-1.5">{s ? (s.level ? t("level", { n: s.level }) : <span className="text-amber-700">⚠ {t("students.unassigned")}</span>) : "—"}</td>
              <td className="px-3 py-1.5">{s?.sectionId ? sectionName.get(s.sectionId) ?? "—" : "—"}</td>
              <td className="px-3 py-1.5">{showEnrollment ? enrollment ?? "—" : s?.academicYear ?? "—"}</td>
              {!showEnrollment && <td className="px-3 py-1.5">{s ? t(`status.${s.status}`) : "—"}</td>}
              {onEdit && <td className="px-3 py-1.5">{s && <Button variant="secondary" onClick={() => onEdit(s)}>{t("common.edit")}</Button>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

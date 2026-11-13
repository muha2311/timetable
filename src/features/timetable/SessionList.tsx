import { DAYS, SESSION_META } from "../../domain/constants";
import { rangeLabel } from "../../domain/time";
import type { TimetableEntry } from "../../types";
import { useI18n } from "../../i18n";
import { Button } from "../../components/ui/Button";
import { instructorName, roomLabel, sectionsLabel } from "./labels";
import type { RefData } from "./useRefData";

export function SessionList({ entries, refs, onOpen }: { entries: TimetableEntry[]; refs: RefData; onOpen: (e: TimetableEntry) => void }) {
  const { t, tc } = useI18n();
  const rows = [...entries].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startMinutes - b.startMinutes);
  const th = "px-3 py-2 text-start font-semibold";
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-300 dark:border-slate-700">
      <table className="w-full min-w-[48rem] text-sm">
        <thead className="bg-slate-100 dark:bg-slate-800">
          <tr><th className={th}>{t("grid.day")}</th><th className={th}>{t("col.time")}</th><th className={th}>{t("col.course")}</th><th className={th}>{t("col.type")}</th><th className={th}>{t("col.instructor")}</th><th className={th}>{t("col.room")}</th><th className={th}>{t("col.sections")}</th><th className={th}><span className="sr-only">{t("col.actions")}</span></th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">{t("list.empty")}</td></tr>}
          {rows.map((e) => (
            <tr key={e.id} className="border-t border-slate-200 dark:border-slate-700">
              <td className="px-3 py-2">{t(`day.${e.day}`)}</td><td className="px-3 py-2">{rangeLabel(e.startMinutes, e.endMinutes)}</td>
              <td className="px-3 py-2 font-medium">{tc(e.courseName)}</td>
              <td className="px-3 py-2"><span className={`${SESSION_META[e.sessionType].color} rounded px-2 py-0.5 text-xs text-slate-900`}>{t(`badge.${e.sessionType}`)} · {t(`session.${e.sessionType}`)}</span></td>
              <td className="px-3 py-2">{instructorName(refs, e.instructorId) || "—"}</td><td className="px-3 py-2">{roomLabel(refs, e.classroomId) || "—"}</td>
              <td className="px-3 py-2">{sectionsLabel(refs, e.sectionIds, t)}</td>
              <td className="px-3 py-2"><Button variant="secondary" onClick={() => onOpen(e)}>{t("common.view")}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

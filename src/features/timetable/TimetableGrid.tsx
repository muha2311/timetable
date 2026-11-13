import { Fragment, useMemo } from "react";
import { SESSION_META, type Day, type TimeSlot } from "../../domain/constants";
import { rangeLabel, slotIndexFor } from "../../domain/time";
import type { TimetableEntry } from "../../types";
import { useI18n } from "../../i18n";
import { instructorName, roomLabel, sectionsLabel } from "./labels";
import type { RefData } from "./useRefData";

const head = "border-s border-slate-300 bg-slate-100 p-2 text-start text-sm font-semibold first:border-s-0 dark:border-slate-700 dark:bg-slate-800";

interface Props {
  days: readonly Day[]; slots: readonly TimeSlot[]; entries: TimetableEntry[]; refs: RefData;
  onAdd: (day: Day, slot: TimeSlot) => void; onOpen: (e: TimetableEntry) => void;
}

export function TimetableGrid({ days, slots, entries, refs, onAdd, onOpen }: Props) {
  const { t, tc } = useI18n();
  const cellMap = useMemo(() => {
    const m = new Map<string, TimetableEntry[]>();
    for (const e of entries) { const k = `${e.day}|${slotIndexFor(slots, e.startMinutes)}`; const a = m.get(k); if (a) a.push(e); else m.set(k, [e]); }
    m.forEach((a) => a.sort((x, y) => x.startMinutes - y.startMinutes));
    return m;
  }, [entries, slots]);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-300 dark:border-slate-700">
      <div className="grid min-w-[60rem] bg-white dark:bg-slate-900" style={{ gridTemplateColumns: `7rem repeat(${slots.length}, minmax(14rem, 1fr))` }}>
        <div className={head}>{t("grid.day")}</div>
        {slots.map((s) => <div key={s.id} className={head}>{t(`slot.${s.id}`)}<div className="text-xs font-normal">{rangeLabel(s.start, s.end)}</div></div>)}
        {days.map((day) => (
          <Fragment key={day}>
            <div className={`${head} border-t`}>{t(`day.${day}`)}</div>
            {slots.map((s, i) => {
              const here = cellMap.get(`${day}|${i}`) ?? [];
              return (
                <div key={s.id} className="flex min-h-[6rem] flex-col gap-1 border-s border-t border-slate-300 p-1 dark:border-slate-700">
                  {here.map((e) => {
                    const meta = SESSION_META[e.sessionType];
                    return (
                      <button key={e.id} type="button" onClick={() => onOpen(e)}
                        className={`${meta.color} ${meta.accent} rounded-md border border-s-4 border-black/10 p-2 text-start text-xs text-slate-900 shadow-sm transition hover:shadow-md`}>
                        <span className="mb-1 inline-block rounded bg-black/10 px-1 font-semibold">{t(`badge.${e.sessionType}`)}</span>
                        <span className="ms-1 text-[11px]">{rangeLabel(e.startMinutes, e.endMinutes)}</span>
                        <div className="font-semibold">{tc(e.courseName)}</div>
                        {e.instructorId && <div className="text-red-800">{instructorName(refs, e.instructorId)}</div>}
                        <div>{sectionsLabel(refs, e.sectionIds, t)}{e.classroomId && ` · ${roomLabel(refs, e.classroomId)}`}</div>
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => onAdd(day, s)} aria-label={t("grid.addAria", { day: t(`day.${day}`), slot: t(`slot.${s.id}`) })}
                    className="mt-auto rounded border border-dashed border-slate-300 py-1 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">+ {t("common.add")}</button>
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

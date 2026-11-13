import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { rangeLabel } from "../../domain/time";
import { useI18n } from "../../i18n";
import { listCourseRoster, type RosterRow } from "../../repositories/enrollmentsRepo";
import type { Exam } from "../../types";
import type { RefData } from "../timetable/useRefData";

export function ExamDetails({ exam, refs, dateLabel, onEdit, onExportRoom, onExportCourse }: { exam: Exam; refs: RefData; dateLabel: string; onEdit: () => void; onExportRoom: (roomId: string) => void; onExportCourse: () => void }) {
  const { t, tc } = useI18n();
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [room, setRoom] = useState("");
  const course = refs.courses.find((c) => c.id === exam.courseId);
  useEffect(() => { let alive = true; listCourseRoster(exam.academicYear, exam.courseId).then((r) => { if (alive) setRoster(r); }).catch(() => undefined); return () => { alive = false; }; }, [exam]);
  const unique = useMemo(() => { const m = new Map<string, RosterRow>(); roster.forEach((r) => m.set(r.studentId, r)); return [...m.values()]; }, [roster]);
  const roomOf = useMemo(() => { const m = new Map<string, string>(); Object.entries(exam.allocation ?? {}).forEach(([r, l]) => l.forEach((s) => m.set(s, r))); return m; }, [exam.allocation]);
  const rname = (id: string) => { const c = refs.classrooms.find((x) => x.id === id); return c ? (c.building ? `${c.name} (${c.building})` : c.name) : id; };
  const shown = room ? unique.filter((r) => roomOf.get(r.studentId) === room) : unique;
  const total = exam.roomIds.reduce((a, r) => a + (exam.roomCapacities?.[r] ?? 0), 0);
  const th = "px-2 py-1 text-start font-semibold";
  return (
    <div className="grid gap-3 text-sm">
      <div><h3 className="text-base font-semibold" dir="auto">{tc(course?.name ?? exam.courseId)}</h3>
        <p dir="auto">{course ? t("level", { n: course.level }) : ""} · {dateLabel} · {rangeLabel(exam.startMinutes, exam.endMinutes)} · {t("exam.minutes", { n: exam.endMinutes - exam.startMinutes })}</p>
        <p>{t("exam.enrolledN", { n: exam.studentCount })} · {t("exam.combined")}: <span dir="ltr">{total}</span></p>{exam.notes && <p className="text-slate-600" dir="auto">{exam.notes}</p>}</div>
      <table className="w-full"><thead className="bg-slate-100 dark:bg-slate-800"><tr><th className={th}>{t("col.room")}</th><th className={th}>{t("col.capacity")}</th><th className={th}>{t("exam.assignedCol")}</th><th className={th}><span className="sr-only">{t("col.actions")}</span></th></tr></thead>
        <tbody>{exam.roomIds.map((r) => <tr key={r} className="border-t border-slate-200 dark:border-slate-700"><td className="px-2 py-1" dir="auto">{rname(r)}</td><td className="px-2 py-1" dir="ltr">{exam.roomCapacities?.[r] ?? "?"}</td><td className="px-2 py-1" dir="ltr">{exam.allocation?.[r] ? exam.allocation[r]?.length : "—"}</td>
          <td className="px-2 py-1"><div className="flex gap-1"><Button variant="secondary" onClick={() => setRoom(room === r ? "" : r)} aria-pressed={room === r}>{t("common.view")}</Button><Button variant="secondary" onClick={() => onExportRoom(r)}>{t("exam.exportRoom")}</Button></div></td></tr>)}</tbody></table>
      <div className="flex items-center justify-between"><h4 className="font-semibold">{room ? `${t("exam.byRoom")}: ${rname(room)}` : t("exam.students")} ({shown.length})</h4><Button variant="secondary" onClick={onExportCourse}>{t("exam.exportCourse")}</Button></div>
      <div className="max-h-64 overflow-auto rounded border border-slate-200 dark:border-slate-700"><table className="w-full"><thead className="sticky top-0 bg-slate-100 dark:bg-slate-800"><tr><th className={th}>{t("col.studentId")}</th><th className={th}>{t("col.studentName")}</th><th className={th}>{t("col.room")}</th></tr></thead>
        <tbody>{shown.map((r) => <tr key={r.studentId} className="border-t border-slate-200 dark:border-slate-700"><td className="px-2 py-1" dir="ltr">{r.student?.academicId ?? r.studentId}</td><td className="px-2 py-1" dir="auto">{r.student?.fullName ?? "—"}</td><td className="px-2 py-1" dir="auto">{roomOf.has(r.studentId) ? rname(roomOf.get(r.studentId) as string) : "—"}</td></tr>)}</tbody></table></div>
      <div className="flex justify-end"><Button onClick={onEdit}>{t("common.edit")}</Button></div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import type { ExamType, Semester } from "../../domain/constants";
import type { CourseRef } from "../../domain/examConflicts";
import { capacitySummary, distribute, ExamValidationError, validateAllocation, validateExam, type ExamInput, type Issue } from "../../domain/examSchedule";
import { fromHHMM, rangeLabel, toHHMM } from "../../domain/time";
import { useI18n } from "../../i18n";
import { listCourseEnrollments, listCourseRoster, type EnrollmentRow, type RosterRow } from "../../repositories/enrollmentsRepo";
import { listExamsByDate, roomLite } from "../../repositories/examsRepo";
import { saveExamCritical } from "../../services/offline/critical";
import { SyncConflict } from "../../domain/outbox";
import { getStudentsByIds } from "../../repositories/studentsRepo";
import type { Exam, Student } from "../../types";
import type { RefData } from "../timetable/useRefData";

const field = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const box = "rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900";
export interface ScheduleKey { id: string; year: string; semester: Semester; type: ExamType }

export function ExamForm({ refs, schedule, exam, scheduleExams, onSaved, onCancel }: { refs: RefData; schedule: ScheduleKey; exam: Exam | null; scheduleExams: Exam[]; onSaved: () => void; onCancel: () => void }) {
  const { t, tc } = useI18n();
  const toast = useToast();
  const [courseId, setCourseId] = useState(exam?.courseId ?? "");
  const [date, setDate] = useState(exam?.date ?? "");
  const [start, setStart] = useState(exam?.startMinutes ?? 540);
  const [end, setEnd] = useState(exam?.endMinutes ?? 660);
  const [roomIds, setRoomIds] = useState<string[]>(exam?.roomIds ?? []);
  const [allocation, setAllocation] = useState<Record<string, string[]>>(exam?.allocation ?? {});
  const [notes, setNotes] = useState(exam?.notes ?? "");
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [dateExams, setDateExams] = useState<Exam[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [affected, setAffected] = useState<Map<string, Student>>(new Map());
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [adjust, setAdjust] = useState("");

  const courseMap = useMemo(() => new Map<string, CourseRef>(refs.courses.map((c) => [c.id, { id: c.id, name: c.name, level: c.level }])), [refs.courses]);
  const roomsById = useMemo(() => new Map(refs.classrooms.map((c) => [c.id, roomLite(c)])), [refs.classrooms]);
  const sectionName = useMemo(() => new Map(refs.sections.map((s) => [s.id, s.name])), [refs.sections]);
  const courseOptions = useMemo(() => refs.courses.filter((c) => c.semester === schedule.semester).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)), [refs.courses, schedule.semester]);
  const scheduled = useMemo(() => new Set(scheduleExams.map((e) => e.courseId)), [scheduleExams]);

  // Enrollments are fetched only when the course/date changes (cached); every other change re-validates in memory.
  useEffect(() => {
    if (!courseId) { setEnrollments([]); setDateExams([]); return; }
    let alive = true;
    setLoading(true); setLoadError(false);
    const ids = new Set([courseId, ...(date ? scheduleExams.filter((e) => e.date === date && e.courseId !== courseId).map((e) => e.courseId) : [])]);
    Promise.all([date ? listExamsByDate(date) : Promise.resolve([] as Exam[]), Promise.all([...ids].map((c) => listCourseEnrollments(schedule.year, c)))])
      .then(([de, enr]) => { if (alive) { setDateExams(de); setEnrollments(enr.flat()); } })
      .catch(() => { if (alive) setLoadError(true); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [courseId, date, scheduleExams, schedule.year]);
  useEffect(() => {
    if (!courseId) { setRoster([]); return; }
    let alive = true;
    listCourseRoster(schedule.year, courseId).then((r) => { if (alive) setRoster(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, [courseId, schedule.year]);

  const input = useMemo<ExamInput>(() => ({ id: exam?.id, scheduleId: schedule.id, academicYear: schedule.year, semester: schedule.semester, examType: schedule.type, courseId, date, startMinutes: start, endMinutes: end, roomIds, allocation }),
    [exam?.id, schedule, courseId, date, start, end, roomIds, allocation]);
  const v = useMemo(() => (courseId && !loading ? validateExam({ exam: input, courses: courseMap, roomsById, scheduleExams, dateExams, enrollments }) : null), [input, courseMap, roomsById, scheduleExams, dateExams, enrollments, courseId, loading]);

  const selected = useMemo(() => roomIds.map((id) => roomsById.get(id) ?? { id, name: id, capacity: null }), [roomIds, roomsById]);
  const cap = v?.capacity ?? capacitySummary(0, selected);
  const students = v?.students ?? [];
  const names = useMemo(() => new Map(roster.map((r) => [r.studentId, r.student?.fullName ?? ""])), [roster]);
  const levelDist = useMemo(() => {
    const m = new Map<string, number>(), set = new Set(students);
    roster.forEach((r) => { if (set.has(r.studentId)) { const k = r.student?.level ? t("level", { n: r.student.level }) : t("students.unassigned"); m.set(k, (m.get(k) ?? 0) + 1); } });
    return [...m.entries()];
  }, [roster, students, t]);
  const allocIssues = useMemo(() => (Object.keys(allocation).length ? validateAllocation(students, selected, allocation) : []), [allocation, students, selected]);
  const booked = useMemo(() => new Set((v?.roomBookings ?? []).flatMap((e) => e.roomIds)), [v]);
  const sameDay = useMemo(() => (date ? scheduleExams.filter((e) => e.date === date && e.id !== exam?.id) : []), [scheduleExams, date, exam?.id]);
  const affectedKey = (v?.conflicts ?? []).flatMap((c) => c.students).join(",");
  useEffect(() => {
    if (!affectedKey) { setAffected(new Map()); return; }
    let alive = true;
    getStudentsByIds(affectedKey.split(",")).then((m) => { if (alive) setAffected(m); }).catch(() => undefined);
    return () => { alive = false; };
  }, [affectedKey]);

  const setRooms = (id: string, on: boolean) => setRoomIds((p) => (on ? [...p, id] : p.filter((x) => x !== id)));
  const move = (sid: string, to: string) => setAllocation((a) => { const n: Record<string, string[]> = {}; for (const [r, l] of Object.entries(a)) n[r] = l.filter((x) => x !== sid); n[to] = [...(n[to] ?? []), sid]; return n; });
  const auto = () => { const d = distribute(students, selected); if (d) { setAllocation(d); setAdjust(roomIds[0] ?? ""); } else toast.error(t("exam.distributeFailed")); };
  const issueText = (i: Issue) => t(`examIssue.${i.code}`, { n: i.n ?? i.ids?.length ?? 0 });
  const courseName = (id: string) => tc(courseMap.get(id)?.name ?? id);
  const status = v?.status;

  async function save() {
    if (!v?.ok) return;
    setBusy(true); setServerIssues([]);
    try { const r = await saveExamCritical({ ...input, examType: schedule.type }, notes, courseMap, !!exam, exam?.updatedAt?.getTime() ?? null); toast.success(t(r === "queued" ? "sync.savedOffline" : "exam.saved")); onSaved(); }
    catch (e) { if (e instanceof ExamValidationError) setServerIssues(e.issues); else if (e instanceof SyncConflict) toast.error(t("sync.modifiedElsewhere")); else toast.error(t("form.saveFailed")); }
    finally { setBusy(false); }
  }
  const dur = end - start;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_24rem]">
      <div className="grid content-start gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">{t("import.course")}
            <select className={field} value={courseId} disabled={!!exam} onChange={(e) => { setCourseId(e.target.value); setAllocation({}); }}>
              <option value="">{t("import.select")}</option>
              {courseOptions.map((c) => <option key={c.id} value={c.id} disabled={scheduled.has(c.id) && exam?.courseId !== c.id}>{t("level", { n: c.level })} — {tc(c.name)}{scheduled.has(c.id) && exam?.courseId !== c.id ? ` ${t("exam.scheduledMark")}` : ""}</option>)}
            </select>
          </label>
          {courseId && (
            <div className={`${box} sm:col-span-2 text-sm`}>
              <b dir="auto">{courseName(courseId)}</b> · {t("level", { n: courseMap.get(courseId)?.level ?? 0 })} · {loading ? t("common.loading") : t("exam.enrolledN", { n: students.length })}
              {levelDist.length > 0 && <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">{t("exam.levelDist")}: {levelDist.map(([k, n]) => `${k}: ${n}`).join(" · ")}</div>}
            </div>
          )}
          <label className="text-sm font-medium">{t("exam.date")}<input type="date" dir="ltr" className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="text-sm font-medium">{t("form.start")}<input type="time" dir="ltr" className={field} value={toHHMM(start)} onChange={(e) => { if (e.target.value) { const m = fromHHMM(e.target.value); setEnd(m + (end - start)); setStart(m); } }} /></label>
          <label className="text-sm font-medium">{t("form.end")}<input type="time" dir="ltr" className={field} value={toHHMM(end)} onChange={(e) => e.target.value && setEnd(fromHHMM(e.target.value))} /></label>
          <label className="text-sm font-medium">{t("exam.duration")}<input type="number" min={1} dir="ltr" className={field} value={dur > 0 ? dur : ""} onChange={(e) => setEnd(start + Math.max(1, Number(e.target.value) || 1))} /></label>
        </div>

        <fieldset className={box}>
          <legend className="px-1 text-sm font-medium">{t("exam.rooms")}</legend>
          <div className="grid max-h-48 gap-1 overflow-auto sm:grid-cols-2">
            {refs.classrooms.map((c) => { const r = roomsById.get(c.id); return (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={roomIds.includes(c.id)} onChange={(e) => setRooms(c.id, e.target.checked)} />
                <span dir="auto">{r?.name}</span>
                <span className="text-xs text-slate-500" dir="ltr">{r?.capacity ?? ""}</span>
                {r?.capacity == null && <span className="text-xs text-amber-700">{t("exam.roomUnknown")}</span>}
                {booked.has(c.id) && <span className="text-xs text-red-700">{t("exam.roomBooked")}</span>}
              </label>); })}
          </div>
        </fieldset>

        <div className={box} aria-live="polite">
          <h3 className="mb-1 text-sm font-semibold">{t("exam.capacityTitle")}</h3>
          <ul className="mb-2 text-sm">{selected.map((r) => <li key={r.id} className="flex justify-between gap-2"><span dir="auto">{r.name}</span><span dir="ltr">{r.capacity ?? t("exam.roomUnknown")}</span></li>)}</ul>
          <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 text-sm">
            <dt>{t("exam.enrolled")}</dt><dd dir="ltr">{cap.studentCount}</dd><dt>{t("exam.selectedRooms")}</dt><dd dir="ltr">{cap.roomCount}</dd><dt>{t("exam.combined")}</dt><dd dir="ltr">{cap.total}</dd>
            {cap.shortfall > 0 ? <><dt className="text-red-700">{t("exam.shortfall")}</dt><dd dir="ltr" className="text-red-700">{cap.shortfall}</dd></> : <><dt>{t("exam.remaining")}</dt><dd dir="ltr">{cap.remaining}</dd></>}
          </dl>
          <p className={`mt-2 text-sm font-semibold ${cap.sufficient ? "text-emerald-800" : "text-red-700"}`}>{cap.unknownRoomIds.length ? `⚠ ${t("exam.capUnknown")}` : cap.sufficient ? `✓ ${t("exam.capSufficient")}` : `⚠ ${t("exam.capInsufficient")}`}</p>
        </div>

        <div className={box}>
          <div className="mb-2 flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{t("exam.distribution")}</h3>
            <Button variant="secondary" onClick={auto} disabled={!cap.sufficient || students.length === 0}>{t("exam.autoDistribute")}</Button>
            {Object.keys(allocation).length > 0 && <Button variant="secondary" onClick={() => setAllocation({})}>{t("exam.clearDistribution")}</Button>}
          </div>
          {Object.keys(allocation).length > 0 && (
            <>
              <ul className="mb-2 grid gap-1 text-sm sm:grid-cols-2">{selected.map((r) => <li key={r.id} className={(allocation[r.id]?.length ?? 0) > (r.capacity ?? 0) ? "text-red-700" : ""}><span dir="auto">{r.name}</span>: {t("exam.assigned", { n: allocation[r.id]?.length ?? 0, cap: r.capacity ?? "?" })}</li>)}</ul>
              {allocIssues.length > 0 && <p role="alert" className="mb-2 text-sm text-red-700">⚠ {t("examIssue.allocation_invalid")} ({allocIssues.map((i) => `${t(`alloc.${i.code}`)}: ${i.ids.length}`).join(", ")})</p>}
              <label className="text-xs text-slate-500">{t("exam.byRoom")}<select className={field} value={adjust} onChange={(e) => setAdjust(e.target.value)}><option value="">{t("import.select")}</option>{selected.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
              {adjust && <div className="mt-2 max-h-48 overflow-auto"><table className="w-full text-sm"><tbody>{(allocation[adjust] ?? []).map((sid) => (
                <tr key={sid} className="border-t border-slate-200 dark:border-slate-700"><td className="py-1" dir="ltr">{sid}</td><td dir="auto">{names.get(sid) ?? ""}</td>
                  <td><select aria-label={t("exam.moveTo")} className="rounded border border-slate-300 bg-white px-1 text-xs dark:border-slate-700 dark:bg-slate-900" value="" onChange={(e) => e.target.value && move(sid, e.target.value)}><option value="">{t("exam.moveTo")}</option>{selected.filter((r) => r.id !== adjust).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></td></tr>))}</tbody></table></div>}
            </>
          )}
        </div>

        <label className="text-sm font-medium">{t("form.notes")}<textarea className={field} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {serverIssues.length > 0 && <div role="alert" className="rounded-md border border-red-400 bg-red-50 p-3 text-sm text-red-900"><p className="font-medium">⚠ {t("exam.serverChecked")}</p><ul className="list-disc ps-5">{serverIssues.map((i, k) => <li key={k}>{issueText(i)}</li>)}</ul></div>}
        {v && !v.ok && <p className="text-xs text-slate-500">{t("exam.saveBlocked")}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={() => void save()} disabled={!v?.ok || busy}>{busy ? t("form.saving") : t("common.save")}</Button>
        </div>
      </div>

      <aside className="grid content-start gap-3" aria-label={t("exam.panelTitle")}>
        <div className={`${box} ${status === "conflict" ? "border-red-400 bg-red-50 text-red-900" : status === "unverified" ? "border-amber-400 bg-amber-50 text-amber-900" : status === "safe" ? "border-emerald-400 bg-emerald-50 text-emerald-900" : ""}`} role="status">
          <h3 className="text-sm font-semibold">{t("exam.panelTitle")}</h3>
          <p className="mt-1 text-sm font-semibold">{!courseId || !date ? t("exam.pickCourseDate") : loading ? t("common.loading") : loadError ? `⚠ ${t("exam.loadFailed")}` : status === "conflict" ? `⛔ ${t("exam.statusConflict")}` : status === "unverified" ? `⚠ ${t("exam.statusUnverified")}` : `✓ ${t("exam.statusSafe")}`}</p>
        </div>
        {v && v.issues.filter((i) => !["student_conflict"].includes(i.code)).length > 0 && <ul className="list-disc ps-5 text-sm text-amber-900">{v.issues.filter((i) => i.code !== "student_conflict").map((i, k) => <li key={k}>{issueText(i)}</li>)}</ul>}
        <div className={box}><h3 className="mb-1 text-sm font-semibold">{t("exam.sameDay")}</h3>
          {sameDay.length === 0 ? <p className="text-sm text-slate-500">{t("exam.noneSameDay")}</p> : <ul className="grid gap-1 text-sm">{sameDay.map((e) => <li key={e.id} dir="auto">{courseName(e.courseId)} <span className="text-xs text-slate-500">{rangeLabel(e.startMinutes, e.endMinutes)}</span></li>)}</ul>}
        </div>
        {v && v.conflicts.length > 0 && (
          <div className={box}><h3 className="mb-1 text-sm font-semibold text-red-800">⛔ {t("exam.conflictsTitle")} ({v.conflicts.length})</h3>
            {v.conflicts.map((c) => (
              <details key={c.courseB} className="mb-1 rounded border border-red-200 p-2 text-sm"><summary className="cursor-pointer" dir="auto">{courseName(c.courseB)} — {t("exams.sharedStudents", { n: c.students.length })}</summary>
                <div className="mt-1 max-h-48 overflow-auto"><table className="w-full text-xs"><thead><tr><th className="text-start">{t("col.studentId")}</th><th className="text-start">{t("col.studentName")}</th><th className="text-start">{t("col.level")}</th><th className="text-start">{t("col.section")}</th></tr></thead>
                  <tbody>{c.students.map((sid) => { const s = affected.get(sid); return <tr key={sid} className="border-t border-slate-200"><td dir="ltr">{s?.academicId ?? sid}</td><td dir="auto">{s?.fullName ?? "—"}</td><td>{s?.level ? t("level", { n: s.level }) : "—"}</td><td>{s?.sectionId ? sectionName.get(s.sectionId) ?? "—" : "—"}</td></tr>; })}</tbody></table></div>
              </details>
            ))}
          </div>
        )}
        {v && v.roomBookings.length > 0 && <div className={box}><h3 className="mb-1 text-sm font-semibold text-red-800">⛔ {t("exam.bookings")}</h3><ul className="text-sm">{v.roomBookings.map((e) => <li key={e.id} dir="auto">{courseName(e.courseId)} {rangeLabel(e.startMinutes, e.endMinutes)} · {e.roomIds.filter((r) => roomIds.includes(r)).map((r) => roomsById.get(r)?.name ?? r).join(", ")}</li>)}</ul></div>}
      </aside>
    </div>
  );
}

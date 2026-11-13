import { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { useAuth } from "../../app/AuthProvider";
import { useI18n } from "../../i18n";
import { DAYS, DEFAULT_TIME_SLOTS, LEVELS, SESSION_TYPES, type Level } from "../../domain/constants";
import { ConflictError, findConflicts, type Conflict } from "../../domain/conflicts";
import { fromHHMM, rangeLabel, toHHMM } from "../../domain/time";
import { saveTimetableEntry } from "../../services/offline/critical";
import { SyncConflict } from "../../domain/outbox";
import type { TimetableDraft, TimetableEntry } from "../../types";
import { instructorName, roomLabel, sectionsLabel } from "./labels";
import { QuickAdd } from "./QuickAdd";
import type { RefData } from "./useRefData";

const field = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";

interface Props {
  initial: TimetableDraft; editingId?: string; refs: RefData; entries: TimetableEntry[];
  baseUpdatedAt?: number | null; onDone: () => void; onCancel: () => void;
}

export function SessionForm({ initial, editingId, refs, entries, baseUpdatedAt, onDone, onCancel }: Props) {
  const toast = useToast();
  const { t, tc } = useI18n();
  const { isSuper } = useAuth();
  const [d, setD] = useState<TimetableDraft>(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TimetableDraft>(k: K, v: TimetableDraft[K]) => { setD((p) => ({ ...p, [k]: v })); setConflicts([]); };
  const levelSections = useMemo(
    () => refs.sections.filter((s) => s.level === d.level).sort((a, b) => Number(a.name) - Number(b.name)),
    [refs.sections, d.level]);
  const courseOptions = useMemo(
    () => refs.courses.filter((c) => c.level === d.level && c.semester === d.semester).sort((a, b) => a.name.localeCompare(b.name)),
    [refs.courses, d.level, d.semester]);
  // "Other" lets you type a course that is not in the list (e.g. an elective); it is also used when the list is empty.
  const [custom, setCustom] = useState(() => initial.courseName !== "" && !refs.courses.some((c) => c.name === initial.courseName && c.level === initial.level && c.semester === initial.semester));
  const isCustom = custom || courseOptions.length === 0;
  const slotId = DEFAULT_TIME_SLOTS.find((s) => s.start === d.startMinutes && s.end === d.endMinutes)?.id ?? "custom";

  function describe(c: Conflict): string {
    const o = c.other;
    const who = c.kind === "instructor" ? instructorName(refs, o.instructorId) : c.kind === "classroom" ? roomLabel(refs, o.classroomId) : `${t("level", { n: o.level })} ${sectionsLabel(refs, o.sectionIds, t)}`;
    return t(`conflict.${c.kind}`, { who, course: tc(o.courseName), day: t(`day.${o.day}`), time: rangeLabel(o.startMinutes, o.endMinutes) });
  }

  async function submit() {
    const errs: string[] = [];
    if (!d.courseName.trim()) errs.push(t("err.course"));
    if (d.endMinutes <= d.startMinutes) errs.push(t("err.time"));
    if (d.sessionType !== "lecture" && d.sectionIds.length === 0) errs.push(t("err.sections"));
    setErrors(errs);
    if (errs.length) return;
    const found = findConflicts({ ...d, id: editingId }, entries); // the edited entry is excluded by id
    if (found.length) { setConflicts(found); return; }
    setBusy(true);
    try {
      const r = await saveTimetableEntry({ ...d, courseName: d.courseName.trim() }, { id: editingId, baseUpdatedAt });
      toast.success(t(r === "queued" ? "sync.savedOffline" : editingId ? "form.updated" : "form.saved"));
      onDone();
    } catch (e) {
      if (e instanceof ConflictError) setConflicts(e.conflicts);
      else if (e instanceof SyncConflict) toast.error(t("sync.modifiedElsewhere"));
      else toast.error(t("form.saveFailed"));
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="text-sm font-medium">{t("form.course")}
          <select className={field} value={isCustom ? "__custom" : d.courseName} onChange={(e) => {
            if (e.target.value === "__custom") { setCustom(true); set("courseName", ""); } else { setCustom(false); set("courseName", e.target.value); }
          }}>
            <option value="" disabled>{t("form.selectCourse")}</option>
            {courseOptions.map((c) => <option key={c.id} value={c.name}>{tc(c.name)}</option>)}
            <option value="__custom">{t("form.otherCourse")}</option>
          </select>
        </label>
        {isCustom && <input className={field} aria-label={t("form.course")} value={d.courseName} onChange={(e) => set("courseName", e.target.value)} required />}
      </div>
      <label className="text-sm font-medium">{t("timetable.level")}
        <select className={field} value={d.level} onChange={(e) => { set("level", Number(e.target.value) as Level); set("sectionIds", []); if (!isCustom) set("courseName", ""); }}>
          {LEVELS.map((l) => <option key={l} value={l}>{t("level", { n: l })}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">{t("form.type")}
        <select className={field} value={d.sessionType} onChange={(e) => set("sessionType", e.target.value as TimetableDraft["sessionType"])}>
          {SESSION_TYPES.map((s) => <option key={s} value={s}>{t(`session.${s}`)}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">{t("form.day")}
        <select className={field} value={d.day} onChange={(e) => set("day", e.target.value as TimetableDraft["day"])}>
          {DAYS.map((x) => <option key={x} value={x}>{t(`day.${x}`)}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">{t("form.slot")}
        <select className={field} value={slotId} onChange={(e) => {
          const s = DEFAULT_TIME_SLOTS.find((x) => x.id === e.target.value);
          if (s) { set("startMinutes", s.start); set("endMinutes", s.end); }
        }}>
          {DEFAULT_TIME_SLOTS.map((s) => <option key={s.id} value={s.id}>{t(`slot.${s.id}`)}: {rangeLabel(s.start, s.end)}</option>)}
          <option value="custom">{t("form.custom")}</option>
        </select>
      </label>
      <label className="text-sm font-medium">{t("form.start")}
        <input type="time" className={field} value={toHHMM(d.startMinutes)} onChange={(e) => e.target.value && set("startMinutes", fromHHMM(e.target.value))} />
      </label>
      <label className="text-sm font-medium">{t("form.end")}
        <input type="time" className={field} value={toHHMM(d.endMinutes)} onChange={(e) => e.target.value && set("endMinutes", fromHHMM(e.target.value))} />
      </label>
      <div>
        <label className="text-sm font-medium">{t("form.instructor")}
          <select className={field} value={d.instructorId ?? ""} onChange={(e) => set("instructorId", e.target.value || null)}>
            <option value="">{t("common.none")}</option>
            {refs.faculty.map((f) => <option key={f.id} value={f.id}>{f.fullName}</option>)}
          </select>
        </label>
        {isSuper && <QuickAdd kind="instructor" onAdded={async (id) => { await refs.reload(); set("instructorId", id); }} />}
      </div>
      <div>
        <label className="text-sm font-medium">{t("form.room")}
          <select className={field} value={d.classroomId ?? ""} onChange={(e) => set("classroomId", e.target.value || null)}>
            <option value="">{t("common.none")}</option>
            {refs.classrooms.map((c) => <option key={c.id} value={c.id}>{c.name}{c.building ? ` (${c.building})` : ""}</option>)}
          </select>
        </label>
        {isSuper && <QuickAdd kind="classroom" onAdded={async (id) => { await refs.reload(); set("classroomId", id); }} />}
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium">{t("form.sectionsOf", { level: t("level", { n: d.level }) })} {d.sessionType === "lecture" && <span className="font-normal text-slate-500">{t("form.wholeLevel")}</span>}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {levelSections.length === 0 && <p className="text-sm text-amber-700">{t("form.noSections")}</p>}
          {levelSections.map((s) => (
            <label key={s.id} className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-700">
              <input type="checkbox" checked={d.sectionIds.includes(s.id)}
                onChange={(e) => set("sectionIds", e.target.checked ? [...d.sectionIds, s.id] : d.sectionIds.filter((x) => x !== s.id))} />
              {s.name}
            </label>
          ))}
        </div>
        <div className="mt-1 flex gap-3 text-xs">
          <button type="button" className="underline" onClick={() => set("sectionIds", levelSections.map((s) => s.id))}>{t("form.selectAll")}</button>
          <button type="button" className="underline" onClick={() => set("sectionIds", [])}>{t("form.clear")}</button>
        </div>
      </fieldset>
      <label className="text-sm font-medium sm:col-span-2">{t("form.notes")}
        <textarea className={field} rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>

      {errors.length > 0 && <ul role="alert" className="list-disc ps-5 text-sm text-red-600 sm:col-span-2">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      {conflicts.length > 0 && (
        <div role="alert" className="rounded-md border border-red-400 bg-red-50 p-3 text-sm text-red-900 sm:col-span-2">
          <p className="font-medium"><span aria-hidden="true">⚠ </span>{t("conflict.title")}</p>
          <ul className="list-disc ps-5">{conflicts.map((c, i) => <li key={i}>{describe(c)}</li>)}</ul>
          <p className="mt-2">{t("conflict.hint")}</p>
        </div>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
        <Button type="submit" disabled={busy}>{busy ? t("form.saving") : editingId ? t("form.save") : t("form.add")}</Button>
      </div>
    </form>
  );
}

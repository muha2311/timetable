import { useMemo, useState } from "react";
import { useAuth } from "../../app/AuthProvider";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { autoAssign, availability, evaluateExam, InvigError, occupiedRooms, personKey, type Assignments, type Slot } from "../../domain/invigilation";
import { SyncConflict } from "../../domain/outbox";
import { rangeLabel } from "../../domain/time";
import { useI18n } from "../../i18n";
import { saveInvigilationCritical } from "../../services/offline/critical";
import type { Exam } from "../../types";
import type { InvigData } from "./useInvigData";

const sel = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900";
const box = "rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900";

export function ExamStaffing({ exam, data, onSaved, onCancel }: { exam: Exam; data: InvigData; onSaved: () => void; onCancel: () => void }) {
  const { t, tc } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const occ = useMemo(() => occupiedRooms(exam), [exam]);
  const baseDoc = data.invigs.get(exam.id);
  const [draft, setDraft] = useState<Assignments>(() => Object.fromEntries(occ.map((r) => [r, [baseDoc?.assignments[r]?.[0] ?? null, baseDoc?.assignments[r]?.[1] ?? null]])));
  const [busy, setBusy] = useState(false);
  const [server, setServer] = useState<InvigError["issues"] | null>(null);
  const ev = useMemo(() => evaluateExam(exam, draft, data.people, data.busy), [exam, draft, data.people, data.busy]);
  const avail = useMemo(() => availability(exam, data.people, draft, data.busy), [exam, draft, data.people, data.busy]);
  const room = (id: string) => { const c = data.refs.classrooms.find((x) => x.id === id); return c ? (c.building ? `${c.name} (${c.building})` : c.name) : id; };
  const courseName = (id: string) => tc(data.refs.courses.find((c) => c.id === id)?.name ?? id);
  const examName = (id: string) => { const e = data.exams.find((x) => x.id === id); return e ? courseName(e.courseId) : id; };
  const stamp = () => ({ assignedAt: new Date().toISOString(), assignedBy: user?.email ?? "" });
  const setSlot = (r: string, i: number, key: string) => setDraft((d) => {
    const p = data.people.get(key), slots = [...(d[r] ?? [null, null])];
    slots[i] = p ? { personId: p.id, category: p.category, ...stamp() } : null;
    return { ...d, [r]: slots };
  });
  const emptySlots = occ.length * 2 - ev.validTotal;
  const availTA = avail.available.filter((p) => p.category === "TA").length, availAdmin = avail.available.length - availTA;
  const projected = Math.max(0, emptySlots - avail.available.length);
  const auto = () => { const r = autoAssign(exam, draft, data.people, data.busy, data.workload, { at: stamp().assignedAt, user: stamp().assignedBy }); setDraft(r.assignments); toast.success(t("inv.autoDone", { n: r.filled, s: r.shortage })); };

  async function save() {
    setBusy(true); setServer(null);
    try {
      const clean: Assignments = Object.fromEntries(occ.map((r) => [r, draft[r] ?? [null, null]]));
      const r = await saveInvigilationCritical(exam.id, clean, courseName(exam.courseId), baseDoc?.updatedAt?.getTime() ?? null);
      toast.success(t(r === "queued" ? "sync.savedOffline" : "inv.saved")); onSaved();
    } catch (e) {
      if (e instanceof InvigError) setServer(e.issues); else if (e instanceof SyncConflict) toast.error(t("sync.modifiedElsewhere")); else toast.error(t("form.saveFailed"));
    } finally { setBusy(false); }
  }
  const slotView = (r: string, i: number, slot: Slot | null) => {
    const info = ev.rooms.find((x) => x.roomId === r)?.slots[i];
    const others = availability(exam, data.people, { ...draft, [r]: (draft[r] ?? [null, null]).map((s, k) => (k === i ? null : s)) }, data.busy).available;
    const list = slot && !others.some((p) => personKey(slot) === p.key) && data.people.get(personKey(slot)) ? [...others, data.people.get(personKey(slot)) as NonNullable<ReturnType<typeof data.people.get>>] : others;
    return (
      <div key={i} className="grid gap-1">
        <div className="flex items-center gap-1">
          <select aria-label={`${room(r)} — ${t("inv.position", { n: i + 1 })}`} className={sel} value={slot ? personKey(slot) : ""} onChange={(e) => setSlot(r, i, e.target.value)}>
            <option value="">{t("inv.unassigned")}</option>
            <optgroup label={t("invCat.TA")}>{list.filter((p) => p.category === "TA").map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</optgroup>
            <optgroup label={t("invCat.ADMIN")}>{list.filter((p) => p.category === "ADMIN").map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</optgroup>
          </select>
          {slot && <Button variant="secondary" onClick={() => setSlot(r, i, "")} aria-label={t("inv.remove")}>✕</Button>}
        </div>
        {info && info.issues.length > 0 && <ul className="text-xs text-red-800">{info.issues.map((c) => <li key={c}>⛔ {t(`slotIssue.${c}`)}{c === "busy_elsewhere" ? ` (${info.busyWith.map(examName).join(", ")})` : ""}</li>)}</ul>}
      </div>);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="grid content-start gap-3">
        <p className="text-sm" dir="auto"><b>{courseName(exam.courseId)}</b> · <span dir="ltr">{exam.date}</span> · {rangeLabel(exam.startMinutes, exam.endMinutes)}</p>
        {occ.length === 0 && <p className="text-sm text-slate-500">{t("inv.noRooms")}</p>}
        {occ.map((r) => { const st = ev.rooms.find((x) => x.roomId === r)?.status ?? "incomplete"; return (
          <div key={r} className={box}>
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold" dir="auto">{t("inv.roomN", { name: room(r) })}</h3>
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${st === "complete" ? "bg-emerald-100 text-emerald-900" : st === "invalid" ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900"}`}>{st === "complete" ? "✓" : st === "invalid" ? "⛔" : "…"} {t(`inv.room.${st}`)}</span></div>
            <div className="grid gap-2 sm:grid-cols-2">{[0, 1].map((i) => slotView(r, i, draft[r]?.[i] ?? null))}</div>
          </div>); })}
        {server && <div role="alert" className="rounded-md border border-red-400 bg-red-50 p-3 text-sm text-red-900"><p className="font-medium">⚠ {t("inv.serverRejected")}</p><ul className="list-disc ps-5">{server.map((x, k) => <li key={k}>{room(x.roomId)} #{x.slot + 1}: {x.issues.map((c) => t(`slotIssue.${c}`)).join(", ")}</li>)}</ul></div>}
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2"><Button variant="secondary" onClick={auto} disabled={occ.length === 0}>{t("inv.autoAssign")}</Button><Button variant="secondary" onClick={() => setDraft(Object.fromEntries(occ.map((r) => [r, [null, null]])))}>{t("inv.clearAll")}</Button></div>
          <div className="flex gap-2"><Button variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button><Button onClick={() => void save()} disabled={busy || ev.hasInvalid}>{busy ? t("form.saving") : t("common.save")}</Button></div>
        </div>
      </div>
      <aside className="grid content-start gap-3" aria-label={t("inv.shortage")}>
        <div className={`${box} text-sm`} aria-live="polite">
          <dl className="grid grid-cols-[1fr_auto] gap-y-1">
            <dt>{t("inv.occupiedRooms")}</dt><dd dir="ltr">{ev.occupied}</dd><dt>{t("inv.required")}</dt><dd dir="ltr">{ev.required}</dd>
            <dt>{t("inv.assignedTA")}</dt><dd dir="ltr">{ev.assignedTA}</dd><dt>{t("inv.assignedAdmin")}</dt><dd dir="ltr">{ev.assignedAdmin}</dd>
            <dt>{t("inv.totalAssigned")}</dt><dd dir="ltr">{ev.validTotal}</dd>
            <dt className={ev.shortage ? "font-semibold text-red-800" : "font-semibold text-emerald-800"}>{t("inv.shortage")}</dt><dd dir="ltr" className={ev.shortage ? "font-semibold text-red-800" : "font-semibold text-emerald-800"}>{ev.shortage}</dd>
            <dt>{t("inv.fullStaffedRooms")}</dt><dd dir="ltr">{ev.completeRooms}</dd><dt>{t("inv.incompleteRooms")}</dt><dd dir="ltr">{ev.incompleteRooms}</dd>
          </dl>
        </div>
        <div className={`${box} text-sm`}>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1"><dt>{t("inv.availableTA")}</dt><dd dir="ltr">{availTA}</dd><dt>{t("inv.availableAdmin")}</dt><dd dir="ltr">{availAdmin}</dd><dt>{t("inv.totalAvailable")}</dt><dd dir="ltr">{avail.available.length}</dd>
            <dt className="font-medium">{t("inv.projected")}</dt><dd dir="ltr" className="font-medium">{projected}</dd></dl>
          <p className="mt-1 text-xs text-slate-500">{t("inv.priorityNote")}</p>
        </div>
        {avail.unavailable.length > 0 && <details className={`${box} text-sm`}><summary className="cursor-pointer font-medium">{t("inv.unavailable")} ({avail.unavailable.length})</summary>
          <ul className="mt-1 grid gap-0.5 text-xs">{avail.unavailable.map((u) => <li key={u.person.key} dir="auto">{u.person.name} <span className="text-slate-500">({t(`invCat.${u.person.category}`)}) — {u.reason === "inactive" ? t("inv.inactive") : t("inv.busyWith", { course: u.busyWith.map(examName).join(", ") })}</span></li>)}</ul></details>}
      </aside>
    </div>
  );
}

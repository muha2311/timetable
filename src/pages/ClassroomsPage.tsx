import { useMemo, useState, type FormEvent } from "react";
import { useDebounced } from "../hooks/useDebounced";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { useRefData } from "../features/timetable/useRefData";
import { useAuth } from "../app/AuthProvider";
import { useI18n } from "../i18n";
import { createClassroom, deleteClassroom, InUseError, updateClassroom } from "../repositories/refData";
import type { Classroom } from "../types";

const field = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const th = "px-3 py-2 text-start font-semibold";
const NONE = "__none";

function ClassroomForm({ initial, onSaved, onCancel }: { initial: Classroom | null; onSaved: () => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [building, setBuilding] = useState(initial?.building ?? "");
  const [capacity, setCapacity] = useState(initial?.capacity != null ? String(initial.capacity) : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr(t("form.nameRequired")); return; }
    const cap = capacity.trim() === "" ? null : Number(capacity);
    if (cap !== null && !(Number.isInteger(cap) && cap > 0)) { setErr(t("classrooms.capacityInvalid")); return; }
    setBusy(true); setErr("");
    try {
      if (initial) await updateClassroom(initial.id, { name, building, capacity: cap, notes });
      else await createClassroom(name, building, { capacity: cap, notes });
      toast.success(t("classrooms.saved"));
      await onSaved();
    } catch (ex) { setErr(t(ex instanceof Error ? ex.message : "faculty.failed")); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">{t("form.roomName")}<input className={field} value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <label className="text-sm font-medium">{t("form.building")}<input className={field} value={building} onChange={(e) => setBuilding(e.target.value)} /></label>
      <label className="text-sm font-medium">{t("classrooms.capacity")}<input className={field} type="number" min={1} step={1} inputMode="numeric" dir="ltr" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
      <label className="text-sm font-medium sm:col-span-2">{t("form.notes")}<textarea className={field} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      {err && <p role="alert" className="text-sm text-red-600 sm:col-span-2"><span aria-hidden="true">⚠ </span>{err}</p>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
        <Button type="submit" disabled={busy}>{busy ? t("form.saving") : t("common.save")}</Button>
      </div>
    </form>
  );
}

export function ClassroomsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { isSuper } = useAuth(); // regular users can view but not change reference data (also enforced by Firestore rules)
  const refs = useRefData();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const [building, setBuilding] = useState("");
  const [editing, setEditing] = useState<Classroom | "new" | null>(null);
  const [toDelete, setToDelete] = useState<Classroom | null>(null);
  const [busy, setBusy] = useState(false);
  const buildings = useMemo(() => [...new Set(refs.classrooms.map((c) => c.building).filter((b): b is string => !!b))].sort(), [refs.classrooms]);
  const rows = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return refs.classrooms.filter((c) => (!building || (building === NONE ? !c.building : c.building === building)) && (!s || `${c.name} ${c.building ?? ""}`.toLowerCase().includes(s)));
  }, [refs.classrooms, dq, building]);

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    try { await deleteClassroom(toDelete.id); toast.success(t("classrooms.deleted")); setToDelete(null); await refs.reload(); }
    catch (ex) { toast.error(ex instanceof InUseError ? t("classrooms.inUse", { n: ex.count }) : t(ex instanceof Error && ex.message.startsWith("error.") ? ex.message : "faculty.failed")); setToDelete(null); }
    finally { setBusy(false); }
  }
  const input = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
  return (
    <>
      <PageHeader title={t("nav.classrooms")} description={t("classrooms.description")} action={isSuper ? <Button onClick={() => setEditing("new")}>+ {t("classrooms.add")}</Button> : undefined} />
      {refs.error && <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {t("refs.loadFailed")}</p>}
      <div className="mb-4 flex flex-wrap gap-3">
        <input className={`${input} w-64`} type="search" placeholder={t("common.search")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={input} aria-label={t("col.building")} value={building} onChange={(e) => setBuilding(e.target.value)}>
          <option value="">{t("classrooms.allBuildings")}</option>{buildings.map((b) => <option key={b}>{b}</option>)}<option value={NONE}>{t("classrooms.noBuilding")}</option>
        </select>
      </div>
      {refs.loading ? <p className="text-sm text-slate-500" role="status">{t("common.loading")}</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-slate-100 dark:bg-slate-800"><tr><th className={th}>{t("col.name")}</th><th className={th}>{t("col.building")}</th><th className={th}>{t("col.capacity")}</th><th className={th}>{t("col.notes")}</th><th className={th}><span className="sr-only">{t("col.actions")}</span></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">{t("classrooms.empty")}</td></tr>}
              {rows.map((c) => (
                <tr key={c.id} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="px-3 py-2 font-medium">{c.name}</td><td className="px-3 py-2">{c.building || "—"}</td>
                  <td className="px-3 py-2">{c.capacity != null ? c.capacity : <span className="text-slate-400">{t("common.notSet")}</span>}</td>
                  <td className="px-3 py-2">{c.notes || "—"}</td>
                  <td className="px-3 py-2"><div className="flex justify-end gap-2">
                    {isSuper && <Button variant="secondary" onClick={() => setEditing(c)}>{t("common.edit")}</Button>}
                    {isSuper && <Button variant="danger" onClick={() => setToDelete(c)}>{t("common.delete")}</Button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={editing !== null} title={editing === "new" ? t("classrooms.add") : t("classrooms.edit")} onClose={() => setEditing(null)}>
        {editing !== null && <ClassroomForm initial={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await refs.reload(); }} />}
      </Modal>
      <ConfirmDialog open={toDelete !== null} title={t("classrooms.deleteTitle")} busy={busy} message={t("classrooms.deleteMessage", { name: toDelete?.name ?? "" })} onConfirm={() => void confirmDelete()} onCancel={() => setToDelete(null)} />
    </>
  );
}

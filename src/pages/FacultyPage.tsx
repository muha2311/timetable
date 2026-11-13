import { useMemo, useState, type FormEvent } from "react";
import { useDebounced } from "../hooks/useDebounced";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { ROLES, type Role } from "../domain/constants";
import { useRefData } from "../features/timetable/useRefData";
import { useAuth } from "../app/AuthProvider";
import { useI18n } from "../i18n";
import { createFaculty, deleteFaculty, InUseError, updateFaculty } from "../repositories/refData";
import type { FacultyMember } from "../types";

const field = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const th = "px-3 py-2 text-start font-semibold";

function FacultyForm({ initial, onSaved, onCancel }: { initial: FacultyMember | null; onSaved: () => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [role, setRole] = useState<Role>(initial?.role ?? "Professor");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [active, setActive] = useState(initial?.isActive !== false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) { setErr(t("form.nameRequired")); return; }
    setBusy(true); setErr("");
    try {
      if (initial) await updateFaculty(initial.id, { fullName, role, department, notes, isActive: active });
      else await createFaculty(fullName, role, { department, notes, isActive: active });
      toast.success(t("faculty.saved"));
      await onSaved();
    } catch (ex) { setErr(t(ex instanceof Error ? ex.message : "faculty.failed")); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3">
      <label className="text-sm font-medium">{t("form.fullName")}<input className={field} value={fullName} onChange={(e) => setFullName(e.target.value)} required /></label>
      <label className="text-sm font-medium">{t("form.role")}
        <select className={field} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select>
      </label>
      <label className="text-sm font-medium">{t("faculty.department")}<input className={field} value={department} onChange={(e) => setDepartment(e.target.value)} /></label>
      <label className="text-sm font-medium">{t("form.notes")}<textarea className={field} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t("faculty.active")}</label>
      {err && <p role="alert" className="text-sm text-red-600"><span aria-hidden="true">⚠ </span>{err}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
        <Button type="submit" disabled={busy}>{busy ? t("form.saving") : t("common.save")}</Button>
      </div>
    </form>
  );
}

export function FacultyPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { isSuper } = useAuth(); // regular users can view but not change reference data (also enforced by Firestore rules)
  const refs = useRefData();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const [role, setRole] = useState("");
  const [editing, setEditing] = useState<FacultyMember | "new" | null>(null);
  const [toDelete, setToDelete] = useState<FacultyMember | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => {
    const s = dq.trim().toLowerCase();
    return refs.faculty.filter((f) => (!role || f.role === role) && (!s || `${f.fullName} ${f.department ?? ""}`.toLowerCase().includes(s)));
  }, [refs.faculty, dq, role]);

  async function confirmDelete() {
    if (!toDelete) return;
    setBusy(true);
    try { await deleteFaculty(toDelete.id); toast.success(t("faculty.deleted")); setToDelete(null); await refs.reload(); }
    catch (ex) { toast.error(ex instanceof InUseError ? t("faculty.inUse", { n: ex.count }) : t(ex instanceof Error && ex.message.startsWith("error.") ? ex.message : "faculty.failed")); setToDelete(null); }
    finally { setBusy(false); }
  }
  const input = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
  return (
    <>
      <PageHeader title={t("nav.faculty")} description={t("faculty.description")} action={isSuper ? <Button onClick={() => setEditing("new")}>+ {t("faculty.add")}</Button> : undefined} />
      {refs.error && <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {t("refs.loadFailed")}</p>}
      <div className="mb-4 flex flex-wrap gap-3">
        <input className={`${input} w-64`} type="search" placeholder={t("common.search")} aria-label={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={input} aria-label={t("form.role")} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{t("faculty.allRoles")}</option>{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
        </select>
      </div>
      {refs.loading ? <p className="text-sm text-slate-500" role="status">{t("common.loading")}</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-slate-100 dark:bg-slate-800"><tr><th className={th}>{t("col.name")}</th><th className={th}>{t("col.role")}</th><th className={th}>{t("col.department")}</th><th className={th}>{t("col.notes")}</th><th className={th}><span className="sr-only">{t("col.actions")}</span></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">{t("faculty.empty")}</td></tr>}
              {rows.map((f) => (
                <tr key={f.id} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="px-3 py-2 font-medium">{f.fullName}</td><td className="px-3 py-2">{t(`role.${f.role}`)}</td>
                  <td className="px-3 py-2">{f.department || "—"}</td><td className="px-3 py-2">{f.notes || "—"}</td>
                  <td className="px-3 py-2"><div className="flex justify-end gap-2">
                    {isSuper && <Button variant="secondary" onClick={() => setEditing(f)}>{t("common.edit")}</Button>}
                    {isSuper && <Button variant="danger" onClick={() => setToDelete(f)}>{t("common.delete")}</Button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={editing !== null} title={editing === "new" ? t("faculty.add") : t("faculty.edit")} onClose={() => setEditing(null)}>
        {editing !== null && <FacultyForm initial={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await refs.reload(); }} />}
      </Modal>
      <ConfirmDialog open={toDelete !== null} title={t("faculty.deleteTitle")} busy={busy} message={t("faculty.deleteMessage", { name: toDelete?.fullName ?? "" })} onConfirm={() => void confirmDelete()} onCancel={() => setToDelete(null)} />
    </>
  );
}

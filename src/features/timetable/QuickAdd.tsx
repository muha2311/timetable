import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { useI18n } from "../../i18n";
import { ROLES, type Role } from "../../domain/constants";
import { createClassroom, createFaculty } from "../../repositories/refData";

const input = "rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900";

/** Adds a real record to facultyMembers / classrooms without leaving the session form. */
export function QuickAdd({ kind, onAdded }: { kind: "instructor" | "classroom"; onAdded: (id: string) => Promise<void> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [extra, setExtra] = useState<string>(kind === "instructor" ? ROLES[0] : "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim()) { setErr(t("form.nameRequired")); return; }
    setBusy(true); setErr("");
    try {
      const id = kind === "instructor" ? await createFaculty(name, extra as Role) : await createClassroom(name, extra);
      await onAdded(id);
      setOpen(false); setName("");
    } catch (e) { setErr(t(e instanceof Error ? e.message : "error.generic")); }
    finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="mt-1 text-xs text-brand-600 underline" onClick={() => setOpen(true)}>{t(kind === "instructor" ? "form.newInstructor" : "form.newClassroom")}</button>;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}>
      <input className={input} placeholder={kind === "instructor" ? t("form.fullName") : t("form.roomName")} aria-label={t("form.name")} value={name} onChange={(e) => setName(e.target.value)} />
      {kind === "instructor"
        ? <select className={input} aria-label={t("form.role")} value={extra} onChange={(e) => setExtra(e.target.value)}>{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</select>
        : <input className={input} placeholder={t("form.building")} aria-label={t("form.building")} value={extra} onChange={(e) => setExtra(e.target.value)} />}
      <Button type="button" onClick={() => void add()} disabled={busy}>{busy ? t("common.adding") : t("common.add")}</Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
      {err && <p role="alert" className="w-full text-xs text-red-600">{err}</p>}
    </div>
  );
}

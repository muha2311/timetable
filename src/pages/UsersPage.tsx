import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { useAuth } from "../app/AuthProvider";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Modal } from "../components/ui/Modal";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { APP_ROLES, type AppRole } from "../domain/constants";
import { useI18n } from "../i18n";
import { useSyncStatus } from "../services/offline/sync";
import { invalidate } from "../repositories/cache";
import { listUsers } from "../repositories/usersRepo";
import { ApiError, createUserApi, setupLinkApi, updateUserApi, type CreatedUser } from "../services/usersApi";
import { auth } from "../services/firebase/init";
import type { UserProfile } from "../types";

const field = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const th = "px-3 py-2 text-start font-semibold";
type Pending = { user: UserProfile; kind: "role"; role: AppRole } | { user: UserProfile; kind: "status"; isActive: boolean };

export function UsersPage() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const { online } = useSyncStatus();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const [detail, setDetail] = useState<UserProfile | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force: boolean) => {
    setLoading(true); setError(false);
    try { setUsers(await listUsers(force)); } catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(false); }, [load]);

  const fmt = useMemo(() => new Intl.DateTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" }), [lang]);
  const when = (d: Date | null) => (d ? fmt.format(d) : "—");
  const errText = (e: unknown) => (e instanceof ApiError ? t(`usersErr.${["email_exists", "last_super_admin", "validation", "forbidden", "unauthenticated", "network", "not_found", "profile_failed"].includes(e.code) ? e.code : "generic"}`) : t("usersErr.generic"));

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await updateUserApi(pending.kind === "role" ? { uid: pending.user.uid, role: pending.role } : { uid: pending.user.uid, isActive: pending.isActive });
      invalidate("data:users"); toast.success(t("users.updated")); setPending(null); await load(true);
    } catch (e) { toast.error(errText(e)); setPending(null); } finally { setBusy(false); }
  }
  const msg = pending?.kind === "role" ? t("users.confirmRole", { name: pending.user.fullName, role: t(`appRole.${pending.role}`) })
    : pending ? t(pending.isActive ? "users.confirmEnable" : "users.confirmDisable", { name: pending.user.fullName }) : "";
  const activeSupers = users.filter((u) => u.role === "SUPER_ADMIN" && u.isActive).length;

  return (
    <>
      <PageHeader title={t("nav.users")} description={t("users.description")} action={<Button onClick={() => setCreating(true)} disabled={!online}>+ {t("users.create")}</Button>} />
      {error && <p role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">⚠ {t("students.loadFailed")}</p>}
      {loading ? <p className="text-sm text-slate-500" role="status">{t("common.loading")}</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-slate-100 dark:bg-slate-800"><tr><th className={th}>{t("col.name")}</th><th className={th}>{t("auth.email")}</th><th className={th}>{t("col.role")}</th><th className={th}>{t("col.status")}</th><th className={th}>{t("users.createdAt")}</th><th className={th}>{t("users.lastLogin")}</th><th className={th}><span className="sr-only">{t("col.actions")}</span></th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.uid} className="border-t border-slate-200 dark:border-slate-700">
                <td className="px-3 py-2 font-medium" dir="auto">{u.fullName}{u.uid === me?.uid && <span className="ms-1 text-xs text-slate-500">({t("users.you")})</span>}</td>
                <td className="px-3 py-2" dir="ltr">{u.email}</td><td className="px-3 py-2">{t(`appRole.${u.role}`)}</td>
                <td className="px-3 py-2">{u.isActive ? `✓ ${t("users.active")}` : `⛔ ${t("users.disabled")}`}</td>
                <td className="px-3 py-2">{when(u.createdAt)}</td><td className="px-3 py-2">{when(u.lastLoginAt)}</td>
                <td className="px-3 py-2"><div className="flex flex-wrap justify-end gap-1">
                  <Button variant="secondary" onClick={() => setDetail(u)}>{t("common.view")}</Button>
                  <Button variant="secondary" onClick={() => setPending({ user: u, kind: "role", role: u.role === "SUPER_ADMIN" ? "USER" : "SUPER_ADMIN" })} disabled={u.role === "SUPER_ADMIN" && u.isActive && activeSupers <= 1}>{u.role === "SUPER_ADMIN" ? t("users.makeUser") : t("users.makeSuper")}</Button>
                  <Button variant={u.isActive ? "danger" : "secondary"} onClick={() => setPending({ user: u, kind: "status", isActive: !u.isActive })} disabled={u.role === "SUPER_ADMIN" && u.isActive && activeSupers <= 1}>{u.isActive ? t("users.disable") : t("users.enable")}</Button>
                </div></td></tr>))}</tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">{t("users.lastSuperNote")}</p>

      <Modal open={creating} title={t("users.create")} onClose={() => setCreating(false)}>
        {creating && <CreateForm onCancel={() => setCreating(false)} onDone={(c) => { setCreating(false); setCreated(c); invalidate("data:users"); void load(true); }} errText={errText} />}
      </Modal>
      <Modal open={created !== null} title={t("users.createdTitle")} onClose={() => setCreated(null)}>{created && <SetupInfo user={created} onClose={() => setCreated(null)} errText={errText} />}</Modal>
      <Modal open={detail !== null} title={t("users.details")} onClose={() => setDetail(null)}>
        {detail && (
          <div className="grid gap-3 text-sm">
            <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5">
              <dt className="text-slate-500">{t("col.name")}</dt><dd dir="auto">{detail.fullName}</dd><dt className="text-slate-500">{t("auth.email")}</dt><dd dir="ltr">{detail.email}</dd>
              <dt className="text-slate-500">UID</dt><dd dir="ltr" className="break-all">{detail.uid}</dd><dt className="text-slate-500">{t("col.role")}</dt><dd>{t(`appRole.${detail.role}`)}</dd>
              <dt className="text-slate-500">{t("col.status")}</dt><dd>{detail.isActive ? t("users.active") : t("users.disabled")}</dd>
              <dt className="text-slate-500">{t("users.createdAt")}</dt><dd>{when(detail.createdAt)}</dd><dt className="text-slate-500">{t("users.lastLogin")}</dt><dd>{when(detail.lastLoginAt)}</dd>
            </dl>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => void setupLinkApi(detail.uid).then((r) => { setDetail(null); setCreated({ uid: detail.uid, email: detail.email, fullName: detail.fullName, role: detail.role, isActive: detail.isActive, setupLink: r.setupLink }); }).catch((e) => toast.error(errText(e)))}>{t("users.newLink")}</Button><Button onClick={() => setDetail(null)}>{t("common.close")}</Button></div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={pending !== null} title={t("users.confirmTitle")} message={msg} confirmLabel={t("common.continue")} busy={busy} onConfirm={() => void confirm()} onCancel={() => setPending(null)} />
    </>
  );
}

function CreateForm({ onCancel, onDone, errText }: { onCancel: () => void; onDone: (c: CreatedUser) => void; errText: (e: unknown) => string }) {
  const { t } = useI18n();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("USER");
  const [isActive, setIsActive] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2) { setErr(t("form.nameRequired")); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setErr(t("usersErr.validation")); return; }
    setBusy(true); setErr("");
    try { onDone(await createUserApi({ fullName: fullName.trim(), email: email.trim(), role, isActive })); } catch (ex) { setErr(errText(ex)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3">
      <label className="text-sm font-medium">{t("form.fullName")}<input className={field} value={fullName} onChange={(e) => setFullName(e.target.value)} required /></label>
      <label className="text-sm font-medium">{t("auth.email")}<input type="email" dir="ltr" className={field} value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label className="text-sm font-medium">{t("col.role")}<select className={field} value={role} onChange={(e) => setRole(e.target.value as AppRole)}>{APP_ROLES.map((r) => <option key={r} value={r}>{t(`appRole.${r}`)}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />{t("users.activeOnCreate")}</label>
      <p className="text-xs text-slate-500">{t("users.noPasswordNote")}</p>
      {err && <p role="alert" className="text-sm text-red-600">⚠ {err}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button><Button type="submit" disabled={busy}>{busy ? t("form.saving") : t("users.create")}</Button></div>
    </form>
  );
}

function SetupInfo({ user, onClose, errText }: { user: CreatedUser; onClose: () => void; errText: (e: unknown) => string }) {
  const { t } = useI18n();
  const toast = useToast();
  return (
    <div className="grid gap-3 text-sm">
      <p>✓ {t("users.createdOk", { name: user.fullName, role: t(`appRole.${user.role}`) })}</p>
      <p className="text-slate-600 dark:text-slate-400">{t("users.setupExplain")}</p>
      {user.setupLink ? (
        <>
          <input readOnly dir="ltr" aria-label={t("users.setupLink")} className={field} value={user.setupLink} onFocus={(e) => e.currentTarget.select()} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(user.setupLink ?? "").then(() => toast.success(t("users.copied")))}>{t("users.copyLink")}</Button>
            <Button variant="secondary" onClick={() => { if (auth) void sendPasswordResetEmail(auth, user.email).then(() => toast.success(t("users.emailSent"))).catch((e) => toast.error(errText(e))); }}>{t("users.sendEmail")}</Button>
          </div>
        </>
      ) : <p className="text-amber-700">⚠ {t("users.noLink")}</p>}
      <div className="flex justify-end"><Button onClick={onClose}>{t("common.close")}</Button></div>
    </div>
  );
}

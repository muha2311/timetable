import { useEffect, useState, type ChangeEvent } from "react";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../components/ui/Toast";
import { useI18n } from "../i18n";
import { EMPTY_INSTITUTION, getInstitution, saveInstitution } from "../repositories/settingsRepo";
import type { Institution } from "../types";

const field = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const card = "rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900";

/** Logos are resized in the browser (max 256 px) and stored as small data URLs in settings/institution (no Storage bucket needed). */
async function fileToLogo(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error("settings.logoInvalid");
  const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("settings.logoInvalid")); r.readAsDataURL(file); });
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("settings.logoInvalid")); i.src = url; });
  const w = img.width || 256, h = img.height || 256, k = Math.min(1, 256 / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  const out = c.toDataURL("image/png");
  if (out.length > 300_000) throw new Error("settings.logoTooLarge");
  return out;
}

export function SettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<Institution>(EMPTY_INSTITUTION);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getInstitution(true).then(setV).catch(() => toast.error(t("students.loadFailed"))).finally(() => setLoading(false)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const set = (k: keyof Institution) => (e: ChangeEvent<HTMLInputElement>) => setV((p) => ({ ...p, [k]: e.target.value }));
  async function pick(k: "universityLogo" | "facultyLogo", e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try { const logo = await fileToLogo(f); setV((p) => ({ ...p, [k]: logo })); } catch (ex) { toast.error(t(ex instanceof Error ? ex.message : "settings.logoInvalid")); }
  }
  async function save() { setBusy(true); try { await saveInstitution(v); toast.success(t("settings.saved")); } catch { toast.error(t("settings.saveFailed")); } finally { setBusy(false); } }
  const text = (en: keyof Institution, ar: keyof Institution, label: string) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-medium">{label} — {t("settings.en")}<input className={field} dir="ltr" value={v[en]} onChange={set(en)} /></label>
      <label className="text-sm font-medium">{label} — {t("settings.ar")}<input className={field} dir="rtl" value={v[ar]} onChange={set(ar)} /></label>
    </div>);
  const logo = (k: "universityLogo" | "facultyLogo", label: string) => (
    <div className="flex items-center gap-3">
      <div className="flex h-20 w-20 items-center justify-center rounded border border-slate-300 bg-white">{v[k] ? <img src={v[k]} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-400">—</span>}</div>
      <div className="text-sm font-medium"><div>{label}</div>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label={`${label}: ${t("settings.upload")}`} onChange={(e) => void pick(k, e)} className="mt-1 block text-xs" />
        {v[k] && <button type="button" className="mt-1 text-xs text-red-700 underline" onClick={() => setV((p) => ({ ...p, [k]: "" }))}>{t("settings.remove")}</button>}</div>
    </div>);
  return (
    <>
      <PageHeader title={t("nav.settings")} description={t("settings.description")} />
      {loading ? <p className="text-sm text-slate-500" role="status">{t("common.loading")}</p> : (
        <div className={`${card} grid gap-4`}>
          <div className="grid gap-4 sm:grid-cols-2">{logo("universityLogo", t("settings.universityLogo"))}{logo("facultyLogo", t("settings.facultyLogo"))}</div>
          {text("universityNameEn", "universityNameAr", t("settings.universityName"))}
          {text("facultyNameEn", "facultyNameAr", t("settings.facultyName"))}
          {text("headerEn", "headerAr", t("settings.header"))}
          {text("footerEn", "footerAr", t("settings.footer"))}
          <div><Button onClick={() => void save()} disabled={busy}>{busy ? t("form.saving") : t("common.save")}</Button></div>
        </div>
      )}
    </>
  );
}

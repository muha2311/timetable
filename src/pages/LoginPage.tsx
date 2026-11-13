import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../app/AuthProvider";
import { Button } from "../components/ui/Button";
import { LanguageSwitcher } from "../components/ui/LanguageSwitcher";
import { useI18n } from "../i18n";
import { isFirebaseConfigured } from "../services/firebase/init";

export function LoginPage() {
  const { user, signIn } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await signIn(email, password); }
    catch { setError(t("auth.failed")); }
    finally { setBusy(false); }
  }
  const input = "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-brand-50 p-4 dark:bg-slate-950">
      <div className="flex w-full max-w-sm justify-end"><LanguageSwitcher /></div>
      <form onSubmit={(e) => void onSubmit(e)} className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-md dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-brand-900 font-bold text-white" aria-hidden="true">CS</span>
          <h1 className="text-xl font-semibold">{t("app.name")}</h1>
          <p className="text-sm text-slate-500">{t("app.org")}</p>
        </div>
        {!isFirebaseConfigured && <p role="alert" className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{t("auth.notConfigured")}</p>}
        <label className="block text-sm font-medium">{t("auth.email")}
          <input type="email" required autoComplete="username" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        </label>
        <label className="mt-3 block text-sm font-medium">{t("auth.password")}
          <input type="password" required autoComplete="current-password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
        </label>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <Button type="submit" className="mt-5 w-full" disabled={busy || !isFirebaseConfigured}>{busy ? t("auth.signingIn") : t("auth.submit")}</Button>
      </form>
    </div>
  );
}

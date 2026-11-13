import { Button } from "../components/ui/Button";
import { LanguageSwitcher } from "../components/ui/LanguageSwitcher";
import { useAuth } from "../app/AuthProvider";
import { useI18n } from "../i18n";

export function AccessDeniedPage() {
  const { t } = useI18n();
  const { profile, logOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4">
      <LanguageSwitcher />
      <div role="alert" className="w-full max-w-md rounded-xl border border-amber-400 bg-amber-50 p-6 text-center text-amber-900">
        <h1 className="mb-2 text-lg font-semibold">⛔ {t("access.title")}</h1>
        <p className="text-sm">{profile && !profile.isActive ? t("access.disabled") : t("access.noProfile")}</p>
        <Button className="mt-4" onClick={() => void logOut()}>{t("common.signOut")}</Button>
      </div>
    </div>
  );
}

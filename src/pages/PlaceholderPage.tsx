import { PageHeader } from "../components/ui/PageHeader";
import { useI18n } from "../i18n";

export function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t(titleKey)} />
      <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">{t("placeholder.soon")}</p>
    </>
  );
}

import { useI18n } from "../../i18n";
import { Button } from "./Button";

export function Pagination({ page, pages, from, to, total, onPage }: { page: number; pages: number; from: number; to: number; total: number; onPage: (p: number) => void }) {
  const { t } = useI18n();
  if (total === 0) return null;
  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="pagination">
      <span className="text-slate-500" dir="auto">{t("common.showing", { from, to, total })}</span>
      <span className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("common.prev")}</Button>
        <span dir="auto">{t("common.pageOf", { page, pages })}</span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t("common.next")}</Button>
      </span>
    </nav>
  );
}

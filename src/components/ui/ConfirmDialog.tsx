import { useI18n } from "../../i18n";
import { Button } from "./Button";
import { Modal } from "./Modal";

export function ConfirmDialog({ open, title, message, confirmLabel, busy = false, onConfirm, onCancel }:
  { open: boolean; title: string; message: string; confirmLabel?: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="mb-6 text-sm text-slate-600 dark:text-slate-300">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>{busy ? t("common.working") : confirmLabel ?? t("common.delete")}</Button>
      </div>
    </Modal>
  );
}

import { useState } from "react";
import { useI18n } from "../../i18n";
import { clearNativeFailures } from "../../services/offline/native";
import { clearLocalData, discard, retry, useSyncStatus } from "../../services/offline/sync";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { useToast } from "./Toast";

const GLYPH = { synced: "✓", offline: "○", syncing: "⟳", pending: "…", failed: "⚠", conflict: "⛔" } as const;
const TONE = {
  synced: "border-emerald-300 text-emerald-800 dark:text-emerald-300", offline: "border-slate-400 text-slate-700 dark:text-slate-300", syncing: "border-sky-300 text-sky-800 dark:text-sky-300",
  pending: "border-amber-300 text-amber-800 dark:text-amber-300", failed: "border-red-400 text-red-800 dark:text-red-300", conflict: "border-red-500 text-red-900 dark:text-red-300",
} as const;

/** Always visible in the header. "Synced" appears only after Firestore and the outbox both report nothing left to send. */
export function SyncIndicator() {
  const s = useSyncStatus();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const waiting = s.counts.pending + s.counts.syncing + s.counts.conflict + s.counts.failed;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" title={t("sync.center")}
        className={`inline-flex items-center gap-1 rounded-md border bg-white px-3 py-2 text-sm font-medium dark:bg-slate-900 ${TONE[s.state]}`}>
        <span aria-hidden="true" className={s.state === "syncing" ? "inline-block animate-spin" : ""}>{GLYPH[s.state]}</span>
        <span>{t(`sync.state.${s.state}`, { n: waiting })}</span>
        {waiting > 0 && s.state !== "pending" && <span className="rounded-full bg-slate-200 px-1.5 text-xs text-slate-900" dir="ltr">{waiting}</span>}
      </button>
      <Modal open={open} title={t("sync.center")} onClose={() => setOpen(false)}>{open && <SyncCenter onClose={() => setOpen(false)} />}</Modal>
    </>
  );
}

function SyncCenter({ onClose }: { onClose: () => void }) {
  const s = useSyncStatus();
  const { t } = useI18n();
  const toast = useToast();
  const mine = s.ops.filter((o) => o.userUid === s.uid), others = s.ops.length - mine.length;
  return (
    <div className="grid gap-3 text-sm">
      <p className="font-medium">{t(`sync.state.${s.state}`, { n: mine.length })}</p>
      {s.state === "offline" && <p>{t("sync.offlineBanner")}</p>}
      {!s.durable && <p role="alert" className="rounded border border-amber-400 bg-amber-50 p-2 text-amber-900">⚠ {t("sync.notDurable")}</p>}
      {s.updateReady && <p className="flex items-center justify-between gap-2 rounded border border-sky-300 bg-sky-50 p-2 text-sky-900">{t("sync.updateReady")}<Button variant="secondary" onClick={() => window.location.reload()}>{t("sync.reload")}</Button></p>}
      {s.failures.length > 0 && <p role="alert" className="flex items-center justify-between gap-2 rounded border border-red-400 bg-red-50 p-2 text-red-900">⚠ {t("sync.nativeFailed", { n: s.failures.length })} ({[...new Set(s.failures)].join(", ")})<Button variant="secondary" onClick={clearNativeFailures}>{t("sync.dismiss")}</Button></p>}
      {mine.length === 0 ? <p className="text-slate-600 dark:text-slate-400">{t("sync.empty")}</p> : (
        <ul className="grid gap-2">{mine.map((o) => (
          <li key={o.id} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2"><b dir="auto">{o.label}</b><span className="text-xs">{t(`sync.op.${o.type}`)} · {t(`sync.status.${o.status}`)}{o.attempts > 0 ? ` (${o.attempts})` : ""}</span></div>
            {o.error && <p className="mt-1 text-xs text-red-800" dir="auto">⚠ {t(`sync.err.${o.error.code}`)}</p>}
            {(o.status === "conflict" || o.status === "failed") && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void retry(o.id)}>{t("sync.retry")}</Button>
                {o.error?.code === "modified_elsewhere" && <Button variant="secondary" onClick={() => void retry(o.id, true)}>{t("sync.applyMine")}</Button>}
                <Button variant="danger" onClick={() => void discard(o.id)}>{t("sync.discard")}</Button>
              </div>)}
          </li>))}</ul>)}
      {others > 0 && <p className="text-xs text-slate-500">{t("sync.otherUser", { n: others })}</p>}
      <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <Button variant="secondary" onClick={() => void clearLocalData().then((ok) => (ok ? window.location.reload() : toast.error(t("sync.clearBlocked"))))}>{t("sync.clearData")}</Button>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </div>
    </div>
  );
}

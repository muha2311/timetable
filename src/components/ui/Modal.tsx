import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ open, title, onClose, children, wide = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}
      aria-labelledby="modal-title"
      className={`w-full ${wide ? "max-w-6xl" : "max-w-2xl"} max-h-[90vh] overflow-y-auto rounded-lg bg-white p-0 shadow-xl backdrop:bg-slate-900/50 dark:bg-slate-900 dark:text-slate-100`}>
      <div className="p-6">
        <h2 id="modal-title" className="mb-4 text-lg font-semibold">{title}</h2>
        {open && children}
      </div>
    </dialog>
  );
}

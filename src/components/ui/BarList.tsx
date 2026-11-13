/** Dependency-free horizontal bar chart. Every bar also shows its number, so meaning never depends on color alone. */
export function BarList({ items, emptyText, suffix = "" }: { items: { label: string; value: number; hint?: string }[]; emptyText: string; suffix?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0 || items.every((i) => i.value === 0)) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <ul className="grid gap-1.5" role="list">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-2 text-sm">
          <span className="truncate" dir="auto" title={i.label}>{i.label}</span>
          <span className="h-3 overflow-hidden rounded bg-slate-100 dark:bg-slate-800" aria-hidden="true"><span className="block h-full rounded bg-brand-600" style={{ width: `${(i.value / max) * 100}%` }} /></span>
          <span className="tabular-nums" dir="ltr">{i.value}{suffix}{i.hint ? <span className="ms-1 text-xs text-slate-500">{i.hint}</span> : null}</span>
        </li>
      ))}
    </ul>
  );
}

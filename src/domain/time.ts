const pad = (n: number) => String(n).padStart(2, "0");
export const toHHMM = (m: number): string => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const fromHHMM = (s: string): number => {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const to12h = (m: number): string => `${Math.floor(m / 60) % 12 || 12}:${pad(m % 60)}`;
/** Index of the slot containing a start time (the latest slot starting at/before it). */
export function slotIndexFor(slots: readonly { start: number }[], start: number): number {
  let idx = 0;
  slots.forEach((s, i) => { if (s.start <= start) idx = i; });
  return idx;
}

// Wrapped in LTR isolates (U+2066/U+2069) so times keep their order inside Arabic text.
export const rangeLabel = (start: number, end: number): string => `\u2066${to12h(start)} – ${to12h(end)}\u2069`;

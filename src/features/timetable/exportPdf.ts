import type { SessionType } from "../../domain/constants";
import { BRAND_CSS, brandHeader, EMPTY_BRANDING, esc, FONT_LINK, pageRule, TABLE_CSS, type Branding } from "../exams/examPdf.ts";

export interface PdfCell { type: SessionType; badge: string; time: string; course: string; instructor: string; room: string; sections: string }
export interface PdfInput {
  lang: string; dir: "ltr" | "rtl"; title: string; meta: string[]; dayHeader: string;
  slots: { label: string; time: string }[]; rows: { dayLabel: string; cells: PdfCell[][] }[];
  legend: { type: SessionType; badge: string; label: string }[]; footer: string;
  /** Same configuration as the exam PDFs (settings/institution). */ branding?: Branding; pageLabel?: string;
}
export const TYPE_COLORS: Record<SessionType, { bg: string; accent: string }> = {
  lecture: { bg: "#fdf0c8", accent: "#f59e0b" },
  section: { bg: "#f7d56e", accent: "#a16207" },
  section_practical: { bg: "#cfd8e3", accent: "#475569" },
};

/** Weekly grid for one level, wrapped in the shared official template (logos, names, header/footer, page numbers). */
export function buildTimetableHtml(p: PdfInput): string {
  const b = p.branding ?? EMPTY_BRANDING;
  const card = (c: PdfCell) => `<div class="s" style="background:${TYPE_COLORS[c.type].bg};border-inline-start:4px solid ${TYPE_COLORS[c.type].accent}"><b class="b">${esc(c.badge)}</b> <span>${esc(c.time)}</span><div class="c">${esc(c.course)}</div>${c.instructor ? `<div class="i">${esc(c.instructor)}</div>` : ""}<div>${esc(c.sections)}${c.room ? ` · ${esc(c.room)}` : ""}</div></div>`;
  const head = `<tr><th class="d">${esc(p.dayHeader)}</th>${p.slots.map((s) => `<th>${esc(s.label)}<div class="n">${esc(s.time)}</div></th>`).join("")}</tr>`;
  const body = p.rows.map((r) => `<tr><th class="d">${esc(r.dayLabel)}</th>${r.cells.map((cell) => `<td>${cell.map(card).join("")}</td>`).join("")}</tr>`).join("");
  const legend = p.legend.map((l) => `<span style="background:${TYPE_COLORS[l.type].bg};border-inline-start:4px solid ${TYPE_COLORS[l.type].accent}"><b>${esc(l.badge)}</b> ${esc(l.label)}</span>`).join("");
  return `<!doctype html><html lang="${esc(p.lang)}" dir="${p.dir}"><head><meta charset="utf-8"><title>${esc(p.title)}</title>${FONT_LINK}
<style>${pageRule(b, p.pageLabel ?? "", "landscape", p.dir === "rtl")}${BRAND_CSS}${TABLE_CSS}table{table-layout:fixed}th.d{width:70px}.n{font-weight:400;font-size:9px}
.s{break-inside:avoid;page-break-inside:avoid;border-radius:3px;padding:3px 4px;margin-bottom:3px;font-size:9pt}.c{font-weight:700}.i{color:#991b1b}.b{background:rgba(0,0,0,.12);padding:0 3px;border-radius:2px}
.legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}.legend span{padding:2px 6px;border-radius:3px}</style></head>
<body>${brandHeader(b)}<h1>${esc(p.title)}</h1><div class="meta">${p.meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
<table><thead>${head}</thead><tbody>${body}</tbody></table><div class="legend">${legend}</div><div class="gen">${esc(p.footer)}</div></body></html>`;
}

/** Opens the browser print dialog for the HTML in a hidden iframe (choose "Save as PDF"). */
export function printHtml(html: string): void {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const w = f.contentWindow, doc = f.contentDocument;
  if (!w || !doc) { f.remove(); throw new Error("Printing is not available."); }
  doc.open(); doc.write(html); doc.close();
  const wait = doc.fonts ? Promise.race([doc.fonts.ready, new Promise((r) => setTimeout(r, 1500))]) : Promise.resolve();
  void wait.then(() => { w.focus(); w.print(); setTimeout(() => f.remove(), 1000); });
}

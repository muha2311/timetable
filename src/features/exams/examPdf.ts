import type { Institution } from "../../types";

export interface Branding { universityName: string; facultyName: string; header: string; footer: string; universityLogo: string; facultyLogo: string }
export const EMPTY_BRANDING: Branding = { universityName: "", facultyName: "", header: "", footer: "", universityLogo: "", facultyLogo: "" };
export interface DocInput {
  lang: string; dir: "ltr" | "rtl"; branding: Branding; title: string; meta: string[]; columns: string[]; rows: string[][];
  generated: string; pageLabel: string; emptyText: string; orientation?: "landscape" | "portrait"; rowColors?: (string | undefined)[];
}

/** Picks the settings (settings/institution) for the current language, falling back to the other one. Nothing is hardcoded. */
export function brandingFor(i: Institution, lang: string): Branding {
  const pick = (en: string, ar: string) => (lang === "ar" ? ar || en : en || ar);
  return { universityName: pick(i.universityNameEn, i.universityNameAr), facultyName: pick(i.facultyNameEn, i.facultyNameAr), header: pick(i.headerEn, i.headerAr), footer: pick(i.footerEn, i.footerAr),
    universityLogo: i.universityLogo, facultyLogo: i.facultyLogo };
}

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const css = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
const logo = (src: string): string => (src.startsWith("data:image/") ? `<img class="logo" alt="" src="${esc(src)}">` : `<span class="logo"></span>`);
export const FONT_LINK = '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">';

// ---- shared by EVERY official document (academic timetable and exam PDFs): same header, fonts, footer and page numbers ----
export const BRAND_CSS = `*{box-sizing:border-box}body{margin:0;font-family:Cairo,"Segoe UI",Tahoma,Arial,sans-serif;font-size:10pt;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:2px solid #184f5c;padding-bottom:8px;margin-bottom:8px}
.logo{width:64px;height:64px;object-fit:contain;display:inline-block}.names{text-align:center;flex:1}.names .u{font-size:14pt;font-weight:700}.names .f{font-size:12pt;font-weight:600}.names .h{font-size:9pt;color:#444}
h1{font-size:15pt;margin:6px 0;text-align:center}.meta{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 18px;font-weight:600;margin-bottom:8px}.gen{margin-top:6px;font-size:8pt;color:#555}`;
export const brandHeader = (b: Branding): string =>
  `<div class="head">${logo(b.universityLogo)}<div class="names">${b.universityName ? `<div class="u">${esc(b.universityName)}</div>` : ""}${b.facultyName ? `<div class="f">${esc(b.facultyName)}</div>` : ""}${b.header ? `<div class="h">${esc(b.header)}</div>` : ""}</div>${logo(b.facultyLogo)}</div>`;
/** Page size, margins, footer text and "Page X / Y" (CSS page margin boxes: Chrome/Edge 131+). */
export const pageRule = (b: Branding, pageLabel: string, orientation: "landscape" | "portrait", rtl: boolean): string =>
  `@page{size:A4 ${orientation};margin:12mm 10mm 16mm;${rtl ? "@bottom-right" : "@bottom-left"}{content:${css(b.footer)};font-size:8pt;color:#555}@bottom-center{content:${css(pageLabel)} " " counter(page) " / " counter(pages);font-size:8pt;color:#333}}`;
export const TABLE_CSS = `table{width:100%;border-collapse:collapse}th,td{border:1px solid #64748b;padding:4px 6px;vertical-align:top;text-align:start}th{background:#e2e8f0;font-weight:700}
thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}.empty{text-align:center;color:#555;padding:16px}`;

/** Generic official table document (exam schedule, student lists, timetable list). */
export function buildDocumentHtml(p: DocInput): string {
  const b = p.branding;
  const body = p.rows.length ? p.rows.map((r, i) => `<tr${p.rowColors?.[i] ? ` style="background:${esc(p.rowColors[i] as string)}"` : ""}>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${p.columns.length}" class="empty">${esc(p.emptyText)}</td></tr>`;
  return `<!doctype html><html lang="${esc(p.lang)}" dir="${p.dir}"><head><meta charset="utf-8"><title>${esc(p.title)}</title>${FONT_LINK}
<style>${pageRule(b, p.pageLabel, p.orientation ?? "landscape", p.dir === "rtl")}${BRAND_CSS}${TABLE_CSS}</style></head>
<body>${brandHeader(b)}<h1>${esc(p.title)}</h1><div class="meta">${p.meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
<table><thead><tr>${p.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table><div class="gen">${esc(p.generated)}</div></body></html>`;
}

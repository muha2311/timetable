import type { Cell, Grid } from "../../domain/studentImport";

/** Reads .xlsx or .xls in the browser (SheetJS, loaded only when needed). Returns the first non-empty sheet as rows of cells. */
export async function readGrid(file: File): Promise<Grid> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const g = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, blankrows: false, defval: "", raw: true });
    if (g.length) return g;
  }
  return [];
}

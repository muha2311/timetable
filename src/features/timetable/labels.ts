import type { TFn } from "../../i18n";
import type { RefData } from "./useRefData";

export const instructorName = (r: RefData, id: string | null): string => (id ? r.faculty.find((f) => f.id === id)?.fullName ?? "—" : "");
export const roomLabel = (r: RefData, id: string | null): string => {
  const c = id ? r.classrooms.find((x) => x.id === id) : undefined;
  return c ? `${c.name}${c.building ? ` (${c.building})` : ""}` : "";
};
export const sectionsLabel = (r: RefData, ids: string[], t: TFn): string => {
  if (!ids.length) return t("sections.all");
  const names = ids.map((id) => r.sections.find((s) => s.id === id)?.name ?? "?").sort((a, b) => Number(a) - Number(b));
  return t("sections.prefix", { list: names.join(t("list.sep")) });
};

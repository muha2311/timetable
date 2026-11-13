import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { slug } from "../domain/ids";
import en from "../locales/en/translation.json";
import ar from "../locales/ar/translation.json";

export type Lang = "en" | "ar";
export type TFn = (key: string, params?: Record<string, string | number>) => string;
interface I18n { lang: Lang; dir: "ltr" | "rtl"; setLang: (l: Lang) => void; t: TFn; tc: (courseName: string) => string }

const resources: Record<Lang, Record<string, string>> = { en, ar };
const Ctx = createContext<I18n | null>(null);

function initialLang(): Lang {
  try { const v = localStorage.getItem("lang"); if (v === "ar" || v === "en") return v; } catch { /* storage unavailable */ }
  return "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const dir: I18n["dir"] = lang === "ar" ? "rtl" : "ltr";

  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    try { localStorage.setItem("lang", lang); } catch { /* ignore */ }
  }, [lang, dir]);

  // Falls back to English, then to the key itself (warns in dev). Only UI text is translated, never stored data.
  const t = useCallback<TFn>((key, params) => {
    const raw = resources[lang][key] ?? resources.en[key];
    if (raw === undefined) { if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`); return key; }
    return params ? raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(params[k] ?? "")) : raw;
  }, [lang]);

  // Course names are stored in English; this only changes how they are displayed.
  const tc = useCallback((name: string) => resources[lang][`course.${slug(name)}`] ?? name, [lang]);

  const value = useMemo<I18n>(() => ({ lang, dir, setLang, t, tc }), [lang, dir, t, tc]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside I18nProvider");
  return v;
}

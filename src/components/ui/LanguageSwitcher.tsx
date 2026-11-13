import { useI18n } from "../../i18n";
import { Button } from "./Button";

/** Shows the name of the OTHER language, written in that language. */
export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <Button variant="secondary" onClick={() => setLang(lang === "en" ? "ar" : "en")} aria-label={t("common.language")} lang={lang === "en" ? "ar" : "en"}>
      {t("lang.switchTo")}
    </Button>
  );
}

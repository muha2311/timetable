import { useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import { Button } from "./Button";

export function ThemeToggle() {
  const { t } = useI18n();
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark");
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  return <Button variant="secondary" onClick={() => setDark((d) => !d)} aria-pressed={dark}>{dark ? t("common.themeLight") : t("common.themeDark")}</Button>;
}

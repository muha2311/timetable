import { Suspense, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../app/AuthProvider";
import { Button } from "../components/ui/Button";
import { Icon, type IconName } from "../components/ui/Icon";
import { LanguageSwitcher } from "../components/ui/LanguageSwitcher";
import { SyncIndicator } from "../components/ui/SyncIndicator";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { useI18n } from "../i18n";
import { useSyncStatus } from "../services/offline/sync";

const NAV: { to: string; key: string; icon: IconName; superOnly?: boolean }[] = [
  { to: "/", key: "nav.dashboard", icon: "dashboard" },
  { to: "/timetable", key: "nav.timetable", icon: "calendar" },
  { to: "/exam-schedule", key: "nav.examSchedule", icon: "clipboard" },
  { to: "/invigilation", key: "nav.invigilation", icon: "users" },
  { to: "/faculty", key: "nav.faculty", icon: "users" },
  { to: "/classrooms", key: "nav.classrooms", icon: "building" },
  { to: "/students", key: "nav.students", icon: "cap" },
  { to: "/import", key: "nav.import", icon: "upload" },
  { to: "/exams", key: "nav.exams", icon: "alert" },
  { to: "/levels", key: "nav.levels", icon: "layers" },
  { to: "/assignments", key: "nav.assignments", icon: "clipboard" },
  { to: "/users", key: "nav.users", icon: "users", superOnly: true },
  { to: "/settings", key: "nav.settings", icon: "building", superOnly: true },
];

export function AppLayout() {
  const { user, profile, isSuper, logOut } = useAuth();
  const sync = useSyncStatus();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:flex">
      {open && <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`fixed inset-y-0 start-0 z-40 flex w-64 shrink-0 flex-col bg-brand-900 text-white transition-transform lg:static lg:translate-x-0 ${open ? "translate-x-0" : "max-lg:-translate-x-full max-lg:rtl:translate-x-full"}`}>
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15 text-sm font-bold" aria-hidden="true">CS</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{t("app.name")}</div>
            <div className="truncate text-xs text-brand-100">{t("app.org")}</div>
          </div>
        </div>
        <nav aria-label={t("nav.main")} className="flex flex-col gap-1 p-3">
          {NAV.filter((n) => !n.superOnly || isSuper).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={() => setOpen(false)}
              className={({ isActive }) => `flex items-center gap-3 rounded-md border-s-4 px-3 py-2 text-sm transition-colors ${isActive ? "border-white bg-white/15 font-semibold" : "border-transparent text-brand-100 hover:bg-white/10"}`}>
              <Icon name={n.icon} />{t(n.key)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <Button variant="secondary" className="lg:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t("common.menu")}><Icon name="menu" /></Button>
          <span className="hidden truncate text-sm text-slate-500 lg:inline"><span dir="ltr">{user?.email}</span> · {profile ? t(`appRole.${profile.role}`) : ""}</span>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <SyncIndicator /><LanguageSwitcher /><ThemeToggle />
            <Button variant="secondary" onClick={() => void logOut()}>{t("common.signOut")}</Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[90rem] flex-1 p-4 sm:p-6 lg:p-8">
          {!sync.online && <div role="status" className="mb-4 rounded-md border border-slate-300 bg-slate-100 p-3 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100">○ {t("sync.offlineBanner")}</div>}<Suspense fallback={<p className="text-sm text-slate-500" role="status">{t("common.loading")}</p>}><Outlet /></Suspense></main>
      </div>
    </div>
  );
}

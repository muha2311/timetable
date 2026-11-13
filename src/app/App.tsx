import { lazy, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AccessDeniedPage } from "../pages/AccessDeniedPage";
import { AuthProvider, useAuth } from "./AuthProvider";
import { I18nProvider } from "../i18n";
import { ToastProvider } from "../components/ui/Toast";
import { AppLayout } from "../layouts/AppLayout";
import { LoginPage } from "../pages/LoginPage";
const TimetablePage = lazy(() => import("../pages/TimetablePage").then((m) => ({ default: m.TimetablePage })));
const ClassroomsPage = lazy(() => import("../pages/ClassroomsPage").then((m) => ({ default: m.ClassroomsPage })));
const FacultyPage = lazy(() => import("../pages/FacultyPage").then((m) => ({ default: m.FacultyPage })));
const AcademicLevelsPage = lazy(() => import("../pages/AcademicLevelsPage").then((m) => ({ default: m.AcademicLevelsPage })));
const ExamSchedulePage = lazy(() => import("../pages/ExamSchedulePage").then((m) => ({ default: m.ExamSchedulePage })));
const UsersPage = lazy(() => import("../pages/UsersPage").then((m) => ({ default: m.UsersPage })));
const DashboardPage = lazy(() => import("../pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const SettingsPage = lazy(() => import("../pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const InvigilationPage = lazy(() => import("../pages/InvigilationPage").then((m) => ({ default: m.InvigilationPage })));
const StudentsPage = lazy(() => import("../pages/StudentsPage").then((m) => ({ default: m.StudentsPage })));
const ExamConflictsPage = lazy(() => import("../pages/ExamConflictsPage").then((m) => ({ default: m.ExamConflictsPage })));
const StudentImportPage = lazy(() => import("../pages/StudentImportPage").then((m) => ({ default: m.StudentImportPage })));
import { PlaceholderPage } from "../pages/PlaceholderPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, hasAccess } = useAuth();
  if (loading) return <p className="p-6 text-sm">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return hasAccess ? <>{children}</> : <AccessDeniedPage />;
}

/** UI guard only; the real enforcement is in Firestore rules and the server endpoints. */
function RequireSuper({ children }: { children: ReactNode }) {
  const { isSuper } = useAuth();
  return isSuper ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  return (
    <I18nProvider>
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
              <Route index element={<DashboardPage />} />
              <Route path="timetable" element={<TimetablePage />} />
              <Route path="faculty" element={<FacultyPage />} />
              <Route path="students" element={<StudentsPage />} />
              <Route path="invigilation" element={<InvigilationPage />} />
              <Route path="exam-schedule" element={<ExamSchedulePage />} />
              <Route path="settings" element={<RequireSuper><SettingsPage /></RequireSuper>} />
              <Route path="users" element={<RequireSuper><UsersPage /></RequireSuper>} />
              <Route path="exams" element={<ExamConflictsPage />} />
              <Route path="import" element={<StudentImportPage />} />
              <Route path="classrooms" element={<ClassroomsPage />} />
              <Route path="levels" element={<AcademicLevelsPage />} />
              <Route path="assignments" element={<PlaceholderPage titleKey="nav.assignments" />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
    </I18nProvider>
  );
}

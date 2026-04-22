import { lazy, Suspense, useEffect } from 'react';
import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { UpdateGate } from '@/components/UpdateGate';
import { useSession } from '@/stores/session';
import { hasRole, rolesForPath } from '@/lib/roleAccess';
import type { Role } from '@shared/types/user';

const HomePage = lazy(() => import('@/pages/HomePage').then((m) => ({ default: m.HomePage })));
const AssignmentsPage = lazy(() =>
  import('@/pages/AssignmentsPage').then((m) => ({ default: m.AssignmentsPage })),
);
const AttendancePage = lazy(() =>
  import('@/pages/AttendancePage').then((m) => ({ default: m.AttendancePage })),
);
const LeavePage = lazy(() => import('@/pages/LeavePage').then((m) => ({ default: m.LeavePage })));
const ParsingCenterRouter = lazy(() =>
  import('@/pages/ParsingCenterPage').then((m) => ({ default: m.ParsingCenterRouter })),
);
const ParsingOutputsPage = lazy(() =>
  import('@/pages/ParsingOutputsPage').then((m) => ({ default: m.ParsingOutputsPage })),
);
const CSPage = lazy(() => import('@/pages/CSPage').then((m) => ({ default: m.CSPage })));
const ApprovalsPage = lazy(() =>
  import('@/pages/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })),
);
const OperationsBoardPage = lazy(() =>
  import('@/pages/OperationsBoardPage').then((m) => ({ default: m.OperationsBoardPage })),
);
const QAFirstPage = lazy(() =>
  import('@/pages/QAChecklistPage').then((m) => ({ default: m.QAFirstPage })),
);
const QAFinalPage = lazy(() =>
  import('@/pages/QAChecklistPage').then((m) => ({ default: m.QAFinalPage })),
);
const ManualsPage = lazy(() =>
  import('@/pages/ManualsPage').then((m) => ({ default: m.ManualsPage })),
);
const ReportsPage = lazy(() =>
  import('@/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const AutomationPage = lazy(() =>
  import('@/pages/AutomationPage').then((m) => ({ default: m.AutomationPage })),
);
const EmployeesPage = lazy(() =>
  import('@/pages/EmployeesPage').then((m) => ({ default: m.EmployeesPage })),
);
const AnnouncementsPage = lazy(() =>
  import('@/pages/AnnouncementsPage').then((m) => ({ default: m.AnnouncementsPage })),
);
const DocumentsPage = lazy(() =>
  import('@/pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
);
const MyWorkPage = lazy(() => import('@/pages/MyWorkPage').then((m) => ({ default: m.MyWorkPage })));
const WorkLogsPage = lazy(() =>
  import('@/pages/WorkLogsPage').then((m) => ({ default: m.WorkLogsPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const TuitionPage = lazy(() =>
  import('@/pages/TuitionPage').then((m) => ({ default: m.TuitionPage })),
);
const PayrollAdminPage = lazy(() =>
  import('@/pages/PayrollAdminPage').then((m) => ({ default: m.PayrollAdminPage })),
);
const MyPayslipsPage = lazy(() =>
  import('@/pages/MyPayslipsPage').then((m) => ({ default: m.MyPayslipsPage })),
);
const SubscriptionsPage = lazy(() =>
  import('@/pages/SubscriptionsPage').then((m) => ({ default: m.SubscriptionsPage })),
);
const CorporateCardsPage = lazy(() =>
  import('@/pages/CorporateCardsPage').then((m) => ({ default: m.CorporateCardsPage })),
);
const StudentArchivePage = lazy(() =>
  import('@/pages/StudentArchivePage').then((m) => ({ default: m.StudentArchivePage })),
);
const NotionSyncPage = lazy(() =>
  import('@/pages/NotionSyncPage').then((m) => ({ default: m.NotionSyncPage })),
);
const ReleasePage = lazy(() =>
  import('@/pages/ReleasePage').then((m) => ({ default: m.ReleasePage })),
);
const TrashPage = lazy(() => import('@/pages/TrashPage').then((m) => ({ default: m.TrashPage })));

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, hydrated } = useSession();
  const location = useLocation();
  if (!hydrated) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg text-fg-subtle text-sm">
        로딩 중…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

function AccessDenied() {
  return (
    <div className="flex min-h-[320px] items-center justify-center p-6">
      <section className="card max-w-lg">
        <h1 className="text-base font-semibold text-fg">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-fg-muted">
          이 화면은 현재 계정 역할에서 사용할 수 없습니다. 필요한 경우 관리자에게 권한 변경을 요청해 주세요.
        </p>
      </section>
    </div>
  );
}

function RequireRoles({
  allowedRoles,
  children,
}: {
  allowedRoles: readonly Role[];
  children: ReactElement;
}) {
  const user = useSession((s) => s.user);
  if (!hasRole(user?.role, allowedRoles)) return <AccessDenied />;
  return children;
}

function RouteLoading() {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center bg-bg text-fg-subtle text-sm">
      화면 로딩 중...
    </div>
  );
}

function page(element: ReactElement) {
  return <Suspense fallback={<RouteLoading />}>{element}</Suspense>;
}

function rolePage(pathname: string, element: ReactElement) {
  const allowedRoles = rolesForPath(pathname);
  if (!allowedRoles) return page(element);
  return page(<RequireRoles allowedRoles={allowedRoles}>{element}</RequireRoles>);
}

export default function App() {
  const hydrateFromStorage = useSession((s) => s.hydrateFromStorage);
  useEffect(() => {
    hydrateFromStorage();
  }, [hydrateFromStorage]);

  return (
    <UpdateGate>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/home" replace />} />

          <Route path="home" element={page(<HomePage />)} />
          <Route path="my-work" element={rolePage('/my-work', <MyWorkPage />)} />
          <Route path="my-payslips" element={page(<MyPayslipsPage />)} />

          <Route path="assignments" element={rolePage('/assignments', <AssignmentsPage />)} />
          <Route path="instruction-parser" element={rolePage('/instruction-parser', <ParsingCenterRouter />)} />
          <Route path="parsing/outputs" element={rolePage('/parsing/outputs', <ParsingOutputsPage />)} />
          <Route path="operations-board" element={rolePage('/operations-board', <OperationsBoardPage />)} />
          <Route path="qa/first" element={rolePage('/qa/first', <QAFirstPage />)} />
          <Route path="qa/final" element={rolePage('/qa/final', <QAFinalPage />)} />
          <Route path="cs" element={rolePage('/cs', <CSPage />)} />

          <Route path="attendance" element={page(<AttendancePage />)} />
          <Route path="work-logs" element={page(<WorkLogsPage />)} />
          <Route path="leave" element={page(<LeavePage />)} />
          <Route path="approvals" element={page(<ApprovalsPage />)} />
          <Route path="employees" element={rolePage('/employees', <EmployeesPage />)} />

          <Route path="admin/tuition" element={rolePage('/admin/tuition', <TuitionPage />)} />
          <Route path="admin/payroll" element={rolePage('/admin/payroll', <PayrollAdminPage />)} />
          <Route path="admin/subscriptions" element={rolePage('/admin/subscriptions', <SubscriptionsPage />)} />
          <Route path="admin/cards" element={rolePage('/admin/cards', <CorporateCardsPage />)} />
          <Route path="students/archive" element={rolePage('/students/archive', <StudentArchivePage />)} />

          <Route path="announcements" element={page(<AnnouncementsPage />)} />
          <Route path="manuals" element={page(<ManualsPage />)} />
          <Route path="documents" element={page(<DocumentsPage />)} />

          <Route path="reports" element={rolePage('/reports', <ReportsPage />)} />
          <Route path="automation" element={rolePage('/automation', <AutomationPage />)} />
          <Route path="settings/notion" element={rolePage('/settings/notion', <NotionSyncPage />)} />
          <Route path="release" element={rolePage('/release', <ReleasePage />)} />
          <Route path="trash" element={rolePage('/trash', <TrashPage />)} />
          <Route path="settings" element={page(<SettingsPage />)} />
        </Route>

        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </UpdateGate>
  );
}

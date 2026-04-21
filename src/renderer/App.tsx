import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { HomePage } from '@/pages/HomePage';
import { AssignmentsPage } from '@/pages/AssignmentsPage';
import { AttendancePage } from '@/pages/AttendancePage';
import { LeavePage } from '@/pages/LeavePage';
import { ParsingCenterPage } from '@/pages/ParsingCenterPage';
import { CSPage } from '@/pages/CSPage';
import { ApprovalsPage } from '@/pages/ApprovalsPage';
import { OperationsBoardPage } from '@/pages/OperationsBoardPage';
import { QAFirstPage, QAFinalPage } from '@/pages/QAChecklistPage';
import { ManualsPage } from '@/pages/ManualsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { AutomationPage } from '@/pages/AutomationPage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { AnnouncementsPage } from '@/pages/AnnouncementsPage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { MyWorkPage } from '@/pages/MyWorkPage';
import { WorkLogsPage } from '@/pages/WorkLogsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { TuitionPage } from '@/pages/TuitionPage';
import { PayrollAdminPage } from '@/pages/PayrollAdminPage';
import { MyPayslipsPage } from '@/pages/MyPayslipsPage';
import { SubscriptionsPage } from '@/pages/SubscriptionsPage';
import { CorporateCardsPage } from '@/pages/CorporateCardsPage';
import { StudentArchivePage } from '@/pages/StudentArchivePage';
import { NotionSyncPage } from '@/pages/NotionSyncPage';
import { UpdateGate } from '@/components/UpdateGate';
import { useSession } from '@/stores/session';

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

          <Route path="home" element={<HomePage />} />
          <Route path="my-work" element={<MyWorkPage />} />
          <Route path="my-payslips" element={<MyPayslipsPage />} />

          <Route path="assignments" element={<AssignmentsPage />} />
          <Route path="instruction-parser" element={<ParsingCenterPage />} />
          <Route path="operations-board" element={<OperationsBoardPage />} />
          <Route path="qa/first" element={<QAFirstPage />} />
          <Route path="qa/final" element={<QAFinalPage />} />
          <Route path="cs" element={<CSPage />} />

          <Route path="attendance" element={<AttendancePage />} />
          <Route path="work-logs" element={<WorkLogsPage />} />
          <Route path="leave" element={<LeavePage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="employees" element={<EmployeesPage />} />

          <Route path="admin/tuition" element={<TuitionPage />} />
          <Route path="admin/payroll" element={<PayrollAdminPage />} />
          <Route path="admin/subscriptions" element={<SubscriptionsPage />} />
          <Route path="admin/cards" element={<CorporateCardsPage />} />
          <Route path="students/archive" element={<StudentArchivePage />} />

          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="manuals" element={<ManualsPage />} />
          <Route path="documents" element={<DocumentsPage />} />

          <Route path="reports" element={<ReportsPage />} />
          <Route path="automation" element={<AutomationPage />} />
          <Route path="settings/notion" element={<NotionSyncPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </UpdateGate>
  );
}

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
import { Placeholder } from '@/pages/Placeholder';
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
        <Route path="my-work" element={<Placeholder title="내 업무" />} />

        <Route path="assignments" element={<AssignmentsPage />} />
        <Route path="instruction-parser" element={<ParsingCenterPage />} />
        <Route path="operations-board" element={<OperationsBoardPage />} />
        <Route path="qa/first" element={<QAFirstPage />} />
        <Route path="qa/final" element={<QAFinalPage />} />
        <Route path="cs" element={<CSPage />} />

        <Route path="attendance" element={<AttendancePage />} />
        <Route path="work-logs" element={<Placeholder title="업무 일지" subtitle="일간 업무 로그 (추후)" />} />
        <Route path="leave" element={<LeavePage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="employees" element={<EmployeesPage />} />

        <Route path="announcements" element={<AnnouncementsPage />} />
        <Route path="manuals" element={<ManualsPage />} />
        <Route path="documents" element={<DocumentsPage />} />

        <Route path="reports" element={<ReportsPage />} />
        <Route path="automation" element={<AutomationPage />} />
        <Route path="settings" element={<Placeholder title="설정" subtitle="자동화 페이지 > 시스템 설정 탭을 사용하세요." />} />
      </Route>

      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}

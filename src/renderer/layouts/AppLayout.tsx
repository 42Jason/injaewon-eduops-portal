import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { ToastStack } from '@/components/ToastStack';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';

export function AppLayout() {
  return (
    <ConfirmProvider>
      <div className="flex h-screen overflow-hidden bg-bg text-fg">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>
        <ToastStack />
      </div>
    </ConfirmProvider>
  );
}

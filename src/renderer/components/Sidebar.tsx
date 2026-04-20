import { NavLink } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  CheckSquare,
  ClipboardList,
  FileInput,
  Kanban,
  ShieldCheck,
  Shield,
  Headphones,
  Clock,
  NotebookPen,
  CalendarDays,
  FileSignature,
  Users,
  Megaphone,
  BookOpenText,
  FolderOpen,
  BarChart3,
  Bot,
  Settings,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useSession } from '@/stores/session';
import { ROLE_LABELS } from '@shared/types/user';
import { UpdateBanner } from './UpdateBanner';

interface MenuItem {
  to: string;
  label: string;
  icon: LucideIcon;
  group?: string;
}

const MENU: MenuItem[] = [
  { to: '/home', label: '홈', icon: LayoutDashboard, group: '내 공간' },
  { to: '/my-work', label: '내 업무', icon: CheckSquare, group: '내 공간' },

  { to: '/assignments', label: '과제 관리', icon: ClipboardList, group: '업무' },
  { to: '/instruction-parser', label: '안내문 파싱 센터', icon: FileInput, group: '업무' },
  { to: '/operations-board', label: '운영 보드', icon: Kanban, group: '업무' },
  { to: '/qa/first', label: '1차 QA', icon: ShieldCheck, group: '업무' },
  { to: '/qa/final', label: '최종 QA', icon: Shield, group: '업무' },
  { to: '/cs', label: 'CS 관리', icon: Headphones, group: '업무' },

  { to: '/attendance', label: '근태 관리', icon: Clock, group: '조직' },
  { to: '/work-logs', label: '업무 일지', icon: NotebookPen, group: '조직' },
  { to: '/leave', label: '휴가 관리', icon: CalendarDays, group: '조직' },
  { to: '/approvals', label: '전자 결재', icon: FileSignature, group: '조직' },
  { to: '/employees', label: '직원 관리', icon: Users, group: '조직' },

  { to: '/announcements', label: '공지사항', icon: Megaphone, group: '지식' },
  { to: '/manuals', label: '노션 매뉴얼', icon: BookOpenText, group: '지식' },
  { to: '/documents', label: '자료실', icon: FolderOpen, group: '지식' },

  { to: '/reports', label: '리포트', icon: BarChart3, group: '운영' },
  { to: '/automation', label: 'CTO 자동화', icon: Bot, group: '운영' },
  { to: '/settings', label: '설정', icon: Settings, group: '운영' },
];

export function Sidebar() {
  const { user, logout } = useSession();

  const groups = MENU.reduce<Record<string, MenuItem[]>>((acc, item) => {
    const g = item.group ?? '';
    (acc[g] ||= []).push(item);
    return acc;
  }, {});

  return (
    <aside className="flex h-full w-60 flex-col border-r border-border bg-bg-soft">
      <div className="flex items-center gap-2 px-4 py-4 border-b border-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white font-bold">
          E
        </div>
        <div>
          <div className="text-sm font-semibold text-fg">EduOps</div>
          <div className="text-[11px] text-fg-subtle">Employee Portal</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-5">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group}>
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              {group}
            </div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      title={item.label}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                          isActive
                            ? 'bg-accent-soft text-accent-strong font-medium'
                            : 'text-fg-muted hover:bg-bg-card hover:text-fg',
                        )
                      }
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <UpdateBanner />

      {user && (
        <div className="border-t border-border px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent-strong text-xs font-semibold">
              {user.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{user.name}</div>
              <div className="truncate text-[11px] text-fg-subtle">
                {ROLE_LABELS[user.role]}
                {user.departmentName ? ` · ${user.departmentName}` : ''}
              </div>
            </div>
            <button
              onClick={logout}
              title="로그아웃"
              className="rounded p-1 text-fg-subtle hover:bg-bg-card hover:text-fg"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}

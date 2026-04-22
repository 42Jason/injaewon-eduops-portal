import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileWarning,
  Megaphone,
  RotateCcw,
  Timer,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { hasRole, ROLE_GROUPS } from '@/lib/roleAccess';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';

interface StatCard {
  key: string;
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: 'default' | 'warn' | 'danger' | 'success';
  to?: string;
}

function toneClasses(tone: StatCard['tone']) {
  switch (tone) {
    case 'warn':    return 'text-warn';
    case 'danger':  return 'text-danger';
    case 'success': return 'text-success';
    default:        return 'text-accent';
  }
}

function stateBadge(state: string) {
  const danger = ['자료누락', '반려', '1차QA반려', '최종QA반려'];
  const warn = ['1차QA대기', '최종QA대기', '수정요청', '보류'];
  const success = ['승인완료', '완료'];
  if (danger.some((s) => state.includes(s))) return 'bg-danger/15 text-danger';
  if (success.some((s) => state.includes(s))) return 'bg-success/15 text-success';
  if (warn.some((s) => state.includes(s))) return 'bg-warn/15 text-warn';
  return 'bg-accent-soft text-accent-strong';
}

interface AssignmentRow {
  id: number;
  code: string;
  title: string;
  state: string;
  due_at: string | null;
  risk: string;
  parser_name?: string | null;
  qa1_name?: string | null;
  qa_final_name?: string | null;
}

interface NoticeRow {
  id: number;
  title: string;
  author_name?: string | null;
  published_at: string;
}

interface LeaveRow {
  id: number;
  user_name?: string | null;
  user_id: number;
  kind: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface ActivityLogRow {
  id: number;
  created_at: string;
  actor_name?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: number | null;
  note?: string | null;
}

interface ManualRow {
  id: number;
  slug: string;
  title: string;
  updated_at: string;
}

const LEAVE_KIND_LABEL: Record<string, string> = {
  annual: '연차',
  half_am: '오전 반차',
  half_pm: '오후 반차',
  sick: '병가',
  special: '특별',
  unpaid: '무급',
};

function formatLeaveRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const ms = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  const weekday = (d: Date) => ['일','월','화','수','목','금','토'][d.getDay()];
  if (start === end) return `${ms(s)} (${weekday(s)})`;
  return `${ms(s)}–${ms(e)}`;
}

function formatLogTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function describeAction(row: ActivityLogRow): string {
  const a = row.action;
  const target = row.target_type && row.target_id ? `${row.target_type}#${row.target_id}` : '';
  if (row.note) return row.note;
  if (target) return `${a} — ${target}`;
  return a;
}

function formatDue(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = new Date(midnight); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(midnight); dayAfter.setDate(dayAfter.getDate() + 2);
  const hhmm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  if (d >= midnight && d < tomorrow)   return `오늘 ${hhmm}`;
  if (d >= tomorrow && d < dayAfter)   return `내일 ${hhmm}`;
  if (d < midnight)                    return `지연 (${d.toLocaleDateString('ko-KR')})`;
  return d.toLocaleDateString('ko-KR');
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 60) return `${Math.max(diffMin, 1)}분 전`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

export function HomePage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const navigate = useNavigate();
  const canReadAssignments = hasRole(user?.role, ROLE_GROUPS.assignmentReader);
  const canReadAuditLogs = hasRole(user?.role, ROLE_GROUPS.auditReader);

  const statsQuery = useQuery({
    queryKey: ['home.stats', user?.id],
    queryFn: () => api!.home.stats(user!.id),
    enabled: live,
  });

  const assignmentsQuery = useQuery({
    queryKey: ['home.assignments', user?.id],
    queryFn: () =>
      api!.assignments.list({ assignee: user!.id }) as unknown as Promise<AssignmentRow[]>,
    enabled: live && canReadAssignments,
  });

  const noticesQuery = useQuery({
    queryKey: ['home.notices'],
    queryFn: () => api!.notices.list() as unknown as Promise<NoticeRow[]>,
    enabled: live,
  });

  const leavesQuery = useQuery({
    queryKey: ['home.leaves'],
    queryFn: () =>
      api!.leave.list({ status: 'approved' }) as unknown as Promise<LeaveRow[]>,
    enabled: live,
    refetchInterval: 5 * 60_000,
  });

  const logsQuery = useQuery({
    queryKey: ['home.logs'],
    queryFn: () =>
      api!.logs.list({ limit: 6 }) as unknown as Promise<ActivityLogRow[]>,
    enabled: live && canReadAuditLogs,
    refetchInterval: 60_000,
  });

  const manualsQuery = useQuery({
    queryKey: ['home.manuals'],
    queryFn: () => api!.manuals.list() as unknown as Promise<ManualRow[]>,
    enabled: live,
    staleTime: 5 * 60_000,
  });

  const recentManuals = (manualsQuery.data ?? [])
    .slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 3);

  // Team leave upcoming (next 14 days)
  const upcomingLeaves = (leavesQuery.data ?? [])
    .filter((l) => {
      const end = new Date(l.end_date);
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 14);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return end >= today && new Date(l.start_date) <= horizon;
    })
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 5);

  const activityLogs = logsQuery.data ?? [];

  // Stat cards — pull from live DB when we can, otherwise show placeholder mock.
  const s = statsQuery.data;
  const statCards: StatCard[] = [
    { key: 'today',        label: '오늘 내 업무',     value: s?.todayMine ?? 6,       hint: '할당된 과제',    icon: ClipboardList,                                   to: '/my-work' },
    { key: 'dueToday',     label: '오늘 마감',        value: s?.dueToday ?? 2,        hint: '마감 D-0',        icon: Timer,        tone: (s?.dueToday ?? 0) > 0 ? 'warn' : 'default', to: '/my-work' },
    { key: 'atRisk',       label: '지연 위험',        value: s?.atRisk ?? 3,          hint: 'SLA 임박',        icon: AlertTriangle, tone: 'warn',                      to: '/operations-board' },
    { key: 'rejected',     label: '반려됨',           value: s?.rejected ?? 1,        hint: 'QA 반려',         icon: FileWarning,   tone: 'danger',                     to: '/my-work' },
    { key: 'revision',     label: '수정 요청',        value: 2,                        hint: '최종 QA',         icon: RotateCcw,                                      to: '/qa/final' },
    { key: 'awaitingApp',  label: '승인 대기',        value: s?.awaitingApp ?? 0,     hint: '내 결재선',       icon: CheckCircle2,                                   to: '/approvals' },
    { key: 'unreadNotice', label: '읽지 않은 공지',   value: s?.unreadNotice ?? 3,    hint: '최근 7일',        icon: Megaphone,                                      to: '/announcements' },
    { key: 'unreadManual', label: '읽지 않은 매뉴얼', value: 5,                        hint: '신규/업데이트',   icon: BookOpen,                                       to: '/manuals' },
    { key: 'workHours',    label: '이번달 근무시간',  value: '84h',                    hint: '목표 168h',       icon: Clock,                                          to: '/attendance' },
    { key: 'leaveLeft',    label: '잔여 휴가',        value: '9.5',                    hint: '연차 15일 기준',  icon: Calendar,      tone: 'success',                   to: '/leave' },
  ];

  const myWork: AssignmentRow[] =
    assignmentsQuery.data?.slice(0, 5) ?? [
      { id: 1, code: 'A-0241', title: '중3 물리 수행평가 — 관성의 법칙', state: '1차QA대기',    due_at: null, risk: 'high' },
      { id: 2, code: 'A-0245', title: '고1 국어 — 독서 포트폴리오',       state: '파싱진행중',   due_at: null, risk: 'medium' },
      { id: 3, code: 'A-0251', title: '중2 영어 — 자기소개 에세이',        state: '최종QA진행중', due_at: null, risk: 'low' },
      { id: 4, code: 'A-0260', title: '고2 수학 — 심화 탐구',              state: '파싱완료',     due_at: null, risk: 'low' },
      { id: 5, code: 'A-0262', title: '중1 사회 — 우리 지역 조사',          state: '자료누락',     due_at: null, risk: 'medium' },
    ];

  const notices: NoticeRow[] =
    noticesQuery.data?.slice(0, 3) ?? [
      { id: 1, title: '[전사] 5월 창립기념일 휴무 안내',        author_name: '최인사', published_at: new Date().toISOString() },
      { id: 2, title: '[파싱팀] Excel 템플릿 v3 배포',           author_name: '이기술', published_at: new Date().toISOString() },
      { id: 3, title: '[QA] 최종QA 체크리스트 v1.4',             author_name: '박운영', published_at: new Date().toISOString() },
    ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">
            안녕하세요, {user?.name ?? '직원'}님 👋
          </h1>
          <p className="text-sm text-fg-muted mt-0.5">
            {live
              ? '실시간 DB 연결됨 — 오늘 할 일을 먼저 확인해 주세요.'
              : '브라우저 프리뷰 모드 (Mock 데이터 표시 중)'}
          </p>
        </div>
        <div className="text-xs text-fg-subtle">
          {new Date().toLocaleDateString('ko-KR', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statCards.map((c) => {
          const Icon = c.icon;
          const Inner = (
            <>
              <div className="flex items-start justify-between">
                <div className="text-xs text-fg-muted">{c.label}</div>
                <Icon size={14} className={toneClasses(c.tone)} />
              </div>
              <div className="mt-2 text-2xl font-semibold text-fg">{c.value}</div>
              {c.hint && <div className="mt-1 text-[11px] text-fg-subtle">{c.hint}</div>}
            </>
          );
          return c.to ? (
            <button
              key={c.key}
              type="button"
              onClick={() => navigate(c.to!)}
              className="card text-left transition-colors hover:border-accent/40 hover:bg-bg-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {Inner}
            </button>
          ) : (
            <div key={c.key} className="card">
              {Inner}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-fg">내 업무</h2>
            <button
              type="button"
              onClick={() => navigate('/my-work')}
              className="text-xs text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
            >
              전체 보기 →
            </button>
          </div>
          {myWork.length === 0 ? (
            <p className="py-6 text-center text-xs text-fg-subtle">할당된 업무가 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-fg-subtle">
                  <th className="py-1.5 font-medium">ID</th>
                  <th className="py-1.5 font-medium">과제명</th>
                  <th className="py-1.5 font-medium">상태</th>
                  <th className="py-1.5 font-medium text-right">마감</th>
                </tr>
              </thead>
              <tbody>
                {myWork.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => navigate('/assignments')}
                    className="border-t border-border cursor-pointer hover:bg-bg-soft/50"
                  >
                    <td className="py-2 font-mono text-[11px] text-fg-muted">{t.code}</td>
                    <td className="py-2 text-fg">{t.title}</td>
                    <td className="py-2">
                      <span className={cn('chip', stateBadge(t.state))}>{t.state}</span>
                    </td>
                    <td className="py-2 text-right text-fg-muted text-xs">{formatDue(t.due_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-fg">공지</h2>
            <button
              type="button"
              onClick={() => navigate('/announcements')}
              className="text-xs text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
            >
              더 보기
            </button>
          </div>
          {notices.length === 0 ? (
            <p className="py-4 text-center text-xs text-fg-subtle">공지가 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {notices.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => navigate('/announcements')}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-soft/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <div className="text-fg truncate">{n.title}</div>
                    <div className="text-[11px] text-fg-subtle mt-0.5">
                      {n.author_name ?? '—'} · {relativeTime(n.published_at)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">팀 휴가 · 향후 2주</h2>
            <button
              type="button"
              onClick={() => navigate('/leave')}
              className="text-xs text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
            >
              열기
            </button>
          </div>
          {leavesQuery.isLoading ? (
            <p className="py-4 text-center text-xs text-fg-subtle">불러오는 중…</p>
          ) : upcomingLeaves.length === 0 ? (
            <p className="py-4 text-center text-xs text-fg-subtle">예정된 휴가가 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {upcomingLeaves.map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => navigate('/leave')}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-bg-soft/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <span className="text-fg-muted text-xs">{formatLeaveRange(l.start_date, l.end_date)}</span>
                    <span className="text-fg text-xs truncate max-w-[60%]">
                      {l.user_name ?? '—'} · {LEAVE_KIND_LABEL[l.kind] ?? l.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">마감 임박</h2>
            <button
              type="button"
              onClick={() => navigate('/my-work')}
              className="text-xs text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
            >
              내 업무 →
            </button>
          </div>
          <ul className="space-y-1">
            {myWork.filter((w) => w.due_at).slice(0, 3).map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => navigate('/assignments')}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-soft/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <span className="text-fg truncate pr-2">{w.title}</span>
                  <span className="text-xs text-warn whitespace-nowrap">{formatDue(w.due_at)}</span>
                </button>
              </li>
            ))}
            {myWork.filter((w) => w.due_at).length === 0 && (
              <li className="text-xs text-fg-subtle px-2 py-1.5">임박한 마감이 없습니다.</li>
            )}
          </ul>
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">최근 매뉴얼</h2>
            <button
              type="button"
              onClick={() => navigate('/manuals')}
              className="text-xs text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
            >
              매뉴얼 →
            </button>
          </div>
          {manualsQuery.isLoading ? (
            <p className="py-4 text-center text-xs text-fg-subtle">불러오는 중…</p>
          ) : recentManuals.length === 0 ? (
            <p className="py-4 text-center text-xs text-fg-subtle">등록된 매뉴얼이 없습니다.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {recentManuals.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => navigate('/manuals')}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-bg-soft/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <span className="text-fg truncate pr-2">{m.title}</span>
                    <span className="text-[11px] text-fg-subtle whitespace-nowrap">
                      {relativeTime(m.updated_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">활동 로그</h2>
            <button
              type="button"
              onClick={() => navigate('/reports')}
              className="text-xs text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded"
            >
              감사 로그 →
            </button>
          </div>
          {logsQuery.isLoading ? (
            <p className="py-4 text-center text-xs text-fg-subtle">불러오는 중…</p>
          ) : activityLogs.length === 0 ? (
            <p className="py-4 text-center text-xs text-fg-subtle">최근 활동이 없습니다.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {activityLogs.map((l) => (
                <li
                  key={l.id}
                  className="flex items-baseline gap-3 rounded-md px-2 py-1 hover:bg-bg-soft/60"
                >
                  <span className="font-mono text-[11px] text-fg-subtle w-12 shrink-0">
                    {formatLogTime(l.created_at)}
                  </span>
                  <span className="text-fg-muted w-24 shrink-0 text-xs truncate">
                    {l.actor_name ?? '시스템'}
                  </span>
                  <span className="text-fg truncate">{describeAction(l)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

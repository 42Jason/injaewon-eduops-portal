import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  CheckCheck,
  Clock,
  Coffee,
  ExternalLink,
  LogIn,
  LogOut,
  Search,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { getApi } from '@/hooks/useApi';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';
import { fmtTime, relative } from '@/lib/date';

type LocalState = 'off' | 'working' | 'break';

interface AttendanceTodayRow {
  id?: number;
  check_in?: string | null;
  check_out?: string | null;
  break_min?: number;
}

interface AssignmentSearchRow {
  id: number;
  code: string;
  title: string;
  subject: string;
  state: string;
}

type NotificationCategory =
  | 'approval'
  | 'assignment'
  | 'qa'
  | 'cs'
  | 'tuition'
  | 'trash'
  | 'notice'
  | 'system'
  | string;

interface NotificationItem {
  id: number;
  userId: number;
  category: NotificationCategory;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  entityTable: string | null;
  entityId: number | null;
  priority: number;
  readAt: string | null;
  snoozeUntil: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  approval: '결재',
  assignment: '과제',
  qa: 'QA',
  cs: 'CS',
  tuition: '학원비',
  trash: '휴지통',
  notice: '공지',
  system: '시스템',
};

const CATEGORY_COLOR: Record<string, string> = {
  approval: 'bg-accent-soft text-accent-strong',
  assignment: 'bg-info/15 text-info',
  qa: 'bg-warn/15 text-warn',
  cs: 'bg-danger/10 text-danger',
  tuition: 'bg-success/10 text-success',
  trash: 'bg-fg-subtle/10 text-fg-muted',
  notice: 'bg-bg-soft text-fg-muted',
  system: 'bg-bg-soft text-fg-muted',
};

export function TopBar() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();

  // Local-only break indicator (no break column on attendance_records yet)
  const [breakOn, setBreakOn] = useState(false);
  const [breakSince, setBreakSince] = useState<string | null>(null);

  // ---------------- Attendance (real DB) ----------------

  const todayQuery = useQuery({
    queryKey: ['attendance.today', user?.id],
    queryFn: async () =>
      (await api!.attendance.today(user!.id)) as AttendanceTodayRow | null,
    enabled: live,
    refetchInterval: 60_000,
  });

  const today = todayQuery.data ?? null;

  const attState: LocalState = useMemo(() => {
    if (today?.check_in && !today.check_out) return breakOn ? 'break' : 'working';
    return 'off';
  }, [today, breakOn]);

  const sinceLabel: string | null = useMemo(() => {
    if (attState === 'break' && breakSince) return breakSince;
    if (attState === 'working' && today?.check_in) return fmtTime(today.check_in);
    return null;
  }, [attState, breakSince, today]);

  const checkInMut = useMutation({
    mutationFn: () => api!.attendance.checkIn({ userId: user!.id }),
    onSuccess: (r) => {
      if (r.ok) {
        if (r.already) toast.info('이미 오늘 출근 기록이 있습니다.');
        else toast.ok('출근 기록됨');
        setBreakOn(false);
        setBreakSince(null);
        qc.invalidateQueries({ queryKey: ['attendance.today'] });
        qc.invalidateQueries({ queryKey: ['attendance.month'] });
      } else {
        toast.err(r.error ?? '출근 실패');
      }
    },
    onError: (e: Error) => toast.err(e.message ?? '출근 실패'),
  });

  const checkOutMut = useMutation({
    mutationFn: () => api!.attendance.checkOut({ userId: user!.id, breakMin: 60 }),
    onSuccess: (r) => {
      if (r.ok) {
        toast.ok('퇴근 기록됨');
        setBreakOn(false);
        setBreakSince(null);
        qc.invalidateQueries({ queryKey: ['attendance.today'] });
        qc.invalidateQueries({ queryKey: ['attendance.month'] });
      } else {
        toast.err(r.error ?? '퇴근 실패');
      }
    },
    onError: (e: Error) => toast.err(e.message ?? '퇴근 실패'),
  });

  function onCheckIn() {
    if (!live) return;
    if (attState !== 'off') return;
    checkInMut.mutate();
  }
  function onBreak() {
    if (attState === 'off') return;
    setBreakOn((v) => {
      const next = !v;
      setBreakSince(
        next
          ? new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
          : null,
      );
      return next;
    });
  }
  function onCheckOut() {
    if (!live) return;
    if (attState === 'off') return;
    checkOutMut.mutate();
  }

  // ---------------- Search ----------------

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const searchBoxRef = useRef<HTMLFormElement>(null);

  const assignmentsQuery = useQuery({
    queryKey: ['topbar.assignments'],
    queryFn: () =>
      api!.assignments.list() as unknown as Promise<AssignmentSearchRow[]>,
    enabled: live && open,
    staleTime: 30_000,
  });

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as AssignmentSearchRow[];
    return (assignmentsQuery.data ?? [])
      .filter((a) =>
        `${a.code} ${a.title} ${a.subject}`.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [assignmentsQuery.data, query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!searchBoxRef.current) return;
      if (!searchBoxRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, []);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    if (matches.length > 0) {
      navigate('/assignments');
    } else {
      toast.info(`"${query}" 에 대한 결과가 없습니다.`);
    }
    setOpen(false);
  }

  // ---------------- Notifications ----------------

  const [notifOpen, setNotifOpen] = useState(false);
  const [notifCategory, setNotifCategory] = useState<string>('all');
  const notifRef = useRef<HTMLDivElement>(null);

  // 배지/카운트용 — 드로워가 닫혀 있어도 10초마다 폴링.
  const statsQuery = useQuery({
    queryKey: ['topbar.notifications.stats', user?.id],
    queryFn: () =>
      api!.notifications.stats({ userId: user!.id }) as unknown as Promise<{
        total: number;
        byCategory: Array<{ category: string; count: number }>;
      }>,
    enabled: live,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  // 드로워가 열린 동안만 리스트 조회. (카테고리 필터 반영)
  const notifQuery = useQuery({
    queryKey: [
      'topbar.notifications.list',
      user?.id,
      notifOpen,
      notifCategory,
    ],
    queryFn: () =>
      api!.notifications.list({
        userId: user!.id,
        status: 'all',
        category: notifCategory === 'all' ? null : notifCategory,
        limit: 40,
      }) as unknown as Promise<NotificationItem[]>,
    enabled: live && notifOpen,
    refetchInterval: notifOpen ? 15_000 : false,
    staleTime: 5_000,
  });

  const stats = statsQuery.data ?? { total: 0, byCategory: [] };
  const unreadCount = stats.total;
  const hasUnread = unreadCount > 0;

  const notifs = notifQuery.data ?? [];

  const invalidateNotif = () => {
    qc.invalidateQueries({ queryKey: ['topbar.notifications.stats'] });
    qc.invalidateQueries({ queryKey: ['topbar.notifications.list'] });
  };

  const markReadMut = useMutation({
    mutationFn: (ids: number[]) => api!.notifications.markRead({ ids }),
    onSuccess: invalidateNotif,
  });
  const markAllReadMut = useMutation({
    mutationFn: () =>
      api!.notifications.markRead({
        all: true,
        category: notifCategory === 'all' ? null : notifCategory,
      }),
    onSuccess: (r) => {
      if (r.ok) toast.ok(`${r.updated}건을 모두 읽음 처리했습니다`);
      invalidateNotif();
    },
    onError: (e: Error) => toast.err(e.message ?? '실패'),
  });
  const dismissMut = useMutation({
    mutationFn: (ids: number[]) => api!.notifications.dismiss({ ids }),
    onSuccess: invalidateNotif,
  });
  const snoozeMut = useMutation({
    mutationFn: (p: { ids: number[]; until: string }) =>
      api!.notifications.snooze(p),
    onSuccess: (r) => {
      if (r.ok) toast.info('스누즈됨');
      invalidateNotif();
    },
    onError: (e: Error) => toast.err(e.message ?? '실패'),
  });

  function handleOpenNotif(n: NotificationItem) {
    // 열자마자 읽음 처리 + 링크 이동 (링크가 있을 때만).
    if (!n.readAt) markReadMut.mutate([n.id]);
    setNotifOpen(false);
    if (n.link) navigate(n.link);
  }

  function handleSnooze(n: NotificationItem, hours: number) {
    const until = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    snoozeMut.mutate({ ids: [n.id], until });
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!notifRef.current) return;
      if (!notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-bg-card px-4">
      <form
        onSubmit={submitSearch}
        className="flex items-center gap-2 max-w-md flex-1 relative"
        ref={searchBoxRef}
      >
        <div className="relative w-full">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="과제 검색 (코드, 과제명, 과목)"
            className="input pl-8 pr-8 h-9"
            aria-label="검색"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setOpen(false);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg"
              aria-label="지우기"
            >
              <X size={12} />
            </button>
          )}
          {open && query.trim() && (
            <div className="absolute top-full left-0 right-0 mt-1 z-40 rounded-lg border border-border bg-bg-card shadow-lg overflow-hidden">
              {assignmentsQuery.isLoading && (
                <div className="px-3 py-3 text-xs text-fg-subtle">검색 중…</div>
              )}
              {!assignmentsQuery.isLoading && matches.length === 0 && (
                <div className="px-3 py-3 text-xs text-fg-subtle">
                  일치하는 과제가 없습니다.
                </div>
              )}
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setOpen(false);
                    navigate('/assignments');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-bg-soft"
                >
                  <span className="font-mono text-[11px] text-fg-muted w-16 shrink-0">
                    {m.code}
                  </span>
                  <span className="flex-1 truncate text-fg">{m.title}</span>
                  <span className="chip bg-accent-soft text-accent-strong">
                    {m.state}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </form>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-1 text-xs text-fg-muted mr-2">
          {sinceLabel && (
            <span>
              <span
                className={cn(
                  'inline-block h-2 w-2 rounded-full mr-1.5',
                  attState === 'working' && 'bg-success',
                  attState === 'break' && 'bg-warn',
                )}
              />
              {attState === 'working' ? '근무 중' : '휴게 중'} · {sinceLabel} 부터
            </span>
          )}
        </div>

        <button
          onClick={onCheckIn}
          disabled={!live || attState !== 'off' || checkInMut.isPending}
          title="출근 기록"
          className={cn(
            'btn h-9',
            attState === 'working'
              ? 'bg-success/20 text-success border border-success/30'
              : 'btn-outline',
          )}
        >
          <LogIn size={14} /> 출근
        </button>
        <button
          onClick={onBreak}
          disabled={attState === 'off'}
          title="휴게 시작/해제 (이 세션에서만 유지)"
          className={cn(
            'btn h-9',
            attState === 'break'
              ? 'bg-warn/20 text-warn border border-warn/30'
              : 'btn-outline',
          )}
        >
          <Coffee size={14} /> 휴게
        </button>
        <button
          onClick={onCheckOut}
          disabled={!live || attState === 'off' || checkOutMut.isPending}
          title="퇴근 기록 (기본 휴게 60분 차감)"
          className="btn-outline h-9"
        >
          <LogOut size={14} /> 퇴근
        </button>

        <div className="relative ml-2" ref={notifRef}>
          <button
            type="button"
            onClick={() => setNotifOpen((v) => !v)}
            className="btn-ghost h-9 w-9 p-0 relative"
            title={hasUnread ? `알림 ${unreadCount}건` : '알림'}
            aria-label={hasUnread ? `알림 ${unreadCount}건` : '알림 없음'}
          >
            <Bell size={16} />
            {hasUnread && (
              <span
                className={cn(
                  'absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full',
                  'bg-danger text-[10px] font-semibold text-white',
                  'flex items-center justify-center leading-none',
                )}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-full mt-1 z-40 w-96 rounded-lg border border-border bg-bg-card shadow-xl">
              {/* 헤더: 제목 + 모두 읽음 */}
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-fg">알림</span>
                  {hasUnread && (
                    <span className="chip bg-danger/10 text-danger text-[10px] px-1.5 py-0">
                      미확인 {unreadCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => markAllReadMut.mutate()}
                    disabled={!hasUnread || markAllReadMut.isPending}
                    className="text-[11px] text-accent hover:underline disabled:text-fg-subtle disabled:no-underline"
                    title="현재 필터 내 미확인 알림을 모두 읽음 처리"
                  >
                    모두 읽음
                  </button>
                </div>
              </div>

              {/* 카테고리 필터 탭 */}
              <div className="flex items-center gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
                {(['all', 'approval', 'assignment', 'cs', 'tuition', 'notice', 'system'] as const).map(
                  (cat) => {
                    const count =
                      cat === 'all'
                        ? stats.total
                        : stats.byCategory.find((c) => c.category === cat)?.count ?? 0;
                    const active = notifCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setNotifCategory(cat)}
                        className={cn(
                          'shrink-0 rounded px-2 py-0.5 text-[11px]',
                          active
                            ? 'bg-accent text-white'
                            : 'text-fg-muted hover:bg-bg-soft',
                        )}
                      >
                        {cat === 'all' ? '전체' : CATEGORY_LABEL[cat] ?? cat}
                        {count > 0 && (
                          <span
                            className={cn(
                              'ml-1',
                              active ? 'text-white/80' : 'text-fg-subtle',
                            )}
                          >
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  },
                )}
              </div>

              {/* 리스트 */}
              <div className="max-h-[28rem] overflow-y-auto">
                {notifQuery.isLoading && notifs.length === 0 ? (
                  <div className="px-3 py-5 text-center text-xs text-fg-subtle">
                    불러오는 중…
                  </div>
                ) : notifs.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-fg-subtle">
                    새로운 알림이 없습니다.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {notifs.map((n) => {
                      const isUnread = !n.readAt;
                      return (
                        <li
                          key={n.id}
                          className={cn(
                            'group relative',
                            isUnread ? 'bg-accent-soft/40' : 'bg-transparent',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenNotif(n)}
                            className="block w-full px-3 py-2 text-left hover:bg-bg-soft"
                          >
                            <div className="flex items-start gap-2">
                              {isUnread && (
                                <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={cn(
                                      'shrink-0 rounded px-1 py-0 text-[10px]',
                                      CATEGORY_COLOR[n.category] ??
                                        'bg-bg-soft text-fg-muted',
                                    )}
                                  >
                                    {CATEGORY_LABEL[n.category] ?? n.category}
                                  </span>
                                  <span
                                    className={cn(
                                      'truncate text-sm',
                                      isUnread ? 'font-semibold text-fg' : 'text-fg',
                                    )}
                                  >
                                    {n.title}
                                  </span>
                                  {n.priority >= 1 && (
                                    <span className="shrink-0 rounded bg-danger/15 px-1 text-[10px] text-danger">
                                      !
                                    </span>
                                  )}
                                </div>
                                {n.body && (
                                  <div className="mt-0.5 line-clamp-2 text-[11px] text-fg-muted">
                                    {n.body}
                                  </div>
                                )}
                                <div className="mt-1 flex items-center gap-2 text-[10px] text-fg-subtle">
                                  <span>{relative(n.createdAt)}</span>
                                  {n.link && (
                                    <span className="flex items-center gap-0.5">
                                      <ExternalLink size={9} /> 이동
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </button>
                          {/* row 액션: hover 시 노출 */}
                          <div className="absolute right-2 top-2 hidden items-center gap-1 group-hover:flex">
                            {isUnread && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markReadMut.mutate([n.id]);
                                }}
                                className="rounded p-1 text-fg-subtle hover:bg-bg-card hover:text-fg"
                                title="읽음으로 표시"
                              >
                                <CheckCheck size={12} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSnooze(n, 1);
                              }}
                              className="rounded p-1 text-fg-subtle hover:bg-bg-card hover:text-fg"
                              title="1시간 스누즈"
                            >
                              <Clock size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                dismissMut.mutate([n.id]);
                              }}
                              className="rounded p-1 text-fg-subtle hover:bg-danger/20 hover:text-danger"
                              title="처리 완료 (드로워에서 제거)"
                            >
                              <BellOff size={12} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* 푸터 힌트 — 공지 아카이브로 이동 */}
              <div className="border-t border-border px-3 py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen(false);
                    navigate('/announcements');
                  }}
                  className="text-[11px] text-fg-subtle hover:text-accent"
                >
                  공지 전체 보기 →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

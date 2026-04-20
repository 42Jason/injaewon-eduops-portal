import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Coffee, LogIn, LogOut, Search, X } from 'lucide-react';
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

interface NoticeRow {
  id: number;
  title: string;
  author_name?: string | null;
  published_at: string;
}

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
  const notifRef = useRef<HTMLDivElement>(null);

  const noticesQuery = useQuery({
    queryKey: ['topbar.notices'],
    queryFn: () => api!.notices.list() as unknown as Promise<NoticeRow[]>,
    enabled: live,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  const notices = noticesQuery.data ?? [];
  const hasUnread = notices.length > 0;

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
            title="알림"
            aria-label={`알림 ${hasUnread ? '있음' : '없음'}`}
          >
            <Bell size={16} />
            {hasUnread && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-danger" />
            )}
          </button>
          {notifOpen && (
            <div className="absolute right-0 top-full mt-1 z-40 w-80 rounded-lg border border-border bg-bg-card shadow-lg">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-semibold text-fg">최근 공지</span>
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen(false);
                    navigate('/announcements');
                  }}
                  className="text-[11px] text-accent hover:underline"
                >
                  전체 보기 →
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notices.length === 0 ? (
                  <div className="px-3 py-5 text-center text-xs text-fg-subtle">
                    공지가 없습니다.
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {notices.slice(0, 6).map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setNotifOpen(false);
                            navigate('/announcements');
                          }}
                          className="block w-full px-3 py-2 text-left hover:bg-bg-soft"
                        >
                          <div className="truncate text-sm text-fg">{n.title}</div>
                          <div className="mt-0.5 text-[11px] text-fg-subtle">
                            {n.author_name ?? '—'} · {relative(n.published_at)}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

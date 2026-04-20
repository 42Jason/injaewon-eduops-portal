import { useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  LogIn,
  LogOut,
  Timer,
  TrendingDown,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import {
  fmtDate,
  fmtMinutes,
  fmtTime,
  thisMonthYm,
} from '@/lib/date';

interface TodayRow {
  id?: number;
  user_id?: number;
  work_date?: string;
  check_in?: string | null;
  check_out?: string | null;
  break_min?: number;
  note?: string | null;
}

interface MonthRow {
  id: number;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  break_min: number;
  note: string | null;
}

interface MonthStats {
  workedDays: number;
  totalMin: number;
  late: number;
  early: number;
  avgMin: number;
}

function nowClock(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function asTodayRow(raw: Record<string, unknown> | null): TodayRow | null {
  return (raw as TodayRow | null) ?? null;
}
function asMonthRows(raw: Array<Record<string, unknown>>): MonthRow[] {
  return raw as unknown as MonthRow[];
}

export function AttendancePage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();

  const [yyyymm, setYyyymm] = useState<string>(thisMonthYm());
  const [note, setNote] = useState('');
  const [breakMin, setBreakMin] = useState<number>(60);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const todayQuery = useQuery({
    queryKey: ['attendance.today', user?.id],
    queryFn: async () => asTodayRow(await api!.attendance.today(user!.id)),
    enabled: live,
    refetchInterval: 60_000,
  });

  const monthQuery = useQuery({
    queryKey: ['attendance.month', user?.id, yyyymm],
    queryFn: async () =>
      asMonthRows(await api!.attendance.month({ userId: user!.id, yyyymm })),
    enabled: live,
  });

  const statsQuery = useQuery<MonthStats>({
    queryKey: ['attendance.stats', user?.id, yyyymm],
    queryFn: () => api!.attendance.stats({ userId: user!.id, yyyymm }),
    enabled: live,
  });

  const checkInMut = useMutation({
    mutationFn: () => api!.attendance.checkIn({ userId: user!.id, note: note || undefined }),
    onSuccess: (res) => {
      if (!res.ok) {
        setToast({ kind: 'err', msg: res.error ?? '체크인 실패' });
        return;
      }
      setToast({
        kind: 'ok',
        msg: res.already ? '이미 체크인됨' : '출근 기록 완료',
      });
      qc.invalidateQueries({ queryKey: ['attendance.today', user?.id] });
      qc.invalidateQueries({ queryKey: ['attendance.month', user?.id, yyyymm] });
      qc.invalidateQueries({ queryKey: ['attendance.stats', user?.id, yyyymm] });
    },
  });

  const checkOutMut = useMutation({
    mutationFn: () =>
      api!.attendance.checkOut({ userId: user!.id, breakMin, note: note || undefined }),
    onSuccess: (res) => {
      if (!res.ok) {
        setToast({ kind: 'err', msg: res.error ?? '체크아웃 실패' });
        return;
      }
      setToast({ kind: 'ok', msg: '퇴근 기록 완료' });
      qc.invalidateQueries({ queryKey: ['attendance.today', user?.id] });
      qc.invalidateQueries({ queryKey: ['attendance.month', user?.id, yyyymm] });
      qc.invalidateQueries({ queryKey: ['attendance.stats', user?.id, yyyymm] });
    },
  });

  const today = todayQuery.data;
  const checkedIn = !!today?.check_in;
  const checkedOut = !!today?.check_out;

  // Compute worked-so-far (if checked in but not out)
  const liveWorked = useMemo(() => {
    if (!checkedIn || checkedOut || !today?.check_in) return null;
    const inD = new Date(today.check_in);
    return Math.max(0, Math.round((Date.now() - inD.getTime()) / 60000) - (today.break_min ?? 0));
  }, [checkedIn, checkedOut, today?.check_in, today?.break_min]);

  // Month-nav
  function shiftMonth(delta: number) {
    const [y, m] = yyyymm.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYyyymm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const rows = monthQuery.data ?? [];
  const stats = statsQuery.data;

  return (
    <div className="flex h-full min-h-[calc(100vh-7rem)] flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-fg-subtle" />
          <h2 className="text-lg font-semibold text-fg">근태 관리</h2>
          <span className="text-xs text-fg-subtle">출퇴근 기록 · 월간 리포트</span>
        </div>
        <div
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
            live
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {live ? '실시간 DB' : 'Electron 실행 필요'}
        </div>
      </div>

      {toast && (
        <div
          className={cn(
            'rounded-md px-3 py-2 text-xs',
            toast.kind === 'ok'
              ? 'bg-success/15 text-success border border-success/30'
              : 'bg-danger/15 text-danger border border-danger/30',
          )}
        >
          {toast.msg}
        </div>
      )}

      <div className="grid flex-1 grid-cols-12 gap-3 overflow-hidden">
        {/* LEFT — today check-in card + note */}
        <div className="col-span-5 flex flex-col gap-3 overflow-y-auto">
          <div className="card flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-fg-subtle">
              <span>오늘 · {fmtDate(new Date().toISOString())}</span>
              <span className="font-mono">{nowClock()}</span>
            </div>
            <div className="flex items-baseline gap-3">
              <div className="flex-1">
                <div className="text-[11px] uppercase tracking-wider text-fg-subtle">
                  출근
                </div>
                <div className={cn('text-2xl font-semibold', checkedIn ? 'text-fg' : 'text-fg-subtle')}>
                  {today?.check_in ? fmtTime(today.check_in) : '--:--'}
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[11px] uppercase tracking-wider text-fg-subtle">
                  퇴근
                </div>
                <div className={cn('text-2xl font-semibold', checkedOut ? 'text-fg' : 'text-fg-subtle')}>
                  {today?.check_out ? fmtTime(today.check_out) : '--:--'}
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[11px] uppercase tracking-wider text-fg-subtle">
                  실근무
                </div>
                <div className="text-2xl font-semibold text-accent">
                  {liveWorked != null
                    ? fmtMinutes(liveWorked)
                    : checkedOut && today?.check_in && today?.check_out
                      ? fmtMinutes(
                          Math.max(
                            0,
                            Math.round(
                              (new Date(today.check_out).getTime() -
                                new Date(today.check_in).getTime()) /
                                60000,
                            ) - (today.break_min ?? 0),
                          ),
                        )
                      : '-'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-fg-subtle">
                휴게 (분)
                <input
                  type="number"
                  min={0}
                  max={240}
                  step={5}
                  value={breakMin}
                  onChange={(e) => setBreakMin(Number(e.target.value))}
                  className="input mt-1 w-full text-sm"
                  disabled={!live || checkedOut}
                />
              </label>
              <label className="text-xs text-fg-subtle">
                메모
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="선택 사항 (재택 / 외근 / 지각 사유 …)"
                  className="input mt-1 w-full text-sm"
                  disabled={!live || checkedOut}
                />
              </label>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1 disabled:opacity-60"
                disabled={!live || checkedIn || checkInMut.isPending}
                onClick={() => checkInMut.mutate()}
              >
                <LogIn size={14} className="mr-1 inline" />
                {checkedIn ? '이미 출근' : checkInMut.isPending ? '처리 중…' : '출근 (체크인)'}
              </button>
              <button
                type="button"
                className="btn-outline flex-1 disabled:opacity-60"
                disabled={!live || !checkedIn || checkedOut || checkOutMut.isPending}
                onClick={() => checkOutMut.mutate()}
              >
                <LogOut size={14} className="mr-1 inline" />
                {checkedOut ? '이미 퇴근' : checkOutMut.isPending ? '처리 중…' : '퇴근 (체크아웃)'}
              </button>
            </div>

            {today?.note && (
              <div className="rounded-md bg-bg-soft px-3 py-2 text-xs text-fg-muted">
                오늘의 메모: {today.note}
              </div>
            )}
          </div>

          {/* Month stats */}
          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                월간 요약
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => shiftMonth(-1)}
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-fg-subtle hover:bg-bg-soft"
                >
                  ◀
                </button>
                <span className="font-mono text-xs text-fg">{yyyymm}</span>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-fg-subtle hover:bg-bg-soft"
                >
                  ▶
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <StatBox label="근무일" value={String(stats?.workedDays ?? 0) + '일'} icon={Calendar} />
              <StatBox label="총 근무" value={fmtMinutes(stats?.totalMin ?? 0)} icon={Timer} />
              <StatBox label="평균 근무" value={fmtMinutes(stats?.avgMin ?? 0)} icon={Clock} />
              <StatBox
                label="지각 / 조퇴"
                value={`${stats?.late ?? 0} / ${stats?.early ?? 0}`}
                icon={TrendingDown}
                tone={(stats?.late ?? 0) > 0 || (stats?.early ?? 0) > 0 ? 'warn' : 'default'}
              />
            </div>
          </div>
        </div>

        {/* RIGHT — month table */}
        <div className="col-span-7 flex flex-col overflow-hidden">
          <div className="card flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                {yyyymm} 출퇴근 로그
              </div>
              <div className="text-xs text-fg-subtle">{rows.length} 건</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-bg text-left text-xs text-fg-subtle">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-2 font-medium">일자</th>
                    <th className="py-2 pr-2 font-medium">출근</th>
                    <th className="py-2 pr-2 font-medium">퇴근</th>
                    <th className="py-2 pr-2 font-medium">휴게</th>
                    <th className="py-2 pr-2 font-medium">실근무</th>
                    <th className="py-2 pr-2 font-medium">메모</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-fg-subtle">
                        기록 없음
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => {
                    const inD = r.check_in ? new Date(r.check_in) : null;
                    const outD = r.check_out ? new Date(r.check_out) : null;
                    const worked =
                      inD && outD
                        ? Math.max(
                            0,
                            Math.round((outD.getTime() - inD.getTime()) / 60000) - (r.break_min ?? 0),
                          )
                        : null;
                    const isLate =
                      inD && (inD.getHours() > 9 || (inD.getHours() === 9 && inD.getMinutes() > 10));
                    const isEarly = outD && outD.getHours() < 18;
                    return (
                      <tr key={r.id} className="border-b border-border/60">
                        <td className="py-1.5 pr-2 font-mono text-xs text-fg">{r.work_date}</td>
                        <td
                          className={cn(
                            'py-1.5 pr-2 font-mono text-xs',
                            isLate ? 'text-warn' : 'text-fg',
                          )}
                        >
                          {fmtTime(r.check_in)}
                          {isLate && <span className="ml-1 text-[10px]">지각</span>}
                        </td>
                        <td
                          className={cn(
                            'py-1.5 pr-2 font-mono text-xs',
                            isEarly ? 'text-warn' : 'text-fg',
                          )}
                        >
                          {fmtTime(r.check_out)}
                          {isEarly && <span className="ml-1 text-[10px]">조퇴</span>}
                        </td>
                        <td className="py-1.5 pr-2 font-mono text-xs text-fg-subtle">
                          {r.break_min ?? 0}분
                        </td>
                        <td className="py-1.5 pr-2 font-mono text-xs text-fg">
                          {worked != null ? fmtMinutes(worked) : '-'}
                        </td>
                        <td className="py-1.5 pr-2 text-xs text-fg-muted">{r.note ?? '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatBoxProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone?: 'default' | 'warn';
}

function StatBox({ label, value, icon: Icon, tone = 'default' }: StatBoxProps) {
  return (
    <div className="rounded-md border border-border bg-bg-soft/60 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-fg-subtle">{label}</span>
        <Icon size={13} className={cn(tone === 'warn' ? 'text-warn' : 'text-fg-subtle')} />
      </div>
      <div className={cn('mt-1 text-base font-semibold', tone === 'warn' ? 'text-warn' : 'text-fg')}>
        {value}
      </div>
    </div>
  );
}


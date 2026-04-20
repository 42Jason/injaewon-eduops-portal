import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Clock,
  CalendarX,
  LogIn,
  LogOut,
  Timer,
  TrendingDown,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import {
  fmtDate,
  fmtMinutes,
  fmtTime,
  thisMonthYm,
} from '@/lib/date';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField, TextInput } from '@/components/ui/FormField';
import { firstError, maxLength, numberRange } from '@/lib/validators';

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

const NOTE_MAX = 200;

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
  const toast = useToast();

  const [yyyymm, setYyyymm] = useState<string>(thisMonthYm());
  const [note, setNote] = useState('');
  const [breakMin, setBreakMin] = useState<number>(60);

  const noteRules = firstError<string>([maxLength(NOTE_MAX)]);
  const breakRules = firstError<number | null | undefined>([numberRange(0, 240, '휴게는 0~240분 사이여야 합니다')]);
  const noteErr = noteRules(note);
  const breakErr = breakRules(breakMin);

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

  const checkInMut = useMutationWithToast({
    mutationFn: () => api!.attendance.checkIn({ userId: user!.id, note: note.trim() || undefined }),
    // Variable success message ("이미 체크인" vs "출근 저장됨") — emit manually.
    successMessage: false,
    errorMessage: '체크인에 실패했습니다',
    invalidates: [
      ['attendance.today', user?.id],
      ['attendance.month', user?.id, yyyymm],
      ['attendance.stats', user?.id, yyyymm],
    ],
    onSuccess: (res) => {
      if (!res.ok) return;
      if (res.already) toast.info('이미 오늘 체크인되었습니다');
      else toast.ok('출근 기록이 저장되었습니다');
    },
  });

  const checkOutMut = useMutationWithToast({
    mutationFn: () =>
      api!.attendance.checkOut({ userId: user!.id, breakMin, note: note.trim() || undefined }),
    successMessage: '퇴근 기록이 저장되었습니다',
    errorMessage: '체크아웃에 실패했습니다',
    invalidates: [
      ['attendance.today', user?.id],
      ['attendance.month', user?.id, yyyymm],
      ['attendance.stats', user?.id, yyyymm],
    ],
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

  const inputsDisabled = !live || checkedOut;
  const canCheckIn = live && !checkedIn && !noteErr && !checkInMut.isPending;
  const canCheckOut = live && checkedIn && !checkedOut && !noteErr && !breakErr && !checkOutMut.isPending;

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
          role="status"
          aria-live="polite"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {live ? '실시간 DB' : 'Electron 실행 필요'}
        </div>
      </div>

      <div className="grid flex-1 grid-cols-12 gap-3 overflow-hidden">
        {/* LEFT — today check-in card + note */}
        <div className="col-span-5 flex flex-col gap-3 overflow-y-auto">
          <div className="card flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs text-fg-subtle">
              <span>오늘 · {fmtDate(new Date().toISOString())}</span>
              <span className="font-mono" aria-label="현재 시각">{nowClock()}</span>
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

            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="휴게 (분)"
                hint="0–240분 · 5분 단위"
                error={breakErr}
              >
                {(slot) => (
                  <TextInput
                    {...slot}
                    type="number"
                    min={0}
                    max={240}
                    step={5}
                    value={breakMin}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isNaN(v)) {
                        setBreakMin(0);
                        return;
                      }
                      setBreakMin(v);
                    }}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isNaN(v)) setBreakMin(0);
                      else setBreakMin(Math.max(0, Math.min(240, v)));
                    }}
                    disabled={inputsDisabled}
                  />
                )}
              </FormField>
              <FormField
                label="메모"
                hint="선택 사항"
                error={noteErr}
                count={note.length}
                max={NOTE_MAX}
              >
                {(slot) => (
                  <TextInput
                    {...slot}
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="재택 / 외근 / 지각 사유 …"
                    disabled={inputsDisabled}
                    maxLength={NOTE_MAX + 20}
                  />
                )}
              </FormField>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1 disabled:opacity-60"
                disabled={!canCheckIn || checkedIn}
                onClick={() => checkInMut.mutate()}
                aria-live="polite"
              >
                {checkInMut.isPending ? (
                  <Spinner size={12} className="mr-1" />
                ) : (
                  <LogIn size={14} className="mr-1 inline" />
                )}
                {checkedIn ? '이미 출근' : checkInMut.isPending ? '처리 중…' : '출근 (체크인)'}
              </button>
              <button
                type="button"
                className="btn-outline flex-1 disabled:opacity-60"
                disabled={!canCheckOut}
                onClick={() => checkOutMut.mutate()}
                aria-live="polite"
              >
                {checkOutMut.isPending ? (
                  <Spinner size={12} className="mr-1" />
                ) : (
                  <LogOut size={14} className="mr-1 inline" />
                )}
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
                  aria-label="이전 달"
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-fg-subtle hover:bg-bg-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  ◀
                </button>
                <span className="font-mono text-xs text-fg" aria-label={`선택된 달: ${yyyymm}`}>{yyyymm}</span>
                <button
                  type="button"
                  onClick={() => shiftMonth(1)}
                  aria-label="다음 달"
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-fg-subtle hover:bg-bg-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  ▶
                </button>
              </div>
            </div>

            {statsQuery.isLoading ? (
              <LoadingPanel label="월간 통계를 불러오는 중…" />
            ) : statsQuery.isError ? (
              <EmptyState
                tone="error"
                icon={AlertTriangle}
                title="월간 통계를 불러오지 못했습니다"
                action={
                  <button className="btn-outline" onClick={() => statsQuery.refetch()}>
                    다시 시도
                  </button>
                }
                className="border-0 bg-transparent py-6"
              />
            ) : (
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
            )}
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
              {monthQuery.isLoading ? (
                <LoadingPanel label="월간 기록을 불러오는 중…" />
              ) : monthQuery.isError ? (
                <EmptyState
                  tone="error"
                  icon={AlertTriangle}
                  title="출퇴근 로그를 불러오지 못했습니다"
                  hint="네트워크 상태를 확인하거나 잠시 후 다시 시도해 주세요."
                  action={
                    <button className="btn-outline" onClick={() => monthQuery.refetch()}>
                      다시 시도
                    </button>
                  }
                />
              ) : rows.length === 0 ? (
                <EmptyState
                  icon={CalendarX}
                  title={`${yyyymm} 기간에 기록이 없습니다`}
                  hint="좌측 카드에서 출근 버튼을 눌러 기록을 시작해 보세요."
                />
              ) : (
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
              )}
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
  icon: React.ComponentType<React.ComponentProps<'svg'> & { size?: number | string }>;
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

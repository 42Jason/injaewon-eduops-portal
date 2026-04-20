import { useMemo, useState } from 'react';
import {
  Ban,
  Calendar,
  Check,
  Inbox,
  Plane,
  Plus,
  Scale,
  X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { fmtDate, fmtDateTime, todayLocalYmd } from '@/lib/date';

type LeaveKind = 'annual' | 'half_am' | 'half_pm' | 'sick' | 'special' | 'unpaid';
type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

interface LeaveRow {
  id: number;
  user_id: number;
  kind: LeaveKind;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  approver_id: number | null;
  decided_at: string | null;
  created_at: string;
  user_name: string | null;
  user_role: string | null;
  approver_name: string | null;
}

const KIND_LABEL: Record<LeaveKind, string> = {
  annual:   '연차',
  half_am:  '오전반차',
  half_pm:  '오후반차',
  sick:     '병가',
  special:  '경조사',
  unpaid:   '무급',
};

const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending:   '결재 대기',
  approved:  '승인',
  rejected:  '반려',
  cancelled: '취소',
};

function statusClass(s: LeaveStatus) {
  if (s === 'approved')  return 'bg-success/15 text-success border border-success/30';
  if (s === 'rejected')  return 'bg-danger/15 text-danger border border-danger/30';
  if (s === 'cancelled') return 'bg-fg-subtle/15 text-fg-subtle border border-border';
  return 'bg-warn/15 text-warn border border-warn/30';
}

const APPROVER_ROLES = new Set(['CEO', 'HR_ADMIN', 'OPS_MANAGER']);

function asLeaves(raw: Array<Record<string, unknown>>): LeaveRow[] {
  return raw as unknown as LeaveRow[];
}

export function LeavePage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();

  const isApprover = !!user && APPROVER_ROLES.has(user.role);

  const [kind, setKind] = useState<LeaveKind>('annual');
  const [startDate, setStartDate] = useState<string>(todayLocalYmd());
  const [endDate, setEndDate] = useState<string>(todayLocalYmd());
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [commentByRow, setCommentByRow] = useState<Record<number, string>>({});

  const balanceQuery = useQuery({
    queryKey: ['leave.balance', user?.id],
    queryFn: () => api!.leave.balance(user!.id),
    enabled: live,
  });

  const mineQuery = useQuery({
    queryKey: ['leave.mine', user?.id],
    queryFn: async () => asLeaves(await api!.leave.list({ userId: user!.id })),
    enabled: live,
  });

  const pendingQuery = useQuery({
    queryKey: ['leave.pending'],
    queryFn: async () => asLeaves(await api!.leave.list({ status: 'pending' })),
    enabled: live && isApprover,
  });

  const createMut = useMutation({
    mutationFn: () =>
      api!.leave.create({
        userId: user!.id,
        kind,
        startDate,
        endDate,
        reason: reason.trim() || undefined,
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setToast({ kind: 'err', msg: res.error ?? '신청 실패' });
        return;
      }
      setToast({ kind: 'ok', msg: `신청 완료 (${res.days}일)` });
      setReason('');
      qc.invalidateQueries({ queryKey: ['leave.mine', user?.id] });
      qc.invalidateQueries({ queryKey: ['leave.pending'] });
    },
  });

  const decideMut = useMutation({
    mutationFn: (payload: { id: number; decision: 'approved' | 'rejected' }) =>
      api!.leave.decide({
        id: payload.id,
        approverId: user!.id,
        decision: payload.decision,
        comment: commentByRow[payload.id]?.trim() || undefined,
      }),
    onSuccess: (res, vars) => {
      if (!res.ok) {
        setToast({ kind: 'err', msg: res.error ?? '처리 실패' });
        return;
      }
      setToast({
        kind: 'ok',
        msg:
          vars.decision === 'approved'
            ? res.deducted
              ? `승인 완료 — 연차 ${res.deducted}일 차감`
              : '승인 완료'
            : '반려 완료',
      });
      setCommentByRow((m) => {
        const n = { ...m };
        delete n[vars.id];
        return n;
      });
      qc.invalidateQueries({ queryKey: ['leave.mine'] });
      qc.invalidateQueries({ queryKey: ['leave.pending'] });
      qc.invalidateQueries({ queryKey: ['leave.balance'] });
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id: number) => api!.leave.cancel({ id, userId: user!.id }),
    onSuccess: (res) => {
      if (!res.ok) {
        setToast({ kind: 'err', msg: '취소 실패' });
        return;
      }
      setToast({ kind: 'ok', msg: '신청 취소됨' });
      qc.invalidateQueries({ queryKey: ['leave.mine', user?.id] });
      qc.invalidateQueries({ queryKey: ['leave.pending'] });
    },
  });

  const computedDays = useMemo(() => {
    if (kind === 'half_am' || kind === 'half_pm') return 0.5;
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
    if (e.getTime() < s.getTime()) return 0;
    return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
  }, [kind, startDate, endDate]);

  const mine = mineQuery.data ?? [];
  const pending = (pendingQuery.data ?? []).filter((r) => r.user_id !== user?.id);

  return (
    <div className="flex h-full min-h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plane size={18} className="text-fg-subtle" />
          <h2 className="text-lg font-semibold text-fg">휴가 관리</h2>
          <span className="text-xs text-fg-subtle">휴가 신청 · 승인 · 잔여 관리</span>
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
        {/* LEFT — apply form + balance */}
        <div className="col-span-5 flex flex-col gap-3 overflow-y-auto">
          <div className="card">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                연차 잔여
              </div>
              <Scale size={14} className="text-fg-subtle" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-accent">
                {balanceQuery.data != null
                  ? Number(balanceQuery.data).toFixed(1)
                  : '-'}
              </span>
              <span className="text-sm text-fg-subtle">일</span>
            </div>
          </div>

          <div className="card flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                휴가 신청
              </div>
              <span className="text-xs text-fg-subtle">예상 차감 {computedDays}일</span>
            </div>

            <label className="flex flex-col gap-1 text-xs text-fg-subtle">
              종류
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as LeaveKind)}
                className="input text-sm"
                disabled={!live}
              >
                {(Object.keys(KIND_LABEL) as LeaveKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-xs text-fg-subtle">
                시작일
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input text-sm"
                  disabled={!live}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-fg-subtle">
                종료일
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input text-sm"
                  disabled={!live || kind === 'half_am' || kind === 'half_pm'}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs text-fg-subtle">
              사유
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="선택 사항"
                className="input resize-none text-sm"
                disabled={!live}
              />
            </label>

            <button
              type="button"
              className="btn-primary disabled:opacity-60"
              disabled={!live || createMut.isPending || computedDays <= 0}
              onClick={() => createMut.mutate()}
            >
              <Plus size={14} className="mr-1 inline" />
              {createMut.isPending ? '신청 중…' : '휴가 신청'}
            </button>
          </div>
        </div>

        {/* RIGHT — my history + (if approver) approval queue */}
        <div className="col-span-7 flex flex-col gap-3 overflow-hidden">
          {isApprover && (
            <div className="card flex max-h-[50%] min-h-0 flex-col">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                  <Inbox size={13} /> 결재 대기 {pending.length > 0 && (
                    <span className="rounded-full bg-warn/20 px-1.5 text-[10px] text-warn">
                      {pending.length}
                    </span>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {pending.length === 0 ? (
                  <div className="py-6 text-center text-xs text-fg-subtle">
                    결재 대기 중인 휴가가 없습니다.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {pending.map((r) => (
                      <li
                        key={r.id}
                        className="rounded-md border border-border bg-bg-soft/40 px-3 py-2 text-sm"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-fg">{r.user_name ?? `#${r.user_id}`}</span>
                            <span className="text-xs text-fg-subtle">{r.user_role}</span>
                            <span className="rounded-full border border-border bg-bg px-1.5 text-[11px] text-fg">
                              {KIND_LABEL[r.kind]}
                            </span>
                          </div>
                          <span className="font-mono text-xs text-fg-subtle">
                            {fmtDate(r.start_date)}
                            {r.start_date !== r.end_date ? ` ~ ${fmtDate(r.end_date)}` : ''}
                            {' · '}
                            {r.days}일
                          </span>
                        </div>
                        {r.reason && (
                          <div className="mt-1 text-xs text-fg-muted line-clamp-2">
                            {r.reason}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="코멘트 (선택)"
                            className="input flex-1 text-xs"
                            value={commentByRow[r.id] ?? ''}
                            onChange={(e) =>
                              setCommentByRow((m) => ({ ...m, [r.id]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            className="btn-primary text-xs"
                            onClick={() => decideMut.mutate({ id: r.id, decision: 'approved' })}
                            disabled={decideMut.isPending}
                          >
                            <Check size={12} className="mr-1 inline" />
                            승인
                          </button>
                          <button
                            type="button"
                            className="btn-outline text-xs text-danger border-danger/40 hover:bg-danger/10"
                            onClick={() => decideMut.mutate({ id: r.id, decision: 'rejected' })}
                            disabled={decideMut.isPending}
                          >
                            <X size={12} className="mr-1 inline" />
                            반려
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* My history */}
          <div className="card flex min-h-0 flex-1 flex-col">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
                <Calendar size={13} /> 내 휴가 내역
              </div>
              <span className="text-xs text-fg-subtle">{mine.length} 건</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {mine.length === 0 ? (
                <div className="py-6 text-center text-xs text-fg-subtle">내역 없음</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {mine.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-md border border-border bg-bg-soft/40 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn('rounded-full px-2 py-0.5 text-[11px]', statusClass(r.status))}>
                            {STATUS_LABEL[r.status]}
                          </span>
                          <span className="rounded-full border border-border bg-bg px-1.5 text-[11px] text-fg">
                            {KIND_LABEL[r.kind]}
                          </span>
                          <span className="font-mono text-xs text-fg-subtle">
                            {fmtDate(r.start_date)}
                            {r.start_date !== r.end_date ? ` ~ ${fmtDate(r.end_date)}` : ''}
                            {' · '}
                            {r.days}일
                          </span>
                        </div>
                        {r.status === 'pending' && (
                          <button
                            type="button"
                            className="text-xs text-fg-subtle hover:text-danger"
                            onClick={() => cancelMut.mutate(r.id)}
                            disabled={cancelMut.isPending}
                          >
                            <Ban size={12} className="mr-1 inline" />
                            취소
                          </button>
                        )}
                      </div>
                      {r.reason && (
                        <div className="mt-1 whitespace-pre-line text-xs text-fg-muted">
                          {r.reason}
                        </div>
                      )}
                      <div className="mt-1 flex items-center justify-between text-[11px] text-fg-subtle">
                        <span>신청 {fmtDateTime(r.created_at)}</span>
                        {r.decided_at && (
                          <span>
                            {r.status === 'approved' ? '승인' : r.status === 'rejected' ? '반려' : '처리'} —{' '}
                            {r.approver_name ?? '-'} · {fmtDateTime(r.decided_at)}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

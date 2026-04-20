import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileCheck2,
  Check,
  X,
  Plus,
  Clock,
  ChevronRight,
  User as UserIcon,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { fmtDateTime, relative } from '@/lib/date';

type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
type StepState = 'pending' | 'approved' | 'rejected' | 'skipped';

interface ApprovalRow {
  id: number;
  code: string;
  title: string;
  kind: string;
  drafter_id: number;
  drafter_name: string | null;
  status: ApprovalStatus;
  drafted_at: string;
  closed_at: string | null;
  my_step?: number;
  my_state?: StepState;
  my_step_id?: number;
}

interface ApprovalStep {
  id: number;
  step_order: number;
  approver_id: number;
  approver_name: string | null;
  approver_role: string | null;
  state: StepState;
  comment: string | null;
  decided_at: string | null;
}

interface ApprovalDetail extends ApprovalRow {
  payload_json?: string | null;
  steps: ApprovalStep[];
}

interface UserRow {
  id: number;
  name: string;
  role: string;
  department_name?: string | null;
  active: number;
}

function statusLabel(s: ApprovalStatus): string {
  return (
    { pending: '진행중', approved: '승인', rejected: '반려', withdrawn: '철회' }[s] ?? s
  );
}
function statusChip(s: ApprovalStatus): string {
  if (s === 'approved') return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
  if (s === 'rejected') return 'bg-rose-500/15 text-rose-300 border border-rose-500/30';
  if (s === 'withdrawn') return 'bg-bg-soft text-fg-subtle border border-border';
  return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
}
function stepChip(s: StepState): string {
  if (s === 'approved') return 'bg-emerald-500/15 text-emerald-300';
  if (s === 'rejected') return 'bg-rose-500/15 text-rose-300';
  if (s === 'skipped') return 'bg-bg-soft text-fg-subtle';
  return 'bg-amber-500/15 text-amber-300';
}

type Tab = 'inbox' | 'sent';

export function ApprovalsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>('inbox');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);

  const inboxQuery = useQuery({
    queryKey: ['approvals.inbox', user?.id],
    queryFn: async () => {
      const rows = await api!.approvals.list({ approverId: user!.id });
      return rows as unknown as ApprovalRow[];
    },
    enabled: live && tab === 'inbox',
  });

  const sentQuery = useQuery({
    queryKey: ['approvals.sent', user?.id],
    queryFn: async () => {
      const rows = await api!.approvals.list({ drafterId: user!.id });
      return rows as unknown as ApprovalRow[];
    },
    enabled: live && tab === 'sent',
  });

  const rows = tab === 'inbox' ? inboxQuery.data : sentQuery.data;

  const detailQuery = useQuery({
    queryKey: ['approvals.detail', selectedId],
    queryFn: async () => (await api!.approvals.get(selectedId!)) as unknown as ApprovalDetail | null,
    enabled: live && !!selectedId,
  });

  const decideMut = useMutation({
    mutationFn: (payload: { decision: 'approved' | 'rejected'; comment?: string }) =>
      api!.approvals.decide({
        approvalId: selectedId!,
        approverId: user!.id,
        decision: payload.decision,
        comment: payload.comment,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals.inbox'] });
      qc.invalidateQueries({ queryKey: ['approvals.sent'] });
      qc.invalidateQueries({ queryKey: ['approvals.detail'] });
    },
  });

  const withdrawMut = useMutation({
    mutationFn: () => api!.approvals.withdraw({ approvalId: selectedId!, drafterId: user!.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals.sent'] });
      qc.invalidateQueries({ queryKey: ['approvals.detail'] });
    },
  });

  const [comment, setComment] = useState('');

  const myStep = useMemo(() => {
    if (!detailQuery.data || !user) return null;
    return detailQuery.data.steps.find(
      (s) => s.approver_id === user.id && s.state === 'pending',
    );
  }, [detailQuery.data, user]);

  const isEarliestPending = useMemo(() => {
    if (!myStep || !detailQuery.data) return false;
    const firstPending = detailQuery.data.steps
      .filter((s) => s.state === 'pending')
      .sort((a, b) => a.step_order - b.step_order)[0];
    return firstPending?.step_order === myStep.step_order;
  }, [myStep, detailQuery.data]);

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-fg">
            <FileCheck2 size={20} className="text-accent" />
            전자 결재
          </h1>
          <p className="mt-1 text-sm text-fg-muted">다단계 결재선 기안 / 승인 / 반려</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>
          <Plus size={14} className="mr-1" />
          새 기안
        </button>
      </header>

      <nav className="flex gap-1 border-b border-border">
        {(['inbox', 'sent'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setSelectedId(null);
            }}
            className={cn(
              'px-4 py-2 text-sm border-b-2 -mb-px',
              tab === t ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {t === 'inbox' ? '📥 결재 대기' : '📤 기안 내역'}
            <span className="ml-2 rounded-full bg-bg-soft px-2 py-0.5 text-xs text-fg-subtle">
              {rows?.length ?? 0}
            </span>
          </button>
        ))}
      </nav>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        <section className="col-span-5 card flex flex-col min-h-0">
          <div className="overflow-y-auto -mx-3 px-3 flex-1">
            {rows?.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  'w-full text-left border-b border-border py-3 hover:bg-bg-soft/50 transition',
                  selectedId === r.id && 'bg-bg-soft',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-fg-muted">{r.code}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', statusChip(r.status))}>
                    {statusLabel(r.status)}
                  </span>
                  <span className="text-xs text-fg-subtle">{r.kind}</span>
                </div>
                <p className="mt-1 text-sm text-fg">{r.title}</p>
                <div className="mt-1 text-xs text-fg-muted flex items-center gap-3">
                  <span className="inline-flex items-center gap-1">
                    <UserIcon size={12} /> {r.drafter_name ?? '-'}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock size={12} /> {relative(r.drafted_at)}
                  </span>
                  {tab === 'inbox' && r.my_step && (
                    <span className="ml-auto rounded bg-accent/15 px-2 py-0.5 text-accent">
                      {r.my_step}단계
                    </span>
                  )}
                </div>
              </button>
            )) ?? null}
            {rows && !rows.length && (
              <div className="py-10 text-center text-sm text-fg-subtle">
                {tab === 'inbox' ? '결재 대기 중인 문서가 없습니다' : '기안한 문서가 없습니다'}
              </div>
            )}
          </div>
        </section>

        <aside className="col-span-7 card flex flex-col min-h-0 overflow-y-auto">
          {detailQuery.data ? (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-fg-muted">{detailQuery.data.code}</span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      statusChip(detailQuery.data.status),
                    )}
                  >
                    {statusLabel(detailQuery.data.status)}
                  </span>
                  <span className="text-xs text-fg-subtle">{detailQuery.data.kind}</span>
                </div>
                <h2 className="mt-2 text-lg font-semibold text-fg">{detailQuery.data.title}</h2>
                <p className="mt-1 text-xs text-fg-muted">
                  기안: {detailQuery.data.drafter_name} · {fmtDateTime(detailQuery.data.drafted_at)}
                </p>
              </div>

              {detailQuery.data.payload_json && (
                <div className="rounded border border-border bg-bg-soft/50 p-3">
                  <div className="text-xs text-fg-subtle mb-1">결재 대상 정보</div>
                  <pre className="text-xs text-fg whitespace-pre-wrap break-words">
                    {JSON.stringify(JSON.parse(detailQuery.data.payload_json), null, 2)}
                  </pre>
                </div>
              )}

              <div>
                <div className="text-xs text-fg-subtle mb-2">결재선</div>
                <div className="flex flex-col gap-2">
                  {detailQuery.data.steps.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-3 rounded border border-border bg-bg-soft/30 p-2"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bg-soft text-xs text-fg">
                        {s.step_order}
                      </span>
                      <div className="flex-1">
                        <div className="text-sm text-fg">
                          {s.approver_name} <span className="text-xs text-fg-subtle">{s.approver_role}</span>
                        </div>
                        {s.comment && (
                          <div className="text-xs text-fg-muted mt-0.5">{s.comment}</div>
                        )}
                        {s.decided_at && (
                          <div className="text-xs text-fg-subtle mt-0.5">
                            {fmtDateTime(s.decided_at)}
                          </div>
                        )}
                      </div>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs', stepChip(s.state))}>
                        {statusLabel(s.state as ApprovalStatus)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {myStep && isEarliestPending && detailQuery.data.status === 'pending' && (
                <div className="rounded border border-accent/30 bg-accent/5 p-3">
                  <div className="text-xs text-accent mb-2">내 결재 차례</div>
                  <textarea
                    className="input mb-2"
                    rows={2}
                    placeholder="코멘트 (선택)"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      className="btn-ghost"
                      onClick={() => {
                        decideMut.mutate({ decision: 'rejected', comment: comment || undefined });
                        setComment('');
                      }}
                      disabled={decideMut.isPending}
                    >
                      <X size={14} className="mr-1" />
                      반려
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => {
                        decideMut.mutate({ decision: 'approved', comment: comment || undefined });
                        setComment('');
                      }}
                      disabled={decideMut.isPending}
                    >
                      <Check size={14} className="mr-1" />
                      승인
                    </button>
                  </div>
                </div>
              )}

              {tab === 'sent' &&
                detailQuery.data.status === 'pending' &&
                detailQuery.data.drafter_id === user?.id && (
                  <div className="flex justify-end">
                    <button
                      className="btn-ghost"
                      onClick={() => withdrawMut.mutate()}
                      disabled={withdrawMut.isPending}
                    >
                      결재 철회
                    </button>
                  </div>
                )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-fg-subtle text-sm">
              <ChevronRight size={24} className="mb-2" />
              문서를 선택하세요
            </div>
          )}
        </aside>
      </div>

      {showNew && (
        <NewApprovalModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ['approvals.sent'] });
            qc.invalidateQueries({ queryKey: ['approvals.inbox'] });
          }}
        />
      )}
    </div>
  );
}

function NewApprovalModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { user } = useSession();
  const api = getApi();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('지출');
  const [payload, setPayload] = useState('');
  const [approverIds, setApproverIds] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users.list.for-approvers'],
    queryFn: async () => ((await api!.users.list()) as unknown) as UserRow[],
    enabled: !!api,
  });

  const eligible = useMemo(
    () =>
      usersQuery.data?.filter(
        (u) =>
          u.active &&
          u.id !== user?.id &&
          ['CEO', 'CTO', 'OPS_MANAGER', 'HR_ADMIN'].includes(u.role),
      ) ?? [],
    [usersQuery.data, user],
  );

  const createMut = useMutation({
    mutationFn: () =>
      api!.approvals.create({
        drafterId: user!.id,
        title,
        kind,
        approverIds,
        payload: payload ? { memo: payload } : undefined,
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErr(res.error ?? '생성 실패');
        return;
      }
      onCreated();
      onClose();
    },
  });

  const toggle = (id: number) => {
    setApproverIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="card w-[640px] max-w-[90vw] flex flex-col gap-3 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-fg">새 전자결재 기안</h3>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-fg-subtle">
            결재 종류
            <select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value)}>
              {['지출', '휴가', '연장근무', '출장', '품의', '기타'].map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-fg-subtle col-span-1">
            제목
            <input
              className="input mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 파싱팀 장비 구매 요청"
            />
          </label>
        </div>

        <label className="text-xs text-fg-subtle">
          메모 / 사유
          <textarea
            className="input mt-1"
            rows={3}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
        </label>

        <div>
          <div className="text-xs text-fg-subtle mb-1">
            결재선 (순서대로 선택)
            <span className="ml-2 text-fg-muted">
              {approverIds.length}명 선택됨
            </span>
          </div>
          <div className="flex flex-col gap-1 rounded border border-border bg-bg-soft/50 p-2 max-h-40 overflow-y-auto">
            {eligible.map((u) => {
              const idx = approverIds.indexOf(u.id);
              const selected = idx >= 0;
              return (
                <button
                  key={u.id}
                  onClick={() => toggle(u.id)}
                  className={cn(
                    'flex items-center justify-between rounded px-2 py-1.5 text-sm',
                    selected ? 'bg-accent/15 text-accent' : 'text-fg hover:bg-bg-soft',
                  )}
                >
                  <span>
                    {u.name}
                    <span className="ml-2 text-xs text-fg-subtle">{u.role}</span>
                  </span>
                  {selected && <span className="text-xs">#{idx + 1}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {err && <p className="text-xs text-danger">{err}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>취소</button>
          <button
            className="btn-primary"
            onClick={() => {
              if (!title.trim()) return setErr('제목을 입력하세요');
              if (!approverIds.length) return setErr('결재자를 1명 이상 선택하세요');
              setErr(null);
              createMut.mutate();
            }}
            disabled={createMut.isPending}
          >
            기안 제출
          </button>
        </div>
      </div>
    </div>
  );
}

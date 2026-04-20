import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useToast } from '@/stores/toast';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  FormField,
  SelectInput,
  Textarea,
  TextInput,
} from '@/components/ui/FormField';
import { firstError, maxLength, required } from '@/lib/validators';
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

const COMMENT_MAX = 500;

export function ApprovalsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const toast = useToast();
  const confirm = useConfirm();

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

  const activeQuery = tab === 'inbox' ? inboxQuery : sentQuery;
  const rows = activeQuery.data;

  const detailQuery = useQuery({
    queryKey: ['approvals.detail', selectedId],
    queryFn: async () => (await api!.approvals.get(selectedId!)) as unknown as ApprovalDetail | null,
    enabled: live && !!selectedId,
  });

  const decideMut = useMutationWithToast<
    { ok: boolean; error?: string; finalStatus?: 'approved' | 'rejected' | 'pending' },
    Error,
    { decision: 'approved' | 'rejected'; comment?: string }
  >({
    mutationFn: (payload) =>
      api!.approvals.decide({
        approvalId: selectedId!,
        approverId: user!.id,
        decision: payload.decision,
        comment: payload.comment,
      }),
    successMessage: false,
    errorMessage: '결재 처리에 실패했습니다',
    invalidates: [
      ['approvals.inbox'],
      ['approvals.sent'],
      ['approvals.detail'],
      ['home.stats'],
    ],
    onSuccess: (res, vars) => {
      if (!res?.ok) return;
      const action = vars.decision === 'approved' ? '승인' : '반려';
      const finalMsg =
        res.finalStatus === 'approved'
          ? ' — 최종 승인 완료'
          : res.finalStatus === 'rejected'
            ? ' — 최종 반려'
            : ' — 다음 결재자에게 전달됨';
      toast.ok(`${action} 처리되었습니다${finalMsg}`);
    },
  });

  const withdrawMut = useMutationWithToast<
    { ok: boolean; error?: string },
    Error,
    void
  >({
    mutationFn: () => api!.approvals.withdraw({ approvalId: selectedId!, drafterId: user!.id }),
    successMessage: '기안이 철회되었습니다',
    errorMessage: '철회에 실패했습니다',
    invalidates: [
      ['approvals.sent'],
      ['approvals.detail'],
    ],
  });

  const [comment, setComment] = useState('');
  const [commentTouched, setCommentTouched] = useState(false);

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

  async function onApprove() {
    const ok = await confirm({
      title: '이 건을 승인할까요?',
      description: detailQuery.data?.title,
      confirmLabel: '승인',
    });
    if (!ok) return;
    decideMut.mutate({ decision: 'approved', comment: comment.trim() || undefined });
    setComment('');
    setCommentTouched(false);
  }

  async function onReject() {
    setCommentTouched(true);
    if (comment.trim().length < 5) {
      toast.err('반려 사유를 5자 이상 입력하세요');
      return;
    }
    const ok = await confirm({
      title: '이 건을 반려할까요?',
      description: comment.trim(),
      confirmLabel: '반려',
      tone: 'danger',
    });
    if (!ok) return;
    decideMut.mutate({ decision: 'rejected', comment: comment.trim() });
    setComment('');
    setCommentTouched(false);
  }

  async function onWithdraw() {
    const ok = await confirm({
      title: '이 기안을 철회할까요?',
      description: '철회 후에는 복구할 수 없습니다.',
      confirmLabel: '철회',
      tone: 'danger',
    });
    if (ok) withdrawMut.mutate();
  }

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

      <nav className="flex gap-1 border-b border-border" role="tablist">
        {(['inbox', 'sent'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setSelectedId(null);
            }}
            className={cn(
              'px-4 py-2 text-sm border-b-2 -mb-px focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
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
            {activeQuery.isLoading ? (
              <LoadingPanel label="목록 불러오는 중…" />
            ) : activeQuery.isError ? (
              <EmptyState
                tone="error"
                title="결재 목록을 불러오지 못했습니다"
                action={
                  <button
                    type="button"
                    onClick={() => activeQuery.refetch()}
                    className="btn-outline text-xs"
                  >
                    다시 시도
                  </button>
                }
              />
            ) : rows && rows.length ? (
              rows.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    'w-full text-left border-b border-border py-3 hover:bg-bg-soft/50 transition',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm',
                    selectedId === r.id && 'bg-bg-soft',
                  )}
                  aria-pressed={selectedId === r.id}
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
              ))
            ) : (
              <EmptyState
                title={tab === 'inbox' ? '결재 대기 문서가 없습니다' : '기안한 문서가 없습니다'}
                hint={
                  tab === 'inbox'
                    ? '결재가 지정되면 이곳에 표시됩니다.'
                    : '우측 상단의 "새 기안" 버튼으로 기안을 작성해 보세요.'
                }
              />
            )}
          </div>
        </section>

        <aside className="col-span-7 card flex flex-col min-h-0 overflow-y-auto">
          {detailQuery.isLoading && selectedId ? (
            <LoadingPanel label="문서 불러오는 중…" />
          ) : detailQuery.isError ? (
            <EmptyState
              tone="error"
              title="문서를 불러오지 못했습니다"
              action={
                <button
                  type="button"
                  onClick={() => detailQuery.refetch()}
                  className="btn-outline text-xs"
                >
                  다시 시도
                </button>
              }
            />
          ) : detailQuery.data ? (
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
                  <FormField
                    hint="반려 시 최소 5자 이상의 사유가 필요합니다."
                    count={comment.length}
                    max={COMMENT_MAX}
                    error={
                      commentTouched && comment.trim().length > 0 && comment.trim().length < 5
                        ? '반려 사유는 최소 5자 이상 입력하세요'
                        : null
                    }
                  >
                    {(slot) => (
                      <Textarea
                        {...slot}
                        rows={2}
                        placeholder="코멘트 (승인 시 선택 · 반려 시 필수)"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        maxLength={COMMENT_MAX}
                      />
                    )}
                  </FormField>
                  <div className="flex gap-2 justify-end mt-2">
                    <button
                      className="btn-ghost"
                      onClick={onReject}
                      disabled={decideMut.isPending}
                    >
                      <X size={14} className="mr-1" />
                      반려
                    </button>
                    <button
                      className="btn-primary"
                      onClick={onApprove}
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
                      onClick={onWithdraw}
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

      <NewApprovalModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onCreated={() => {
          // Cache invalidation happens inside the mutation — just close.
        }}
      />
    </div>
  );
}

const TITLE_MAX = 120;
const PAYLOAD_MAX = 2000;
const titleRules = firstError<string>([
  required('제목을 입력해 주세요'),
  maxLength(TITLE_MAX),
]);
const payloadRules = firstError<string>([maxLength(PAYLOAD_MAX)]);

function NewApprovalModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user } = useSession();
  const api = getApi();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('지출');
  const [payload, setPayload] = useState('');
  const [approverIds, setApproverIds] = useState<number[]>([]);
  const [touched, setTouched] = useState<{ title?: boolean; approvers?: boolean }>({});

  const usersQuery = useQuery({
    queryKey: ['users.list.for-approvers'],
    queryFn: async () => ((await api!.users.list()) as unknown) as UserRow[],
    enabled: !!api && open,
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

  const titleErr = titleRules(title);
  const payloadErr = payloadRules(payload);
  const approverErr =
    approverIds.length === 0 ? '결재자를 1명 이상 선택하세요' : null;
  const showTitleErr = touched.title ? titleErr : null;
  const showApproverErr = touched.approvers ? approverErr : null;

  const createMut = useMutationWithToast<
    { ok: boolean; error?: string; code?: string },
    Error,
    void
  >({
    mutationFn: () =>
      api!.approvals.create({
        drafterId: user!.id,
        title,
        kind,
        approverIds,
        payload: payload ? { memo: payload } : undefined,
      }),
    successMessage: '기안이 제출되었습니다',
    errorMessage: '기안 제출에 실패했습니다',
    invalidates: [
      ['approvals.sent'],
      ['approvals.inbox'],
    ],
    onSuccess: (res) => {
      if (!res?.ok) return;
      setTitle('');
      setKind('지출');
      setPayload('');
      setApproverIds([]);
      setTouched({});
      onCreated();
      onClose();
    },
  });

  const toggle = (id: number) => {
    setApproverIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  function handleSubmit() {
    setTouched({ title: true, approvers: true });
    if (titleErr || payloadErr || approverErr) return;
    createMut.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!createMut.isPending) onClose();
      }}
      title="새 전자결재 기안"
      size="lg"
      closeOnEsc={!createMut.isPending}
      closeOnBackdrop={!createMut.isPending}
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={createMut.isPending}
          >
            취소
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={
              createMut.isPending || !!titleErr || !!payloadErr || !!approverErr
            }
          >
            {createMut.isPending ? '제출 중…' : '기안 제출'}
          </button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-2">
          <FormField label="결재 종류" required>
            {(slot) => (
              <SelectInput {...slot} value={kind} onChange={(e) => setKind(e.target.value)}>
                {['지출', '휴가', '연장근무', '출장', '품의', '기타'].map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </SelectInput>
            )}
          </FormField>
          <FormField
            label="제목"
            required
            error={showTitleErr}
            count={title.length}
            max={TITLE_MAX}
          >
            {(slot) => (
              <TextInput
                {...slot}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                placeholder="예: 파싱팀 장비 구매 요청"
                maxLength={TITLE_MAX}
                autoFocus
              />
            )}
          </FormField>
        </div>

        <FormField
          label="메모 / 사유"
          hint="선택 사항. 결재자가 검토 시 참고합니다."
          count={payload.length}
          max={PAYLOAD_MAX}
          error={payloadErr}
        >
          {(slot) => (
            <Textarea
              {...slot}
              rows={3}
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              maxLength={PAYLOAD_MAX}
            />
          )}
        </FormField>

        <div>
          <div className="text-[11px] font-medium text-fg-muted mb-1">
            결재선 (순서대로 선택)
            <span className="ml-2 text-fg-subtle font-normal">
              {approverIds.length}명 선택됨
            </span>
            <span className="ml-1 text-danger">*</span>
          </div>
          <div className="flex flex-col gap-1 rounded border border-border bg-bg-soft/50 p-2 max-h-40 overflow-y-auto">
            {usersQuery.isLoading && (
              <div className="p-3 text-center text-xs text-fg-subtle">불러오는 중…</div>
            )}
            {!usersQuery.isLoading && eligible.length === 0 && (
              <div className="p-3 text-center text-xs text-fg-subtle">
                선택 가능한 결재자가 없습니다.
              </div>
            )}
            {eligible.map((u) => {
              const idx = approverIds.indexOf(u.id);
              const selected = idx >= 0;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    toggle(u.id);
                    setTouched((t) => ({ ...t, approvers: true }));
                  }}
                  className={cn(
                    'flex items-center justify-between rounded px-2 py-1.5 text-sm',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    selected ? 'bg-accent/15 text-accent' : 'text-fg hover:bg-bg-soft',
                  )}
                  aria-pressed={selected}
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
          <div className="mt-1 min-h-[14px] text-[11px] text-danger" role={showApproverErr ? 'alert' : undefined}>
            {showApproverErr ?? '\u00A0'}
          </div>
        </div>

        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

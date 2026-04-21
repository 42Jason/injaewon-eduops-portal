import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutGrid, AlertTriangle, Clock, User as UserIcon, Filter, RefreshCcw,
  Plus, Edit3, Trash2, CheckSquare, Square,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import type { AssignmentState, Risk } from '@shared/types/assignment';
import {
  stateChipClass,
  riskChipClass,
  riskLabel,
  formatDueLabel,
} from '@/lib/assignment';
import { cn } from '@/lib/cn';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useToast } from '@/stores/toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  AssignmentEditModal,
  BulkToolbar,
  type AssignmentEditInitial,
} from './AssignmentsPage';

interface BoardRow {
  id: number;
  code: string;
  subject: string;
  publisher?: string | null;
  student_code?: string;
  assignment_title?: string;
  title?: string;
  state: AssignmentState;
  risk: Risk;
  parser_name?: string | null;
  qa1_name?: string | null;
  qa_final_name?: string | null;
  due_at?: string | null;
  received_at?: string;
  completed_at?: string | null;
}

/** 5 kanban columns — grouped from the 16 states. */
const COLUMNS: Array<{ label: string; tone: string; states: AssignmentState[] }> = [
  {
    label: '접수/자료',
    tone: 'border-slate-500/40',
    states: ['신규접수', '자료누락'],
  },
  {
    label: '파싱',
    tone: 'border-blue-500/40',
    states: ['파싱대기', '파싱진행중', '파싱완료', '파싱확인필요'],
  },
  {
    label: '1차 QA',
    tone: 'border-violet-500/40',
    states: ['1차QA대기', '1차QA진행중', '1차QA반려'],
  },
  {
    label: '최종 QA',
    tone: 'border-teal-500/40',
    states: ['최종QA대기', '최종QA진행중', '최종QA반려'],
  },
  {
    label: '완료/보류',
    tone: 'border-emerald-500/40',
    states: ['승인완료', '수정요청', '완료', '보류'],
  },
];

const ALL_STATES: AssignmentState[] = [
  '신규접수', '자료누락',
  '파싱대기', '파싱진행중', '파싱완료', '파싱확인필요',
  '1차QA대기', '1차QA진행중', '1차QA반려',
  '최종QA대기', '최종QA진행중', '최종QA반려',
  '승인완료', '수정요청', '완료', '보류',
];

const TERMINAL: AssignmentState[] = ['승인완료', '완료', '보류'];
const DESTRUCTIVE: AssignmentState[] = ['1차QA반려', '최종QA반려', '보류', '수정요청'];

function isOverdue(row: BoardRow): boolean {
  if (!row.due_at) return false;
  if (TERMINAL.includes(row.state)) return false;
  return new Date(row.due_at).getTime() < Date.now();
}

function rowTitle(r: BoardRow): string {
  return r.assignment_title ?? r.title ?? '-';
}

function rowStudent(r: BoardRow): string {
  return r.student_code ?? '-';
}

export function OperationsBoardPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const [riskFilter, setRiskFilter] = useState<Risk | 'ALL'>('ALL');
  const [mineOnly, setMineOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);

  // CRUD state
  const [creating, setCreating] = useState(false);
  const [editingRow, setEditingRow] = useState<BoardRow | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set());
  const [bulkMenu, setBulkMenu] = useState<'state' | 'assign' | null>(null);

  const canManage = Boolean(user?.perms.isLeadership);

  const listQuery = useQuery({
    queryKey: ['board.list', mineOnly ? user?.id : null],
    queryFn: async () => {
      const filter: { state?: string; assignee?: number } = {};
      if (mineOnly && user) filter.assignee = user.id;
      const rows = (await api!.assignments.list(filter)) as unknown as BoardRow[];
      return rows;
    },
    enabled: live,
    refetchInterval: 30_000,
  });

  const summaryQuery = useQuery({
    queryKey: ['board.summary'],
    queryFn: () => api!.board.summary(),
    enabled: live,
    refetchInterval: 30_000,
  });

  const rows = useMemo(() => {
    const all = listQuery.data ?? [];
    return all.filter((r) => {
      if (riskFilter !== 'ALL' && r.risk !== riskFilter) return false;
      if (overdueOnly && !isOverdue(r)) return false;
      return true;
    });
  }, [listQuery.data, riskFilter, overdueOnly]);

  const byState = useMemo(() => {
    const m = new Map<AssignmentState, BoardRow[]>();
    for (const s of ALL_STATES) m.set(s, []);
    for (const r of rows) {
      const list = m.get(r.state);
      if (list) list.push(r);
    }
    return m;
  }, [rows]);

  const setStateMut = useMutationWithToast<
    { ok: boolean; error?: string },
    Error,
    { id: number; state: AssignmentState }
  >({
    mutationFn: (payload) => {
      if (!live || !user) return Promise.resolve({ ok: false });
      return api!.assignments.setState({
        id: payload.id,
        state: payload.state,
        actorId: user.id,
      });
    },
    successMessage: false,
    errorMessage: '상태 변경에 실패했습니다',
    invalidates: [
      ['board.list'],
      ['board.summary'],
      ['assignments.list'],
      ['home.stats'],
    ],
    onSuccess: (res, vars) => {
      if (res.ok) toast.ok(`상태가 "${vars.state}" (으)로 변경되었습니다`);
    },
  });

  // --- CRUD / bulk mutations ----------------------------------------------
  const deleteMut = useMutationWithToast<
    { ok: boolean; error?: string },
    Error,
    { id: number }
  >({
    mutationFn: (p) =>
      api!.assignments.softDelete({ id: p.id, actorId: user!.id }),
    successMessage: '과제를 삭제(보관)했습니다',
    errorMessage: '과제 삭제에 실패했습니다',
    invalidates: [
      ['board.list'],
      ['board.summary'],
      ['assignments.list'],
      ['home.stats'],
    ],
  });

  const bulkStateMut = useMutationWithToast<
    { ok: boolean; error?: string; changed?: number },
    Error,
    { ids: number[]; state: AssignmentState }
  >({
    mutationFn: (p) =>
      api!.assignments.bulkSetState({ ids: p.ids, state: p.state, actorId: user!.id }),
    successMessage: false,
    errorMessage: '일괄 상태 변경에 실패했습니다',
    invalidates: [
      ['board.list'],
      ['board.summary'],
      ['assignments.list'],
      ['home.stats'],
    ],
    onSuccess: (res, vars) => {
      if (res.ok) {
        toast.ok(`${res.changed ?? vars.ids.length}건을 "${vars.state}" 상태로 변경했습니다`);
        setCheckedIds(new Set());
        setBulkMenu(null);
      }
    },
  });

  const bulkAssignMut = useMutationWithToast<
    { ok: boolean; error?: string; changed?: number },
    Error,
    {
      ids: number[];
      parserId?: number | null;
      qa1Id?: number | null;
      qaFinalId?: number | null;
    }
  >({
    mutationFn: (p) =>
      api!.assignments.bulkAssign({
        ids: p.ids,
        parserId: p.parserId,
        qa1Id: p.qa1Id,
        qaFinalId: p.qaFinalId,
        actorId: user!.id,
      }),
    successMessage: false,
    errorMessage: '일괄 담당자 지정에 실패했습니다',
    invalidates: [['board.list'], ['assignments.list']],
    onSuccess: (res, vars) => {
      if (res.ok) {
        toast.ok(`${res.changed ?? vars.ids.length}건 담당자를 업데이트했습니다`);
        setCheckedIds(new Set());
        setBulkMenu(null);
      }
    },
  });

  const bulkDeleteMut = useMutationWithToast<
    { ok: boolean; error?: string; changed?: number },
    Error,
    { ids: number[] }
  >({
    mutationFn: (p) => api!.assignments.bulkDelete({ ids: p.ids, actorId: user!.id }),
    successMessage: false,
    errorMessage: '일괄 삭제에 실패했습니다',
    invalidates: [
      ['board.list'],
      ['board.summary'],
      ['assignments.list'],
      ['home.stats'],
    ],
    onSuccess: (res, vars) => {
      if (res.ok) {
        toast.ok(`${res.changed ?? vars.ids.length}건을 삭제(보관)했습니다`);
        setCheckedIds(new Set());
      }
    },
  });

  async function handleDeleteRow(row: BoardRow) {
    if (!live || !user) return;
    const ok = await confirm({
      title: '이 과제를 삭제할까요?',
      description: `"${rowTitle(row)}" (${row.code}) 을(를) 소프트 삭제합니다.`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!ok) return;
    deleteMut.mutate({ id: row.id });
  }

  async function handleBulkDelete() {
    if (!live || !user || checkedIds.size === 0) return;
    const ok = await confirm({
      title: `${checkedIds.size}건 과제를 일괄 삭제할까요?`,
      description: '선택한 과제를 소프트 삭제합니다. DB에는 남아있어 복구 가능합니다.',
      confirmLabel: '일괄 삭제',
      tone: 'danger',
    });
    if (!ok) return;
    bulkDeleteMut.mutate({ ids: Array.from(checkedIds) });
  }

  function toggleCheck(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Gate destructive transitions behind a confirm dialog. */
  async function requestTransition(id: number, next: AssignmentState) {
    if (DESTRUCTIVE.includes(next)) {
      const ok = await confirm({
        title: `"${next}" 상태로 전환하시겠어요?`,
        description: '이 상태 변경은 팀원들에게 알림으로 전달될 수 있습니다.',
        confirmLabel: '변경',
        tone: 'danger',
      });
      if (!ok) return;
    }
    setStateMut.mutate({ id, state: next });
  }

  const overdueCount = useMemo(() => rows.filter(isOverdue).length, [rows]);
  const riskHighCount = useMemo(() => rows.filter((r) => r.risk === 'high').length, [rows]);

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl">
          <div className="flex items-center gap-2 text-fg-muted text-sm">
            <LayoutGrid size={16} /> Electron 환경에서 실행 시 실제 데이터를 확인할 수 있습니다.
          </div>
        </div>
      </div>
    );
  }

  const boardLoading = listQuery.isLoading || (listQuery.isFetching && !listQuery.data);
  const boardError = listQuery.isError;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <LayoutGrid size={20} /> 운영 보드
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            과제 16단계 상태를 5개 칸반 컬럼으로 그룹핑 — 카드의 상태를 바로 전환할 수 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && live && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="btn-primary text-sm flex items-center gap-1.5"
            >
              <Plus size={14} /> 과제 추가
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['board.list'] });
              qc.invalidateQueries({ queryKey: ['board.summary'] });
            }}
            disabled={listQuery.isFetching}
            aria-label="새로고침"
            className="btn-outline text-sm flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
          >
            {listQuery.isFetching ? <Spinner size={14} /> : <RefreshCcw size={14} />}
            새로고침
          </button>
        </div>
      </div>

      {/* Bulk toolbar */}
      {canManage && live && checkedIds.size > 0 && (
        <BulkToolbar
          count={checkedIds.size}
          bulkMenu={bulkMenu}
          setBulkMenu={setBulkMenu}
          onBulkState={(s) =>
            bulkStateMut.mutate({ ids: Array.from(checkedIds), state: s })
          }
          onBulkAssign={(a) =>
            bulkAssignMut.mutate({ ids: Array.from(checkedIds), ...a })
          }
          onBulkDelete={handleBulkDelete}
          onClear={() => setCheckedIds(new Set())}
          pending={
            bulkStateMut.isPending || bulkAssignMut.isPending || bulkDeleteMut.isPending
          }
        />
      )}

      {/* Summary Pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          label="전체 과제"
          value={rows.length}
          icon={<LayoutGrid size={16} />}
          tone="border-border"
        />
        <SummaryCard
          label="지연 (SLA 초과)"
          value={overdueCount}
          icon={<AlertTriangle size={16} />}
          tone="border-rose-500/40"
          accent="text-rose-300"
          onClick={() => setOverdueOnly((v) => !v)}
          active={overdueOnly}
          ariaLabel={overdueOnly ? '지연 필터 해제' : '지연 과제만 보기'}
        />
        <SummaryCard
          label="고위험 과제"
          value={riskHighCount}
          icon={<AlertTriangle size={16} />}
          tone="border-amber-500/40"
          accent="text-amber-300"
          onClick={() => setRiskFilter((r) => (r === 'high' ? 'ALL' : 'high'))}
          active={riskFilter === 'high'}
          ariaLabel={riskFilter === 'high' ? '고위험 필터 해제' : '고위험 과제만 보기'}
        />
        <SummaryCard
          label="완료 (승인+완료)"
          value={(summaryQuery.data?.byState ?? []).filter((s) => s.state === '승인완료' || s.state === '완료').reduce((a, b) => a + (b.n ?? 0), 0)}
          icon={<LayoutGrid size={16} />}
          tone="border-emerald-500/40"
          accent="text-emerald-300"
        />
      </div>

      {/* Filters */}
      <div
        className="card p-3 flex items-center gap-3 flex-wrap"
        role="toolbar"
        aria-label="보드 필터"
      >
        <span className="text-xs text-fg-subtle flex items-center gap-1">
          <Filter size={14} /> 필터
        </span>
        <Chip active={riskFilter === 'ALL'} onClick={() => setRiskFilter('ALL')}>
          위험도: 전체
        </Chip>
        <Chip active={riskFilter === 'high'} onClick={() => setRiskFilter('high')}>
          높음
        </Chip>
        <Chip active={riskFilter === 'medium'} onClick={() => setRiskFilter('medium')}>
          보통
        </Chip>
        <Chip active={riskFilter === 'low'} onClick={() => setRiskFilter('low')}>
          낮음
        </Chip>
        <div className="mx-2 h-4 w-px bg-border" aria-hidden="true" />
        <Chip active={mineOnly} onClick={() => setMineOnly((v) => !v)}>
          내 담당
        </Chip>
        <Chip active={overdueOnly} onClick={() => setOverdueOnly((v) => !v)}>
          지연만
        </Chip>
        {(riskFilter !== 'ALL' || mineOnly || overdueOnly) && (
          <button
            type="button"
            onClick={() => {
              setRiskFilter('ALL');
              setMineOnly(false);
              setOverdueOnly(false);
            }}
            className="ml-auto text-xs text-fg-subtle hover:text-fg underline underline-offset-2"
          >
            필터 초기화
          </button>
        )}
      </div>

      {/* Board state */}
      {boardError ? (
        <EmptyState
          icon={AlertTriangle}
          tone="error"
          title="보드를 불러오지 못했습니다"
          hint="네트워크 또는 DB 연결 상태를 확인한 뒤 다시 시도하세요."
          action={
            <button
              type="button"
              onClick={() => listQuery.refetch()}
              className="btn-outline text-sm flex items-center gap-1.5"
            >
              <RefreshCcw size={12} /> 다시 시도
            </button>
          }
        />
      ) : boardLoading ? (
        <LoadingPanel label="보드를 불러오는 중…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={
            riskFilter !== 'ALL' || mineOnly || overdueOnly
              ? '필터와 일치하는 과제가 없습니다'
              : '표시할 과제가 없습니다'
          }
          hint={
            riskFilter !== 'ALL' || mineOnly || overdueOnly
              ? '필터를 초기화하면 더 많은 과제를 볼 수 있어요.'
              : '새 과제가 등록되면 여기에 표시됩니다.'
          }
          action={
            (riskFilter !== 'ALL' || mineOnly || overdueOnly) && (
              <button
                type="button"
                onClick={() => {
                  setRiskFilter('ALL');
                  setMineOnly(false);
                  setOverdueOnly(false);
                }}
                className="btn-outline text-sm"
              >
                필터 초기화
              </button>
            )
          }
        />
      ) : (
        /* Kanban Board */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {COLUMNS.map((col) => {
            const colRows = col.states.flatMap((s) => byState.get(s) ?? []);
            return (
              <section
                key={col.label}
                aria-label={`${col.label} 컬럼 (${colRows.length}건)`}
                className={cn('rounded-lg border-t-2 bg-bg-soft/40 flex flex-col', col.tone)}
              >
                <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold text-fg">{col.label}</span>
                  <span className="text-xs text-fg-subtle tabular-nums">{colRows.length}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[200px] max-h-[70vh] overflow-y-auto">
                  {colRows.length === 0 ? (
                    <div className="text-xs text-fg-subtle text-center py-6" role="status">
                      비어있음
                    </div>
                  ) : (
                    colRows.map((r) => (
                      <BoardCard
                        key={r.id}
                        row={r}
                        onChangeState={(next) => requestTransition(r.id, next)}
                        pending={setStateMut.isPending}
                        canManage={canManage}
                        checked={checkedIds.has(r.id)}
                        onToggleCheck={() => toggleCheck(r.id)}
                        onEdit={() => setEditingRow(r)}
                        onDelete={() => handleDeleteRow(r)}
                        deleting={deleteMut.isPending}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Create/Edit modals — reuse AssignmentsPage's modal */}
      {canManage && live && user && (
        <>
          <AssignmentEditModal
            open={creating}
            mode="create"
            initial={null}
            currentUserId={user.id}
            onClose={() => setCreating(false)}
          />
          <AssignmentEditModal
            open={!!editingRow}
            mode="edit"
            initial={editingRow as unknown as AssignmentEditInitial}
            currentUserId={user.id}
            onClose={() => setEditingRow(null)}
          />
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
  accent,
  onClick,
  active,
  ariaLabel,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
  accent?: string;
  onClick?: () => void;
  active?: boolean;
  ariaLabel?: string;
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      aria-pressed={clickable ? !!active : undefined}
      aria-label={ariaLabel}
      className={cn(
        'card flex items-center justify-between px-4 py-3 border-l-2 text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        tone,
        clickable && 'hover:bg-bg-soft/80 cursor-pointer',
        active && 'ring-1 ring-accent',
      )}
    >
      <div>
        <div className={cn('text-xs text-fg-subtle flex items-center gap-1', accent)}>
          {icon} {label}
        </div>
        <div className={cn('text-2xl font-semibold mt-1 tabular-nums', accent ?? 'text-fg')}>
          {value}
        </div>
      </div>
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      className={cn(
        'text-xs px-2 py-1 rounded border transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        active
          ? 'bg-accent/20 text-accent border-accent/40'
          : 'bg-bg-soft text-fg-muted border-border hover:border-fg-subtle',
      )}
    >
      {children}
    </button>
  );
}

function BoardCard({
  row,
  onChangeState,
  pending,
  canManage,
  checked,
  onToggleCheck,
  onEdit,
  onDelete,
  deleting,
}: {
  row: BoardRow;
  onChangeState: (next: AssignmentState) => void;
  pending: boolean;
  canManage?: boolean;
  checked?: boolean;
  onToggleCheck?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const overdue = isOverdue(row);
  const due = formatDueLabel(row.due_at ?? null);
  const dueTone =
    due.tone === 'danger'
      ? 'text-rose-300'
      : due.tone === 'warning'
        ? 'text-amber-300'
        : due.tone === 'ok'
          ? 'text-fg-muted'
          : 'text-fg-subtle';

  return (
    <article
      aria-label={`과제 ${row.code} — ${rowTitle(row)}`}
      className={cn(
        'rounded-md border bg-bg p-2.5 space-y-2 text-xs',
        'focus-within:ring-2 focus-within:ring-accent/40',
        checked ? 'border-accent/60 ring-1 ring-accent/30' : overdue ? 'border-rose-500/50' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {canManage && onToggleCheck && (
            <button
              type="button"
              onClick={onToggleCheck}
              aria-pressed={!!checked}
              aria-label={checked ? '선택 해제' : '선택'}
              className="text-fg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded"
            >
              {checked ? <CheckSquare size={13} /> : <Square size={13} />}
            </button>
          )}
          <span className="font-mono text-[10px] text-fg-subtle truncate">{row.code}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn('px-1.5 py-0.5 rounded text-[10px]', riskChipClass(row.risk))}>
            {riskLabel(row.risk)}
          </span>
          {canManage && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="과제 수정"
              title="수정"
              className="text-fg-subtle hover:text-fg p-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Edit3 size={11} />
            </button>
          )}
          {canManage && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              aria-label="과제 삭제"
              title="삭제"
              className="text-fg-subtle hover:text-rose-300 p-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 disabled:opacity-50"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="text-fg font-medium text-sm leading-snug line-clamp-2">
        {rowTitle(row)}
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
        <span className="truncate">{row.subject}</span>
        {row.publisher && <span className="text-fg-subtle">· {row.publisher}</span>}
      </div>

      <div className="flex items-center justify-between gap-1.5 text-[11px]">
        <span className="flex items-center gap-1 text-fg-subtle">
          <UserIcon size={11} aria-hidden="true" />
          {rowStudent(row)}
        </span>
        <span className={cn('flex items-center gap-1', dueTone)}>
          <Clock size={11} aria-hidden="true" />
          {due.label}
        </span>
      </div>

      {overdue && (
        <div
          className="flex items-center gap-1 text-[10px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-1.5 py-0.5"
          role="status"
        >
          <AlertTriangle size={10} aria-hidden="true" /> SLA 초과
        </div>
      )}

      <div className="pt-1 border-t border-border">
        <label className="sr-only" htmlFor={`state-${row.id}`}>
          상태 변경
        </label>
        <div className="relative">
          <select
            id={`state-${row.id}`}
            value={row.state}
            disabled={pending}
            onChange={(e) => {
              const next = e.target.value as AssignmentState;
              if (next !== row.state) onChangeState(next);
            }}
            aria-label={`${row.code} 상태 변경`}
            className={cn(
              'input text-[11px] py-1 px-1.5 w-full',
              pending && 'opacity-70',
              stateChipClass(row.state),
            )}
          >
            {ALL_STATES.map((s) => (
              <option key={s} value={s} className="bg-bg text-fg">
                {s}
              </option>
            ))}
          </select>
          {pending && (
            <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-subtle">
              <Spinner size={11} label="저장 중" />
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

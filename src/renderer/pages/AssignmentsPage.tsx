import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardList, Filter, Search, AlertTriangle, Check, X, RotateCcw,
  User as UserIcon, Clock, Sparkles, Info, FileText, Inbox,
  Plus, Edit3, Trash2, CheckSquare, Square, Users as UsersIcon,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';
import { getApi } from '@/hooks/useApi';
import { MOCK_ASSIGNMENTS } from '@shared/mock/assignments';
import type { AssignmentState, Risk } from '@shared/types/assignment';
import { ASSIGNMENT_STATES } from '@shared/types/assignment';
import {
  stateChipClass,
  riskChipClass,
  riskLabel,
  formatDueLabel,
  stateProgress,
} from '@/lib/assignment';
import { fmtDate, fmtDateTime, relative } from '@/lib/date';
import { cn } from '@/lib/cn';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import {
  STATE_GROUPS,
  pick,
  rowCompleted,
  rowDue,
  rowParserName,
  rowQa1Name,
  rowQaFinalName,
  rowReceived,
  rowRubric,
  rowScope,
  rowStudent,
  rowTitle,
} from './assignments/model';
import type { AssignmentRow, ParsingRow, QaReviewRow } from './assignments/model';
import {
  ActionButtons,
  AssigneeCard,
  AssignmentEditModal,
  type AssignmentEditInitial,
  BulkToolbar,
  ParsingCard,
  ResultPill,
  Stat,
} from './assignments/components';

export { AssignmentEditModal, BulkToolbar };
export type { AssignmentEditInitial };

export function AssignmentsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const toast = useToast();
  const confirm = useConfirm();

  // --- filter state --------------------------------------------------------
  const [stateFilter, setStateFilter] = useState<AssignmentState | 'ALL'>('ALL');
  const [riskFilter, setRiskFilter] = useState<Risk | 'ALL'>('ALL');
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // --- CRUD + bulk state ---------------------------------------------------
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set());
  const [bulkMenu, setBulkMenu] = useState<'state' | 'assign' | null>(null);

  // 권한: 리더십(CEO/CTO/OPS_MANAGER)만 CRUD/일괄작업 사용
  const canManage = Boolean(user?.perms.isLeadership);

  // --- queries -------------------------------------------------------------
  const listQuery = useQuery({
    queryKey: ['assignments.list', stateFilter, mineOnly ? user?.id : null],
    queryFn: async () => {
      const filter: { state?: string; assignee?: number } = {};
      if (stateFilter !== 'ALL') filter.state = stateFilter;
      if (mineOnly && user) filter.assignee = user.id;
      const rows = (await api!.assignments.list(filter)) as unknown as AssignmentRow[];
      return rows;
    },
    enabled: live,
  });

  const rows: AssignmentRow[] = useMemo(() => {
    if (live) return listQuery.data ?? [];
    // Mock mode — apply same filters client-side.
    return MOCK_ASSIGNMENTS.filter((a) => {
      if (stateFilter !== 'ALL' && a.state !== stateFilter) return false;
      if (mineOnly && user) {
        if (a.parserId !== user.id && a.qa1Id !== user.id && a.qaFinalId !== user.id) return false;
      }
      return true;
    }) as unknown as AssignmentRow[];
  }, [live, listQuery.data, stateFilter, mineOnly, user]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (riskFilter !== 'ALL' && r.risk !== riskFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [
          r.code,
          r.subject,
          r.publisher ?? '',
          rowTitle(r),
          rowStudent(r),
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, riskFilter, search]);

  // Default selection
  const selected = useMemo(() => {
    if (!filteredRows.length) return null;
    const found = filteredRows.find((r) => r.id === selectedId);
    return found ?? filteredRows[0];
  }, [filteredRows, selectedId]);

  // Details / parsing / reviews for the currently selected assignment
  const parsingQuery = useQuery({
    queryKey: ['assignments.parsing', selected?.id],
    queryFn: () => api!.assignments.parsingResult(selected!.id) as Promise<ParsingRow | null>,
    enabled: live && !!selected,
  });
  const reviewsQuery = useQuery({
    queryKey: ['assignments.reviews', selected?.id],
    queryFn: () => api!.assignments.qaReviews(selected!.id) as unknown as Promise<QaReviewRow[]>,
    enabled: live && !!selected,
  });

  const setStateMut = useMutationWithToast<
    { ok: boolean; error?: string },
    Error,
    { state: AssignmentState; note?: string }
  >({
    mutationFn: (payload) => {
      if (!live || !selected || !user)
        return Promise.resolve({ ok: false, error: '권한/연결 없음' } as { ok: boolean; error?: string });
      return api!.assignments.setState({
        id: selected.id,
        state: payload.state,
        actorId: user.id,
        note: payload.note,
      });
    },
    // Variable success text per target state — emit manually.
    successMessage: false,
    errorMessage: '상태 변경에 실패했습니다',
    invalidates: [
      ['assignments.list'],
      ['assignments.reviews', selected?.id],
      ['home.stats'],
    ],
    onSuccess: (res, vars) => {
      if (res.ok) toast.ok(`상태가 "${vars.state}" (으)로 변경되었습니다`);
    },
  });

  async function requestTransition(next: AssignmentState) {
    // Ask before destructive transitions; silent path for routine steps.
    const destructive: AssignmentState[] = ['1차QA반려', '최종QA반려', '보류', '수정요청'];
    const isDestructive = destructive.includes(next);
    if (isDestructive) {
      const ok = await confirm({
        title: `${next} 처리할까요?`,
        description: '이 변경은 QA 이력에 기록되며 담당자에게 알림이 갑니다.',
        confirmLabel: next,
        tone: 'danger',
      });
      if (!ok) return;
    }
    setStateMut.mutate({ state: next });
  }

  // --- single delete + bulk mutations -------------------------------------
  const deleteMut = useMutationWithToast<
    { ok: boolean; error?: string },
    Error,
    { id: number }
  >({
    mutationFn: (payload) =>
      api!.assignments.softDelete({ id: payload.id, actorId: user!.id }),
    successMessage: '과제를 삭제(보관)했습니다',
    errorMessage: '과제 삭제에 실패했습니다',
    invalidates: [['assignments.list'], ['home.stats'], ['board.list'], ['board.summary']],
    onSuccess: () => {
      setSelectedId(null);
    },
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
    invalidates: [['assignments.list'], ['home.stats'], ['board.list'], ['board.summary']],
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
    invalidates: [['assignments.list'], ['board.list']],
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
    invalidates: [['assignments.list'], ['home.stats'], ['board.list'], ['board.summary']],
    onSuccess: (res, vars) => {
      if (res.ok) {
        toast.ok(`${res.changed ?? vars.ids.length}건을 삭제(보관)했습니다`);
        setCheckedIds(new Set());
        setSelectedId(null);
      }
    },
  });

  async function handleDeleteOne() {
    if (!selected || !live || !user) return;
    const ok = await confirm({
      title: '이 과제를 삭제할까요?',
      description: `"${rowTitle(selected)}" (${selected.code}) 을(를) 소프트 삭제합니다. 목록에서는 보이지 않지만 DB에는 남아있어 복구가 가능합니다.`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!ok) return;
    deleteMut.mutate({ id: selected.id });
  }

  async function handleBulkDelete() {
    if (checkedIds.size === 0 || !live || !user) return;
    const ok = await confirm({
      title: `${checkedIds.size}건의 과제를 일괄 삭제할까요?`,
      description: '선택한 과제를 소프트 삭제합니다. DB에는 남아있어 복구가 가능합니다.',
      confirmLabel: '일괄 삭제',
      tone: 'danger',
    });
    if (!ok) return;
    bulkDeleteMut.mutate({ ids: Array.from(checkedIds) });
  }

  // --- selection helpers --------------------------------------------------
  function toggleCheck(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCheckAll(ids: number[]) {
    setCheckedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }

  // --- derived: counts for filter pills ------------------------------------
  const counts = useMemo(() => {
    const byState = new Map<AssignmentState, number>();
    for (const r of rows) byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
    return {
      total: rows.length,
      high: rows.filter((r) => r.risk === 'high').length,
      byState,
    };
  }, [rows]);

  // ========================================================================
  return (
    <div className="flex h-full min-h-[calc(100vh-7rem)] flex-col gap-3">
      {/* ---- top header ---- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={18} className="text-fg-subtle" />
          <h2 className="text-lg font-semibold text-fg">과제 관리</h2>
          <span className="text-xs text-fg-subtle">
            16단계 상태머신 · {counts.total}건
            {counts.high > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-rose-300">
                <AlertTriangle size={11} /> 고위험 {counts.high}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {canManage && live && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="btn-primary inline-flex items-center gap-1 text-xs"
            >
              <Plus size={12} /> 과제 추가
            </button>
          )}
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
              live
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {live ? '실시간 DB' : '브라우저 프리뷰 (Mock)'}
          </span>
        </div>
      </div>

      {/* ---- bulk toolbar (appears when rows are checked) ---- */}
      {canManage && live && checkedIds.size > 0 && (
        <BulkToolbar
          count={checkedIds.size}
          bulkMenu={bulkMenu}
          setBulkMenu={setBulkMenu}
          onBulkState={(s) => bulkStateMut.mutate({ ids: Array.from(checkedIds), state: s })}
          onBulkAssign={(assignments) =>
            bulkAssignMut.mutate({ ids: Array.from(checkedIds), ...assignments })
          }
          onBulkDelete={handleBulkDelete}
          onClear={() => setCheckedIds(new Set())}
          pending={
            bulkStateMut.isPending || bulkAssignMut.isPending || bulkDeleteMut.isPending
          }
        />
      )}

      {/* ---- filter bar ---- */}
      <div className="card flex flex-wrap items-center gap-2 py-2">
        <div className="flex items-center gap-1 text-xs text-fg-subtle">
          <Filter size={12} /> 상태
        </div>
        <button
          onClick={() => setStateFilter('ALL')}
          className={cn(
            'rounded-full border px-2 py-0.5 text-[11px]',
            stateFilter === 'ALL'
              ? 'border-accent text-accent bg-accent/10'
              : 'border-border text-fg-muted hover:bg-bg-soft',
          )}
        >
          전체
        </button>
        {STATE_GROUPS.map((g) => (
          <div key={g.label} className="flex items-center gap-1">
            <span className="text-[10px] text-fg-subtle">{g.label}</span>
            {g.states.map((s) => {
              const n = counts.byState.get(s) ?? 0;
              if (n === 0 && stateFilter !== s) return null;
              return (
                <button
                  key={s}
                  onClick={() => setStateFilter(stateFilter === s ? 'ALL' : s)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[11px]',
                    stateFilter === s
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-fg-muted hover:bg-bg-soft',
                  )}
                >
                  {s} {n > 0 && <span className="ml-0.5 text-fg-subtle">{n}</span>}
                </button>
              );
            })}
          </div>
        ))}

        <div className="mx-1 h-4 w-px bg-border" />

        <div className="flex items-center gap-1">
          <span className="text-[10px] text-fg-subtle">위험</span>
          {(['ALL', 'high', 'medium', 'low'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRiskFilter(r)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px]',
                riskFilter === r
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-fg-muted hover:bg-bg-soft',
              )}
            >
              {r === 'ALL' ? '전체' : riskLabel(r)}
            </button>
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-border" />

        <label className="flex items-center gap-1 text-[11px] text-fg-muted">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
            className="h-3 w-3 rounded border-border bg-bg-soft accent-accent"
          />
          내 건만
        </label>

        <div className="ml-auto flex items-center gap-1">
          <Search size={12} className="text-fg-subtle" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="과제명/학생코드/출판사…"
            className="input h-7 w-60 text-xs"
          />
        </div>
      </div>

      {/* ---- 3-panel body ---- */}
      <div className="grid flex-1 grid-cols-12 gap-3 overflow-hidden">
        {/* LEFT — list */}
        <div className="col-span-4 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-soft/30">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[11px] text-fg-subtle">
            <span className="flex items-center gap-2">
              {canManage && live && filteredRows.length > 0 && (
                <button
                  type="button"
                  onClick={() => toggleCheckAll(filteredRows.map((r) => r.id))}
                  aria-label="전체 선택 토글"
                  className="inline-flex items-center text-fg-muted hover:text-fg"
                >
                  {filteredRows.every((r) => checkedIds.has(r.id)) ? (
                    <CheckSquare size={12} className="text-accent" />
                  ) : (
                    <Square size={12} />
                  )}
                </button>
              )}
              <span>과제 목록 ({filteredRows.length})</span>
              {checkedIds.size > 0 && (
                <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">
                  선택 {checkedIds.size}
                </span>
              )}
            </span>
            {listQuery.isFetching && (
              <span className="inline-flex items-center gap-1" aria-live="polite">
                <Spinner size={10} /> 불러오는 중…
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {live && listQuery.isLoading ? (
              <LoadingPanel label="과제 목록을 불러오는 중…" />
            ) : live && listQuery.isError ? (
              <EmptyState
                tone="error"
                icon={AlertTriangle}
                title="과제 목록을 불러오지 못했습니다"
                action={
                  <button className="btn-outline" onClick={() => listQuery.refetch()}>
                    다시 시도
                  </button>
                }
                className="border-0"
              />
            ) : filteredRows.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="필터 조건에 맞는 과제가 없습니다"
                hint={search.trim() ? '검색어를 지우거나 필터를 초기화해 보세요.' : '상단의 상태/위험 필터를 확인해 주세요.'}
                action={
                  <button
                    className="btn-outline"
                    onClick={() => {
                      setStateFilter('ALL');
                      setRiskFilter('ALL');
                      setMineOnly(false);
                      setSearch('');
                    }}
                  >
                    필터 초기화
                  </button>
                }
                className="border-0"
              />
            ) : (
              filteredRows.map((r) => {
                const due = formatDueLabel(rowDue(r));
                const isSel = selected?.id === r.id;
                const isChecked = checkedIds.has(r.id);
                return (
                  <div
                    key={r.id}
                    className={cn(
                      'flex items-stretch hover:bg-bg-soft/60 transition-colors',
                      isSel && 'bg-accent/10 border-l-2 border-l-accent',
                    )}
                  >
                    {canManage && live && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCheck(r.id);
                        }}
                        aria-label={isChecked ? '선택 해제' : '선택'}
                        aria-pressed={isChecked}
                        className="px-2 flex items-center justify-center text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {isChecked ? (
                          <CheckSquare size={14} className="text-accent" />
                        ) : (
                          <Square size={14} />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      aria-pressed={isSel}
                      className={cn(
                        'flex-1 text-left px-3 py-2.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono text-[10px] text-fg-subtle shrink-0">{r.code}</span>
                          <span className={cn('inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-tight', stateChipClass(r.state))}>
                            {r.state}
                          </span>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 text-[10px]',
                            due.tone === 'danger'  && 'text-rose-300',
                            due.tone === 'warning' && 'text-amber-300',
                            due.tone === 'ok'      && 'text-fg-muted',
                            due.tone === 'muted'   && 'text-fg-subtle',
                          )}
                        >
                          {due.label}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-1 text-xs font-medium text-fg">{rowTitle(r)}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-fg-subtle">
                        <span>{r.subject}</span>
                        {r.publisher && <span>· {r.publisher}</span>}
                        <span>· {rowStudent(r)}</span>
                        <span className={cn('ml-auto rounded px-1 py-0.5', riskChipClass(r.risk))}>
                          {riskLabel(r.risk)}
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* MIDDLE — detail + parsing */}
        <div className="col-span-5 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-soft/30">
          {!selected ? (
            <EmptyState
              icon={ClipboardList}
              title="왼쪽 목록에서 과제를 선택하세요"
              hint="과제 상세, 파싱 결과, QA 이력을 이곳에서 확인합니다."
              className="flex-1 border-0 bg-transparent"
            />
          ) : (
            <>
              <div className="border-b border-border px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] text-fg-subtle min-w-0">
                    <span className="font-mono">{selected.code}</span>
                    <span className={cn('rounded px-1.5 py-0.5', stateChipClass(selected.state))}>{selected.state}</span>
                    <span className={cn('rounded px-1.5 py-0.5', riskChipClass(selected.risk))}>{riskLabel(selected.risk)}</span>
                  </div>
                  {canManage && live && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="btn-outline inline-flex items-center gap-1 text-[11px] px-2 py-1"
                        aria-label="과제 수정"
                      >
                        <Edit3 size={11} /> 수정
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteOne}
                        disabled={deleteMut.isPending}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-[11px] px-2 py-1 disabled:opacity-50"
                        aria-label="과제 삭제"
                      >
                        <Trash2 size={11} /> 삭제
                      </button>
                    </div>
                  )}
                </div>
                <h3 className="mt-1 text-[15px] font-semibold text-fg">{rowTitle(selected)}</h3>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-fg-muted">
                  <span>{selected.subject}</span>
                  {selected.publisher && <span>· {selected.publisher}</span>}
                  <span>· 학생 {rowStudent(selected)}</span>
                  {rowScope(selected) && <span>· 범위: {rowScope(selected)}</span>}
                </div>
                {/* progress bar */}
                <div className="mt-3">
                  <div className="h-1 w-full rounded-full bg-bg-soft">
                    <div
                      className="h-1 rounded-full bg-accent"
                      style={{ width: `${stateProgress(selected.state)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-fg-subtle">
                    <span>신규접수</span>
                    <span>{stateProgress(selected.state)}%</span>
                    <span>완료</span>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
                {/* Assignees row */}
                <section>
                  <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-subtle">
                    <UserIcon size={11} /> 담당자
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <AssigneeCard role="파싱"   name={rowParserName(selected)} />
                    <AssigneeCard role="1차 QA" name={rowQa1Name(selected)} />
                    <AssigneeCard role="최종 QA" name={rowQaFinalName(selected)} />
                  </div>
                </section>

                {/* Dates */}
                <section className="grid grid-cols-3 gap-2 text-xs">
                  <Stat label="접수"   value={fmtDateTime(rowReceived(selected))} />
                  <Stat label="마감"   value={fmtDate(rowDue(selected))}      tone={formatDueLabel(rowDue(selected)).tone} />
                  <Stat label="완료일" value={fmtDate(rowCompleted(selected))} />
                </section>

                {/* Rubric / outline */}
                {(rowRubric(selected) || selected.outline) && (
                  <section>
                    <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-subtle">
                      <FileText size={11} /> 평가 기준 / 개요
                    </div>
                    <div className="rounded-lg border border-border bg-bg-soft/40 p-3 text-xs text-fg leading-relaxed">
                      {rowRubric(selected) && <div><span className="text-fg-subtle">평가기준</span>  {rowRubric(selected)}</div>}
                      {selected.outline && <div className="mt-1"><span className="text-fg-subtle">개요</span>  {selected.outline}</div>}
                    </div>
                  </section>
                )}

                {/* Parsing result */}
                <section>
                  <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-subtle">
                    <Sparkles size={11} /> 파싱 결과 & AI 요약
                  </div>
                  {live ? (
                    parsingQuery.isLoading ? (
                      <LoadingPanel label="파싱 결과 불러오는 중…" className="min-h-[60px]" />
                    ) : parsingQuery.isError ? (
                      <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
                        파싱 결과를 불러오지 못했습니다.{' '}
                        <button
                          className="underline focus:outline-none focus-visible:ring-2 focus-visible:ring-danger rounded"
                          onClick={() => parsingQuery.refetch()}
                        >
                          다시 시도
                        </button>
                      </div>
                    ) : parsingQuery.data ? (
                      <ParsingCard data={parsingQuery.data} />
                    ) : (
                      <div className="rounded-lg border border-dashed border-border bg-bg-soft/40 p-3 text-xs text-fg-subtle">
                        아직 파싱 결과가 없습니다.
                      </div>
                    )
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-bg-soft/40 p-3 text-xs text-fg-subtle">
                      브라우저 프리뷰 모드 — 파싱 결과는 Electron 실행 시 표시됩니다.
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>

        {/* RIGHT — QA / approval */}
        <div className="col-span-3 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-soft/30">
          <div className="border-b border-border px-3 py-1.5 text-[11px] text-fg-subtle">
            액션
          </div>
          {!selected ? (
            <EmptyState
              icon={ClipboardList}
              title="과제를 선택하세요"
              className="flex-1 border-0 bg-transparent"
            />
          ) : (
            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
              <ActionButtons
                state={selected.state}
                canParse={user?.perms.canParseAssignments}
                canQa1={user?.perms.canReviewQA1}
                canQaFinal={user?.perms.canReviewQAFinal}
                disabled={!live || setStateMut.isPending}
                pending={setStateMut.isPending}
                onTransition={(s) => void requestTransition(s)}
              />

              {/* QA history */}
              <section>
                <div className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider text-fg-subtle">
                  <Clock size={11} /> QA 이력
                </div>
                {!live ? (
                  <div className="text-[11px] text-fg-subtle">Mock 모드 — 이력은 DB 모드에서 표시</div>
                ) : reviewsQuery.isLoading ? (
                  <LoadingPanel label="이력 불러오는 중…" className="min-h-[60px]" />
                ) : reviewsQuery.isError ? (
                  <div className="rounded border border-danger/30 bg-danger/5 p-2 text-[11px] text-danger">
                    이력을 불러오지 못했습니다.{' '}
                    <button
                      className="underline"
                      onClick={() => reviewsQuery.refetch()}
                    >
                      다시 시도
                    </button>
                  </div>
                ) : reviewsQuery.data && reviewsQuery.data.length > 0 ? (
                  <ul className="space-y-2">
                    {reviewsQuery.data.map((r) => (
                      <li key={r.id} className="rounded-md border border-border bg-bg-soft/40 p-2">
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="rounded bg-bg-soft px-1 py-0.5 font-medium">{r.stage === 'QA1' ? '1차 QA' : '최종 QA'}</span>
                          <ResultPill result={r.result} />
                          <span className="ml-auto text-fg-subtle">{relative(r.reviewed_at)}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-fg">{r.reviewer_name ?? '-'}</div>
                        {r.comment && <div className="mt-0.5 text-[11px] text-fg-muted">{r.comment}</div>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[11px] text-fg-subtle">이력이 없습니다.</div>
                )}
              </section>

              <div className="rounded-md border border-border bg-bg-soft/40 p-2 text-[10px] text-fg-subtle leading-relaxed">
                <Info size={11} className="inline -mt-0.5 mr-1" />
                권한은 역할 기반으로 제한됩니다. 파싱팀 → 파싱 완료, 1차 QA → 승인/반려, 최종 QA → 승인완료/수정요청.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ---- Create / Edit modals ---- */}
      {canManage && live && user && (
        <>
          <AssignmentEditModal
            open={creating}
            mode="create"
            initial={null}
            currentUserId={user.id}
            currentUserRole={user.role}
            onClose={() => setCreating(false)}
            onCreated={(id) => setSelectedId(id)}
          />
          <AssignmentEditModal
            open={editing && !!selected}
            mode="edit"
            initial={selected ?? null}
            currentUserId={user.id}
            currentUserRole={user.role}
            onClose={() => setEditing(false)}
          />
        </>
      )}
    </div>
  );
}

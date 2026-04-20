import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ClipboardList, Filter, Search, AlertTriangle, Check, X, RotateCcw,
  User as UserIcon, Clock, Sparkles, Info, FileText, Inbox,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';
import { getApi } from '@/hooks/useApi';
import { MOCK_ASSIGNMENTS } from '@shared/mock/assignments';
import type { AssignmentState, Risk } from '@shared/types/assignment';
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

/** The shape we actually render — union of DB row and mock. */
interface AssignmentRow {
  id: number;
  code: string;
  subject: string;
  publisher?: string | null;
  student_code?: string;
  studentCode?: string;
  title?: string;
  assignmentTitle?: string;
  scope?: string | null;
  assignmentScope?: string | null;
  state: AssignmentState;
  risk: Risk;
  parser_id?: number | null;
  qa1_id?: number | null;
  qa_final_id?: number | null;
  parserId?: number | null;
  qa1Id?: number | null;
  qaFinalId?: number | null;
  parser_name?: string | null;
  qa1_name?: string | null;
  qa_final_name?: string | null;
  due_at?: string | null;
  dueAt?: string | null;
  received_at?: string;
  receivedAt?: string;
  completed_at?: string | null;
  completedAt?: string | null;
  rubric?: string | null;
  outline?: string | null;
  teacher_requirements?: string | null;
  teacherRequirements?: string | null;
  student_requests?: string | null;
  studentRequests?: string | null;
  length_requirement?: string | null;
  lengthRequirement?: string | null;
}

interface ParsingRow {
  id?: number;
  assignment_id?: number;
  version?: number;
  content_json?: string;
  ai_summary?: string | null;
  confidence?: number | null;
  parsed_by?: number | null;
  parsed_at?: string;
}

interface QaReviewRow {
  id: number;
  stage: 'QA1' | 'QA_FINAL';
  result: 'approved' | 'rejected' | 'revision_requested';
  comment?: string | null;
  reviewed_at: string;
  reviewer_name?: string | null;
  reviewer_role?: string | null;
}

/** Read a field regardless of whether it came from snake-case DB row or camel mock. */
function pick<T>(row: AssignmentRow, a: keyof AssignmentRow, b: keyof AssignmentRow): T | undefined {
  return (row[a] ?? row[b]) as T | undefined;
}

function rowTitle(r: AssignmentRow): string {
  return (pick<string>(r, 'assignmentTitle', 'title') ?? '-') as string;
}
function rowStudent(r: AssignmentRow): string {
  return (pick<string>(r, 'studentCode', 'student_code') ?? '-') as string;
}
function rowScope(r: AssignmentRow): string | null {
  return (pick<string>(r, 'assignmentScope', 'scope') ?? null) as string | null;
}
function rowDue(r: AssignmentRow): string | null {
  return (pick<string>(r, 'dueAt', 'due_at') ?? null) as string | null;
}
function rowReceived(r: AssignmentRow): string | undefined {
  return pick<string>(r, 'receivedAt', 'received_at');
}
function rowCompleted(r: AssignmentRow): string | null {
  return (pick<string>(r, 'completedAt', 'completed_at') ?? null) as string | null;
}
function rowParserName(r: AssignmentRow): string | null {
  return (r.parser_name ?? null);
}
function rowQa1Name(r: AssignmentRow): string | null {
  return (r.qa1_name ?? null);
}
function rowQaFinalName(r: AssignmentRow): string | null {
  return (r.qa_final_name ?? null);
}
function rowRubric(r: AssignmentRow): string | null {
  return (r.rubric ?? null);
}

const STATE_GROUPS: Array<{ label: string; states: AssignmentState[] }> = [
  { label: '파싱',      states: ['파싱대기', '파싱진행중', '파싱완료', '파싱확인필요'] },
  { label: '1차 QA',    states: ['1차QA대기', '1차QA진행중', '1차QA반려'] },
  { label: '최종 QA',   states: ['최종QA대기', '최종QA진행중', '최종QA반려'] },
  { label: '완료/보류', states: ['승인완료', '수정요청', '완료', '보류'] },
];

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
            <span>과제 목록 ({filteredRows.length})</span>
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
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    aria-pressed={isSel}
                    className={cn(
                      'w-full text-left px-3 py-2.5 hover:bg-bg-soft/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      isSel && 'bg-accent/10 border-l-2 border-l-accent',
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
                <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
                  <span className="font-mono">{selected.code}</span>
                  <span className={cn('rounded px-1.5 py-0.5', stateChipClass(selected.state))}>{selected.state}</span>
                  <span className={cn('rounded px-1.5 py-0.5', riskChipClass(selected.risk))}>{riskLabel(selected.risk)}</span>
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
    </div>
  );
}

/* ========================================================================= */
/* helpers                                                                   */

function AssigneeCard({ role, name }: { role: string; name: string | null }) {
  return (
    <div className="rounded-md border border-border bg-bg-soft/40 p-2">
      <div className="text-[10px] text-fg-subtle">{role}</div>
      <div className={cn('mt-0.5 truncate', name ? 'text-fg' : 'text-fg-subtle')}>
        {name ?? '미배정'}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'warning' | 'ok' | 'muted';
}) {
  return (
    <div className="rounded-md border border-border bg-bg-soft/40 p-2">
      <div className="text-[10px] text-fg-subtle">{label}</div>
      <div
        className={cn(
          'mt-0.5',
          tone === 'danger'  && 'text-rose-300',
          tone === 'warning' && 'text-amber-300',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ParsingCard({ data }: { data: ParsingRow }) {
  let fields: Record<string, unknown> | null = null;
  try {
    fields = data.content_json ? JSON.parse(data.content_json) : null;
  } catch {
    fields = null;
  }
  return (
    <div className="rounded-lg border border-border bg-bg-soft/40 p-3 space-y-2">
      {data.ai_summary && (
        <div className="rounded-md border border-accent/30 bg-accent/5 p-2 text-xs text-fg leading-relaxed">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">AI 요약</span>
          <div className="mt-0.5">{data.ai_summary}</div>
          {typeof data.confidence === 'number' && (
            <div className="mt-1 text-[10px] text-fg-subtle">신뢰도 {Math.round(data.confidence * 100)}%</div>
          )}
        </div>
      )}
      {fields && (
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
          {(
            [
              ['subject',             '과목'],
              ['publisher',           '출판사'],
              ['studentCode',         '학생'],
              ['assignmentTitle',     '수행평가명'],
              ['assignmentScope',     '수행범위'],
              ['lengthRequirement',   '분량'],
              ['outline',             '개요'],
              ['rubric',              '평가기준'],
              ['teacherRequirements', '교사요구'],
              ['studentRequests',     '학생요구'],
            ] as const
          ).map(([k, label]) => {
            const v = fields![k];
            if (!v) return null;
            return (
              <div key={k} className="col-span-2 grid grid-cols-[80px_1fr] gap-2">
                <dt className="text-fg-subtle">{label}</dt>
                <dd className="text-fg">{String(v)}</dd>
              </div>
            );
          })}
        </dl>
      )}
      <div className="text-[10px] text-fg-subtle">파싱 시각: {fmtDateTime(data.parsed_at)} · v{data.version ?? 1}</div>
    </div>
  );
}

function ResultPill({ result }: { result: QaReviewRow['result'] }) {
  if (result === 'approved')
    return <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-emerald-300">승인</span>;
  if (result === 'rejected')
    return <span className="rounded bg-rose-500/15 px-1 py-0.5 text-rose-300">반려</span>;
  return <span className="rounded bg-amber-500/15 px-1 py-0.5 text-amber-300">수정요청</span>;
}

function ActionButtons({
  state,
  canParse,
  canQa1,
  canQaFinal,
  disabled,
  pending,
  onTransition,
}: {
  state: AssignmentState;
  canParse?: boolean;
  canQa1?: boolean;
  canQaFinal?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onTransition: (next: AssignmentState) => void;
}) {
  const buttons: Array<{ label: string; next: AssignmentState; icon: typeof Check; variant: 'primary' | 'danger' | 'ghost' }> = [];

  if (canParse) {
    if (state === '파싱대기' || state === '신규접수')
      buttons.push({ label: '파싱 시작', next: '파싱진행중', icon: Sparkles, variant: 'primary' });
    if (state === '파싱진행중' || state === '파싱확인필요')
      buttons.push({ label: '파싱 완료 → 1차 QA', next: '1차QA대기', icon: Check, variant: 'primary' });
  }

  if (canQa1) {
    if (state === '1차QA대기')
      buttons.push({ label: '1차 QA 시작', next: '1차QA진행중', icon: Sparkles, variant: 'primary' });
    if (state === '1차QA진행중') {
      buttons.push({ label: '승인 → 최종 QA', next: '최종QA대기', icon: Check,  variant: 'primary' });
      buttons.push({ label: '반려',           next: '1차QA반려',  icon: X,      variant: 'danger' });
    }
    if (state === '1차QA반려')
      buttons.push({ label: '재파싱 요청',   next: '파싱진행중',  icon: RotateCcw, variant: 'ghost' });
  }

  if (canQaFinal) {
    if (state === '최종QA대기')
      buttons.push({ label: '최종 QA 시작',     next: '최종QA진행중', icon: Sparkles, variant: 'primary' });
    if (state === '최종QA진행중') {
      buttons.push({ label: '승인완료',         next: '승인완료',      icon: Check,    variant: 'primary' });
      buttons.push({ label: '수정요청',         next: '수정요청',      icon: RotateCcw, variant: 'ghost' });
      buttons.push({ label: '반려',             next: '최종QA반려',    icon: X,        variant: 'danger' });
    }
    if (state === '승인완료')
      buttons.push({ label: '완료 처리',        next: '완료',          icon: Check,    variant: 'primary' });
  }

  if (buttons.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-soft/40 p-3 text-[11px] text-fg-subtle">
        현재 상태에서 수행 가능한 액션이 없거나 권한이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {buttons.map((b) => {
        const Icon = b.icon;
        return (
          <button
            key={b.label + b.next}
            type="button"
            onClick={() => onTransition(b.next)}
            disabled={disabled}
            className={cn(
              'w-full inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              b.variant === 'primary' && 'border-accent bg-accent/10 text-accent hover:bg-accent/20',
              b.variant === 'danger'  && 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
              b.variant === 'ghost'   && 'border-border bg-bg-soft text-fg-muted hover:bg-bg-soft/70',
            )}
          >
            {pending ? <Spinner size={12} /> : <Icon size={12} />} {b.label}
          </button>
        );
      })}
    </div>
  );
}

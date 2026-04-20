import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LayoutGrid, AlertTriangle, Clock, User as UserIcon, Filter, RefreshCcw,
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

  const [riskFilter, setRiskFilter] = useState<Risk | 'ALL'>('ALL');
  const [mineOnly, setMineOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);

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

  const setStateMut = useMutation({
    mutationFn: (payload: { id: number; state: AssignmentState }) => {
      if (!live || !user) return Promise.resolve({ ok: false });
      return api!.assignments.setState({
        id: payload.id,
        state: payload.state,
        actorId: user.id,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['board.list'] });
      qc.invalidateQueries({ queryKey: ['board.summary'] });
      qc.invalidateQueries({ queryKey: ['assignments.list'] });
      qc.invalidateQueries({ queryKey: ['home.stats'] });
    },
  });

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
        <button
          type="button"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ['board.list'] });
            qc.invalidateQueries({ queryKey: ['board.summary'] });
          }}
          className="btn-outline text-sm flex items-center gap-1.5"
        >
          <RefreshCcw size={14} /> 새로고침
        </button>
      </div>

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
        />
        <SummaryCard
          label="고위험 과제"
          value={riskHighCount}
          icon={<AlertTriangle size={16} />}
          tone="border-amber-500/40"
          accent="text-amber-300"
          onClick={() => setRiskFilter((r) => (r === 'high' ? 'ALL' : 'high'))}
          active={riskFilter === 'high'}
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
      <div className="card p-3 flex items-center gap-3 flex-wrap">
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
        <div className="mx-2 h-4 w-px bg-border" />
        <Chip active={mineOnly} onClick={() => setMineOnly((v) => !v)}>
          내 담당
        </Chip>
        <Chip active={overdueOnly} onClick={() => setOverdueOnly((v) => !v)}>
          지연만
        </Chip>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {COLUMNS.map((col) => {
          const colRows = col.states.flatMap((s) => byState.get(s) ?? []);
          return (
            <div
              key={col.label}
              className={cn('rounded-lg border-t-2 bg-bg-soft/40 flex flex-col', col.tone)}
            >
              <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold text-fg">{col.label}</span>
                <span className="text-xs text-fg-subtle">{colRows.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[200px] max-h-[70vh] overflow-y-auto">
                {colRows.length === 0 && (
                  <div className="text-xs text-fg-subtle text-center py-6">비어있음</div>
                )}
                {colRows.map((r) => (
                  <BoardCard
                    key={r.id}
                    row={r}
                    onChangeState={(next) => setStateMut.mutate({ id: r.id, state: next })}
                    pending={setStateMut.isPending}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
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
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: string;
  accent?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={cn(
        'card flex items-center justify-between px-4 py-3 border-l-2 text-left transition',
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
      className={cn(
        'text-xs px-2 py-1 rounded border transition',
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
}: {
  row: BoardRow;
  onChangeState: (next: AssignmentState) => void;
  pending: boolean;
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
    <div
      className={cn(
        'rounded-md border bg-bg p-2.5 space-y-2 text-xs',
        overdue ? 'border-rose-500/50' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-fg-subtle">{row.code}</span>
        <span className={cn('px-1.5 py-0.5 rounded text-[10px]', riskChipClass(row.risk))}>
          {riskLabel(row.risk)}
        </span>
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
          <UserIcon size={11} />
          {rowStudent(row)}
        </span>
        <span className={cn('flex items-center gap-1', dueTone)}>
          <Clock size={11} />
          {due.label}
        </span>
      </div>

      {overdue && (
        <div className="flex items-center gap-1 text-[10px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-1.5 py-0.5">
          <AlertTriangle size={10} /> SLA 초과
        </div>
      )}

      <div className="pt-1 border-t border-border">
        <select
          value={row.state}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.value as AssignmentState;
            if (next !== row.state) onChangeState(next);
          }}
          className={cn(
            'input text-[11px] py-1 px-1.5 w-full',
            stateChipClass(row.state),
          )}
        >
          {ALL_STATES.map((s) => (
            <option key={s} value={s} className="bg-bg text-fg">
              {s}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

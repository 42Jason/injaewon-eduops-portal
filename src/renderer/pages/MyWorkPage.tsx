import { useMemo, useState } from 'react';
import {
  ClipboardList,
  AlertTriangle,
  Timer,
  CheckCircle2,
  Filter,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';

interface AssignmentRow {
  id: number;
  code: string;
  title: string;
  subject: string;
  state: string;
  due_at: string | null;
  risk: string;
  parser_name?: string | null;
  qa1_name?: string | null;
  qa_final_name?: string | null;
  updated_at?: string;
}

type FilterKey = 'all' | 'due_soon' | 'rejected' | 'in_progress' | 'done';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'in_progress', label: '진행 중' },
  { key: 'due_soon', label: '마감 임박' },
  { key: 'rejected', label: '반려' },
  { key: 'done', label: '완료' },
];

const REJECTED_STATES = ['자료누락', '반려', '1차QA반려', '최종QA반려'];
const IN_PROGRESS_STATES = [
  '신규접수', '파싱대기', '파싱진행중', '파싱완료', '파싱확인필요',
  '1차QA대기', '1차QA진행중', '최종QA대기', '최종QA진행중', '수정요청', '보류',
];
const DONE_STATES = ['승인완료', '완료'];

function stateBadge(state: string) {
  if (REJECTED_STATES.some((s) => state.includes(s))) return 'bg-danger/15 text-danger';
  if (DONE_STATES.some((s) => state.includes(s))) return 'bg-success/15 text-success';
  if (['1차QA대기', '최종QA대기', '수정요청', '보류'].some((s) => state.includes(s)))
    return 'bg-warn/15 text-warn';
  return 'bg-accent-soft text-accent-strong';
}

function formatDue(iso: string | null): { label: string; tone: 'danger' | 'warn' | 'muted' } {
  if (!iso) return { label: '—', tone: 'muted' };
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffH = diffMs / 3_600_000;
  const hhmm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = d.toLocaleDateString('ko-KR');
  if (diffMs < 0) return { label: `지연 (${dateStr})`, tone: 'danger' };
  if (diffH < 24) return { label: `오늘 ${hhmm}`, tone: 'warn' };
  if (diffH < 48) return { label: `내일 ${hhmm}`, tone: 'warn' };
  return { label: dateStr, tone: 'muted' };
}

export function MyWorkPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();

  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const listQuery = useQuery({
    queryKey: ['myWork.list', user?.id],
    queryFn: () =>
      api!.assignments.list({ assignee: user!.id }) as unknown as Promise<AssignmentRow[]>,
    enabled: live,
  });

  const rows: AssignmentRow[] = listQuery.data ?? [];

  const counts = useMemo(() => {
    const now = Date.now();
    let dueSoon = 0, rejected = 0, inProgress = 0, done = 0;
    for (const r of rows) {
      if (REJECTED_STATES.some((s) => r.state.includes(s))) rejected++;
      if (DONE_STATES.some((s) => r.state.includes(s))) done++;
      else if (IN_PROGRESS_STATES.some((s) => r.state.includes(s))) inProgress++;
      if (r.due_at) {
        const diffH = (new Date(r.due_at).getTime() - now) / 3_600_000;
        if (diffH < 48) dueSoon++;
      }
    }
    return { total: rows.length, dueSoon, rejected, inProgress, done };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'rejected' && !REJECTED_STATES.some((s) => r.state.includes(s))) return false;
      if (filter === 'in_progress' && !IN_PROGRESS_STATES.some((s) => r.state.includes(s))) return false;
      if (filter === 'done' && !DONE_STATES.some((s) => r.state.includes(s))) return false;
      if (filter === 'due_soon') {
        if (!r.due_at) return false;
        const diffH = (new Date(r.due_at).getTime() - Date.now()) / 3_600_000;
        if (diffH >= 48) return false;
      }
      if (q) {
        const hay = `${r.code} ${r.title} ${r.subject}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, search]);

  if (!live) {
    return (
      <div className="card">
        <h1 className="text-lg font-semibold text-fg">내 업무</h1>
        <p className="mt-2 text-sm text-fg-muted">
          로그인 후에 내 담당 과제를 확인할 수 있습니다.
        </p>
      </div>
    );
  }

  const stat: { label: string; value: number | string; icon: typeof ClipboardList; tone?: string }[] = [
    { label: '전체 담당', value: counts.total, icon: ClipboardList },
    { label: '진행 중', value: counts.inProgress, icon: Timer, tone: 'text-accent' },
    { label: '마감 임박', value: counts.dueSoon, icon: AlertTriangle, tone: 'text-warn' },
    { label: '반려', value: counts.rejected, icon: AlertTriangle, tone: 'text-danger' },
    { label: '완료', value: counts.done, icon: CheckCircle2, tone: 'text-success' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">내 업무</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {user?.name} 님께 배정된 과제 목록입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => qc.invalidateQueries({ queryKey: ['myWork.list'] })}
          className="btn-ghost text-xs"
        >
          <RefreshCw size={12} className={cn(listQuery.isFetching && 'animate-spin')} /> 새로고침
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {stat.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="card">
              <div className="flex items-start justify-between">
                <div className="text-xs text-fg-muted">{c.label}</div>
                <Icon size={14} className={cn(c.tone ?? 'text-accent')} />
              </div>
              <div className="mt-2 text-2xl font-semibold text-fg">{c.value}</div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Filter size={14} className="text-fg-subtle" />
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                  filter === f.key
                    ? 'bg-accent text-white'
                    : 'bg-bg-soft text-fg-muted hover:bg-bg-card hover:text-fg',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="ml-auto relative">
            <Search
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="과제 코드/제목 검색"
              className="input pl-7 py-1.5 text-xs w-56"
            />
          </div>
        </div>

        {listQuery.isLoading ? (
          <div className="py-10 text-center text-xs text-fg-subtle">불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center">
            <div className="mx-auto w-10 h-10 rounded-full bg-bg-soft grid place-items-center mb-2">
              <ClipboardList size={18} className="text-fg-subtle" />
            </div>
            <p className="text-sm text-fg-muted">
              {rows.length === 0
                ? '아직 배정된 과제가 없습니다.'
                : '조건에 맞는 항목이 없습니다.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-fg-subtle border-b border-border">
                  <th className="py-2 pr-3 font-medium">ID</th>
                  <th className="py-2 pr-3 font-medium">과제명</th>
                  <th className="py-2 pr-3 font-medium">과목</th>
                  <th className="py-2 pr-3 font-medium">상태</th>
                  <th className="py-2 pr-3 font-medium">리스크</th>
                  <th className="py-2 pr-3 font-medium text-right">마감</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const due = formatDue(r.due_at);
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-bg-soft/50">
                      <td className="py-2 pr-3 font-mono text-[11px] text-fg-muted">{r.code}</td>
                      <td className="py-2 pr-3 text-fg">{r.title}</td>
                      <td className="py-2 pr-3 text-fg-muted text-xs">{r.subject}</td>
                      <td className="py-2 pr-3">
                        <span className={cn('chip', stateBadge(r.state))}>{r.state}</span>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <span
                          className={cn(
                            'chip',
                            r.risk === 'high' && 'bg-danger/15 text-danger',
                            r.risk === 'medium' && 'bg-warn/15 text-warn',
                            r.risk === 'low' && 'bg-success/15 text-success',
                          )}
                        >
                          {r.risk ?? '—'}
                        </span>
                      </td>
                      <td
                        className={cn(
                          'py-2 pr-3 text-right text-xs whitespace-nowrap',
                          due.tone === 'danger' && 'text-danger',
                          due.tone === 'warn' && 'text-warn',
                          due.tone === 'muted' && 'text-fg-muted',
                        )}
                      >
                        {due.label}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

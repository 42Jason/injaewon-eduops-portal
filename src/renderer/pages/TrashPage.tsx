import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Trash2,
  RotateCcw,
  Search,
  AlertCircle,
  Loader2,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useToast } from '@/stores/toast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtDateTime } from '@/lib/date';
import { cn } from '@/lib/cn';

// -----------------------------------------------------------------------------
// TrashPage — 휴지통 (recycle bin / undo center)
//
// 모든 모듈에서 hard-DELETE 직전에 deleted_records 에 row 가 백업되므로,
// 여기서 카테고리별로 묶어서 보고, 한 건씩 복원하거나 영구 삭제할 수 있다.
//
// 권한: opsAdmin (CEO/CTO/운영실장).
// -----------------------------------------------------------------------------

const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'operations', label: '운영보드' },
  { key: 'students', label: '학생' },
  { key: 'cs', label: 'CS' },
  { key: 'admin', label: '행정' },
  { key: 'knowledge', label: '지식' },
  { key: 'org', label: '조직' },
  { key: 'parsing', label: '파싱' },
  { key: 'other', label: '기타' },
];

interface TrashRow {
  id: number;
  tableName: string;
  rowId: number | null;
  category: string;
  categoryLabel: string;
  label: string | null;
  reason: string | null;
  deletedBy: number | null;
  deletedByName: string | null;
  deletedAt: string;
  purgedAt: string | null;
  payloadPreview: Record<string, string>;
}

export function TrashPage() {
  const { user } = useSession();
  const toast = useToast();
  const api = getApi();
  const qc = useQueryClient();

  const isOpsAdmin =
    user?.role === 'CEO' || user?.role === 'CTO' || user?.role === 'OPS_MANAGER';

  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [includePurged, setIncludePurged] = useState<boolean>(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  const statsQuery = useQuery({
    queryKey: ['trash', 'stats'],
    enabled: !!api && isOpsAdmin,
    queryFn: async () => {
      if (!api) throw new Error('no-api');
      return api.trash.stats();
    },
  });

  const listQuery = useQuery({
    queryKey: ['trash', 'list', category, search, includePurged],
    enabled: !!api && isOpsAdmin,
    queryFn: async () => {
      if (!api) throw new Error('no-api');
      return api.trash.list({
        category: category === 'all' ? null : category,
        search: search.trim() || null,
        includePurged,
        limit: 300,
      });
    },
  });

  const rows: TrashRow[] = listQuery.data ?? [];

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const restoreMutation = useMutationWithToast({
    mutationFn: async (id: number) => {
      if (!api) throw new Error('no-api');
      const res = await api.trash.restore({ id });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    successMessage: '복원되었습니다',
    errorMessage: '복원에 실패했습니다',
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['trash'] });
      // 복원된 데이터의 도메인 쿼리도 무효화 — 가장 일반적인 키들만.
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['assignments'] });
      qc.invalidateQueries({ queryKey: ['cs'] });
      qc.invalidateQueries({ queryKey: ['workLogs'] });
      qc.invalidateQueries({ queryKey: ['subscriptions'] });
      qc.invalidateQueries({ queryKey: ['corpCards'] });
      qc.invalidateQueries({ queryKey: ['manuals'] });
      qc.invalidateQueries({ queryKey: ['parsing'] });
      if (data.newId) {
        toast.ok(`원래 ID 가 이미 사용 중이어서 새 ID #${data.restoredId} 로 복원되었습니다.`);
      }
    },
  });

  const purgeMutation = useMutationWithToast({
    mutationFn: async (ids: number[]) => {
      if (!api) throw new Error('no-api');
      const res = await api.trash.purge({ ids });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    successMessage: '영구 삭제되었습니다',
    errorMessage: '영구 삭제에 실패했습니다',
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['trash'] });
    },
  });

  const purgeAllMutation = useMutationWithToast({
    mutationFn: async (cat: string) => {
      if (!api) throw new Error('no-api');
      const res = await api.trash.purgeAll({
        category: cat === 'all' ? null : cat,
      });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    successMessage: '비우기가 완료되었습니다',
    errorMessage: '비우기에 실패했습니다',
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['trash'] });
    },
  });

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !allSelected;
  const visibleStats = useMemo(() => {
    if (!statsQuery.data) return null;
    return statsQuery.data;
  }, [statsQuery.data]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!isOpsAdmin) {
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertCircle}
          title="권한이 없습니다"
          hint="휴지통은 운영실장 이상만 접근할 수 있습니다."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 헤더 */}
      <div className="border-b border-border bg-bg-soft px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold text-fg">
              <Trash2 size={20} className="text-rose-500" />
              휴지통
            </h1>
            <p className="mt-0.5 text-xs text-fg-subtle">
              운영보드, 학생, CS, 행정, 조직, 지식, 파싱 모듈에서 삭제된 항목을
              복원할 수 있습니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                listQuery.refetch();
                statsQuery.refetch();
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-card px-3 py-1.5 text-xs text-fg-muted hover:bg-bg-soft"
            >
              <RefreshCw size={14} />
              새로고침
            </button>
            <button
              disabled={
                purgeAllMutation.isPending ||
                (visibleStats?.total ?? 0) === 0
              }
              onClick={() => {
                const label =
                  category === 'all'
                    ? '전체 휴지통'
                    : `'${CATEGORIES.find((c) => c.key === category)?.label ?? category}' 카테고리`;
                if (
                  window.confirm(
                    `${label}을(를) 영구 비우시겠습니까?\n복원이 불가능합니다.`,
                  )
                ) {
                  purgeAllMutation.mutate(category);
                }
              }}
              className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Trash2 size={14} />
              {category === 'all' ? '전체 비우기' : '카테고리 비우기'}
            </button>
          </div>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="border-b border-border bg-bg px-6 py-3">
        {statsQuery.isLoading ? (
          <div className="text-xs text-fg-subtle">집계 중...</div>
        ) : visibleStats ? (
          <div className="flex flex-wrap gap-2">
            <StatChip
              label="전체"
              count={visibleStats.total}
              active={category === 'all'}
              onClick={() => setCategory('all')}
            />
            {CATEGORIES.filter((c) => c.key !== 'all').map((c) => {
              const item = visibleStats.byCategory.find(
                (x) => x.category === c.key,
              );
              return (
                <StatChip
                  key={c.key}
                  label={c.label}
                  count={item?.count ?? 0}
                  oldest={item?.oldest ?? null}
                  active={category === c.key}
                  onClick={() => setCategory(c.key)}
                />
              );
            })}
          </div>
        ) : null}
      </div>

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-bg px-6 py-3">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="라벨/사유/테이블명 검색"
            className="rounded-md border border-border bg-bg-card pl-7 pr-3 py-1.5 text-xs text-fg outline-none focus:border-accent"
          />
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={includePurged}
            onChange={(e) => setIncludePurged(e.target.checked)}
          />
          처리완료 항목 포함
        </label>
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-fg-muted">
              {selected.size}건 선택됨
            </span>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    `선택한 ${selected.size}건을 영구 삭제하시겠습니까?\n복원이 불가능합니다.`,
                  )
                ) {
                  purgeMutation.mutate(Array.from(selected));
                }
              }}
              disabled={purgeMutation.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-500/20 disabled:opacity-50"
            >
              <Trash2 size={12} />
              선택 영구 삭제
            </button>
          </div>
        )}
      </div>

      {/* 본문 — 행 리스트 */}
      <div className="flex-1 overflow-y-auto px-6 py-3">
        {listQuery.isLoading ? (
          <LoadingPanel label="휴지통을 불러오는 중..." />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Trash2}
            title="휴지통이 비었습니다"
            hint={
              category === 'all'
                ? '삭제된 항목이 없습니다.'
                : '이 카테고리에 삭제된 항목이 없습니다.'
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-bg-soft text-xs uppercase text-fg-subtle">
                <tr>
                  <th className="w-10 px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelected(new Set(rows.map((r) => r.id)));
                        } else {
                          setSelected(new Set());
                        }
                      }}
                    />
                  </th>
                  <th className="px-3 py-2 text-left">카테고리</th>
                  <th className="px-3 py-2 text-left">대상</th>
                  <th className="px-3 py-2 text-left">사유</th>
                  <th className="px-3 py-2 text-left">삭제자</th>
                  <th className="px-3 py-2 text-left">삭제 시각</th>
                  <th className="px-3 py-2 text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const checked = selected.has(row.id);
                  const purged = !!row.purgedAt;
                  return (
                    <tr
                      key={row.id}
                      className={cn(
                        'border-t border-border align-top',
                        purged && 'bg-bg-soft/40 text-fg-subtle',
                        !purged && 'hover:bg-bg-soft/40',
                      )}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(row.id);
                            else next.delete(row.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center rounded-full bg-bg-soft px-2 py-0.5 text-xs">
                          {row.categoryLabel}
                        </span>
                        <div className="mt-1 text-[10px] text-fg-subtle">
                          {row.tableName}#{row.rowId ?? '?'}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-fg">
                          {row.label ?? <span className="text-fg-subtle">(라벨 없음)</span>}
                        </div>
                        {Object.keys(row.payloadPreview).length > 0 && (
                          <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-fg-subtle">
                            {Object.entries(row.payloadPreview).map(([k, v]) => (
                              <div key={k} className="truncate">
                                <span className="text-fg-muted/70">{k}: </span>
                                {v}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        {row.reason ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        {row.deletedByName ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-muted">
                        <div className="flex items-center gap-1">
                          <Clock size={11} />
                          {fmtDateTime(row.deletedAt)}
                        </div>
                        {purged && (
                          <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                            처리완료: {fmtDateTime(row.purgedAt!)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            disabled={
                              purged || restoreMutation.isPending
                            }
                            onClick={() => {
                              if (
                                window.confirm(
                                  `'${row.label ?? row.tableName + '#' + row.rowId}' 을(를) 복원하시겠습니까?`,
                                )
                              ) {
                                restoreMutation.mutate(row.id);
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-500/20 disabled:opacity-40"
                          >
                            {restoreMutation.isPending ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RotateCcw size={12} />
                            )}
                            복원
                          </button>
                          <button
                            disabled={purgeMutation.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `이 항목을 영구 삭제하시겠습니까?\n복원이 불가능합니다.`,
                                )
                              ) {
                                purgeMutation.mutate([row.id]);
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-500/20 disabled:opacity-40"
                          >
                            <Trash2 size={12} />
                            영구
                          </button>
                        </div>
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

// -----------------------------------------------------------------------------
// 카테고리별 통계 칩
// -----------------------------------------------------------------------------
function StatChip({
  label,
  count,
  oldest,
  active,
  onClick,
}: {
  label: string;
  count: number;
  oldest?: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent-strong font-medium'
          : 'border-border bg-bg-card text-fg-muted hover:bg-bg-soft',
      )}
      title={oldest ? `가장 오래된 항목: ${fmtDateTime(oldest)}` : undefined}
    >
      <span>{label}</span>
      <span
        className={cn(
          'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-semibold',
          active ? 'bg-accent text-white' : 'bg-bg-soft text-fg-subtle',
        )}
      >
        {count}
      </span>
    </button>
  );
}

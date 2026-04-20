import { useMemo, useState } from 'react';
import { NotebookPen, Plus, Trash2, Pencil, Check, X, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useToast } from '@/stores/toast';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { FormField, TextInput, Textarea } from '@/components/ui/FormField';
import { Spinner, LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { firstError, maxLength, required } from '@/lib/validators';
import { cn } from '@/lib/cn';
import { fmtDate, todayLocalYmd } from '@/lib/date';

interface WorkLogRow {
  id: number;
  user_id: number;
  log_date: string;
  summary: string;
  details: string | null;
  tags: string | null;
  created_at: string;
  user_name?: string | null;
}

function addDays(ymd: string, delta: number): string {
  const d = new Date(ymd);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const summaryRules = firstError<string>([
  required('요약을 입력해 주세요'),
  maxLength(200, '요약은 최대 200자까지 입력할 수 있습니다'),
]);

export function WorkLogsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const today = todayLocalYmd();
  const [from, setFrom] = useState<string>(addDays(today, -30));
  const [to, setTo] = useState<string>(today);

  const [draft, setDraft] = useState({
    logDate: today,
    summary: '',
    details: '',
    tags: '',
  });
  const [draftTouched, setDraftTouched] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({ summary: '', details: '', tags: '' });
  const [editTouched, setEditTouched] = useState(false);

  const listQuery = useQuery({
    queryKey: ['workLogs.list', user?.id, from, to],
    queryFn: async () => {
      const raw = await api!.workLogs.list({ userId: user!.id, from, to, limit: 365 });
      return raw as unknown as WorkLogRow[];
    },
    enabled: live,
  });

  const createMut = useMutationWithToast({
    mutationFn: (payload: {
      logDate: string; summary: string; details?: string; tags?: string;
    }) => api!.workLogs.create({ userId: user!.id, ...payload }),
    successMessage: '업무 일지가 저장되었습니다',
    errorMessage: '저장에 실패했습니다',
    invalidates: [['workLogs.list']],
    onSuccess: () => {
      setDraft((d) => ({ ...d, summary: '', details: '', tags: '' }));
      setDraftTouched(false);
    },
  });

  const updateMut = useMutationWithToast({
    mutationFn: (payload: {
      id: number; summary: string; details?: string; tags?: string;
    }) => api!.workLogs.update({ userId: user!.id, ...payload }),
    successMessage: '수정되었습니다',
    errorMessage: '수정에 실패했습니다',
    invalidates: [['workLogs.list']],
    onSuccess: () => {
      setEditingId(null);
      setEditTouched(false);
    },
  });

  const deleteMut = useMutationWithToast({
    mutationFn: (id: number) => api!.workLogs.delete({ id, userId: user!.id }),
    successMessage: '삭제되었습니다',
    errorMessage: '삭제에 실패했습니다',
    invalidates: [['workLogs.list']],
  });

  const rows = listQuery.data ?? [];

  const byDate = useMemo(() => {
    const m = new Map<string, WorkLogRow[]>();
    for (const r of rows) {
      (m.get(r.log_date) ?? m.set(r.log_date, []).get(r.log_date)!).push(r);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  const draftSummaryError = draftTouched ? summaryRules(draft.summary) : null;
  const draftValid = !summaryRules(draft.summary);

  const editSummaryError = editTouched ? summaryRules(editDraft.summary) : null;
  const editValid = !summaryRules(editDraft.summary);

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setDraftTouched(true);
    if (!draftValid) {
      toast.err('입력값을 확인해 주세요');
      return;
    }
    createMut.mutate({
      logDate: draft.logDate,
      summary: draft.summary.trim(),
      details: draft.details || undefined,
      tags: draft.tags || undefined,
    });
  }

  function startEdit(r: WorkLogRow) {
    setEditingId(r.id);
    setEditTouched(false);
    setEditDraft({
      summary: r.summary,
      details: r.details ?? '',
      tags: r.tags ?? '',
    });
  }

  function saveEdit() {
    if (editingId == null) return;
    setEditTouched(true);
    if (!editValid) {
      toast.err('입력값을 확인해 주세요');
      return;
    }
    updateMut.mutate({
      id: editingId,
      summary: editDraft.summary.trim(),
      details: editDraft.details,
      tags: editDraft.tags,
    });
  }

  async function onDelete(r: WorkLogRow) {
    const ok = await confirm({
      title: '업무 일지를 삭제할까요?',
      description: (
        <>
          <div className="mb-1 font-medium text-fg">{r.summary}</div>
          <div className="text-xs text-fg-subtle">
            {fmtDate(r.log_date)} · 삭제하면 되돌릴 수 없습니다.
          </div>
        </>
      ),
      tone: 'danger',
      confirmLabel: '삭제',
    });
    if (ok) deleteMut.mutate(r.id);
  }

  if (!live) {
    return (
      <div className="card">
        <h1 className="text-lg font-semibold text-fg">업무 일지</h1>
        <p className="mt-2 text-sm text-fg-muted">
          로그인 후에 업무 일지를 작성하고 확인할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">업무 일지</h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            하루 일과를 간단히 기록하고, 주간/월간 단위로 돌아봅니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => qc.invalidateQueries({ queryKey: ['workLogs.list'] })}
          className="btn-ghost text-xs"
          disabled={listQuery.isFetching}
        >
          <RefreshCw size={12} className={cn(listQuery.isFetching && 'animate-spin')} /> 새로고침
        </button>
      </div>

      {/* Composer */}
      <section className="card">
        <form onSubmit={onCreate} noValidate className="grid gap-3 md:grid-cols-12">
          <FormField label="날짜" required className="md:col-span-3">
            {(slot) => (
              <TextInput
                type="date"
                value={draft.logDate}
                max={today}
                onChange={(e) => setDraft((d) => ({ ...d, logDate: e.target.value }))}
                required
                {...slot}
              />
            )}
          </FormField>
          <FormField
            label="요약"
            required
            error={draftSummaryError}
            hint="한 줄로 간결하게 (예: A과목 안내문 파싱 5건 완료)"
            count={draft.summary.length}
            max={200}
            className="md:col-span-9"
          >
            {(slot) => (
              <TextInput
                type="text"
                placeholder="오늘 무엇을 했나요? (한 줄)"
                value={draft.summary}
                maxLength={200}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, summary: e.target.value }));
                  if (!draftTouched) setDraftTouched(true);
                }}
                onBlur={() => setDraftTouched(true)}
                {...slot}
              />
            )}
          </FormField>
          <FormField
            label="상세 (선택)"
            hint="상세 내용, 이슈, 내일 할 일 등"
            className="md:col-span-9"
          >
            {(slot) => (
              <Textarea
                placeholder="상세 내용, 이슈, 내일 할 일 등"
                value={draft.details}
                onChange={(e) => setDraft((d) => ({ ...d, details: e.target.value }))}
                {...slot}
              />
            )}
          </FormField>
          <div className="md:col-span-3 flex flex-col">
            <FormField label="태그 (쉼표)" hint="예: QA, 파싱, 회의">
              {(slot) => (
                <TextInput
                  type="text"
                  placeholder="예: QA, 파싱, 회의"
                  value={draft.tags}
                  onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                  {...slot}
                />
              )}
            </FormField>
            <button
              type="submit"
              disabled={createMut.isPending}
              aria-disabled={!draftValid || createMut.isPending}
              className="btn-primary mt-auto"
            >
              {createMut.isPending ? <Spinner size={14} /> : <Plus size={14} />}
              {createMut.isPending ? '저장 중…' : '저장'}
            </button>
          </div>
        </form>
      </section>

      {/* Range filter */}
      <section className="card">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-fg-muted text-xs">기간</span>
          <input
            type="date"
            className="input py-1.5 w-auto text-xs"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="시작일"
          />
          <span className="text-fg-subtle">~</span>
          <input
            type="date"
            className="input py-1.5 w-auto text-xs"
            value={to}
            min={from}
            max={today}
            onChange={(e) => setTo(e.target.value)}
            aria-label="종료일"
          />
          <div className="ml-auto text-xs text-fg-subtle">
            총 {rows.length}건
          </div>
        </div>
      </section>

      {/* List */}
      {listQuery.isLoading ? (
        <div className="card">
          <LoadingPanel label="업무 일지를 불러오는 중…" />
        </div>
      ) : listQuery.isError ? (
        <EmptyState
          icon={NotebookPen}
          tone="error"
          title="목록을 불러오지 못했습니다"
          hint="네트워크 상태를 확인하고 새로고침해 주세요."
          action={
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => listQuery.refetch()}
            >
              <RefreshCw size={12} /> 다시 시도
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="이 기간에 작성된 업무 일지가 없습니다"
          hint="위 입력창에 한 줄만 적어도 저장됩니다."
        />
      ) : (
        <div className="space-y-4">
          {byDate.map(([date, items]) => (
            <section key={date} className="card">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-fg">{fmtDate(date)}</h3>
                <span className="text-[11px] text-fg-subtle">{items.length}건</span>
              </div>
              <ul className="divide-y divide-border">
                {items.map((r) => (
                  <li key={r.id} className="py-3">
                    {editingId === r.id ? (
                      <div className="space-y-2">
                        <FormField
                          label="요약"
                          required
                          error={editSummaryError}
                          count={editDraft.summary.length}
                          max={200}
                        >
                          {(slot) => (
                            <TextInput
                              className="py-1.5"
                              value={editDraft.summary}
                              maxLength={200}
                              onChange={(e) => {
                                setEditDraft((d) => ({ ...d, summary: e.target.value }));
                                if (!editTouched) setEditTouched(true);
                              }}
                              onBlur={() => setEditTouched(true)}
                              {...slot}
                            />
                          )}
                        </FormField>
                        <FormField label="상세 (선택)">
                          {(slot) => (
                            <Textarea
                              className="py-1.5 min-h-[60px]"
                              value={editDraft.details}
                              onChange={(e) => setEditDraft((d) => ({ ...d, details: e.target.value }))}
                              {...slot}
                            />
                          )}
                        </FormField>
                        <FormField label="태그 (쉼표)">
                          {(slot) => (
                            <TextInput
                              className="py-1.5"
                              placeholder="태그 (쉼표)"
                              value={editDraft.tags}
                              onChange={(e) => setEditDraft((d) => ({ ...d, tags: e.target.value }))}
                              {...slot}
                            />
                          )}
                        </FormField>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={saveEdit}
                            disabled={updateMut.isPending}
                            className="btn-primary text-xs"
                          >
                            {updateMut.isPending ? <Spinner size={12} /> : <Check size={12} />}
                            {updateMut.isPending ? '저장 중…' : '저장'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(null);
                              setEditTouched(false);
                            }}
                            disabled={updateMut.isPending}
                            className="btn-ghost text-xs"
                          >
                            <X size={12} /> 취소
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-fg">{r.summary}</div>
                          {r.details && (
                            <div className="mt-1 whitespace-pre-wrap text-xs text-fg-muted">
                              {r.details}
                            </div>
                          )}
                          {r.tags && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {r.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
                                <span key={t} className="chip bg-accent-soft text-accent-strong">
                                  #{t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-start gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(r)}
                            className="rounded p-1 text-fg-subtle hover:bg-bg-soft hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            title="수정"
                            aria-label={`${r.summary} 수정`}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(r)}
                            disabled={deleteMut.isPending}
                            className="rounded p-1 text-fg-subtle hover:bg-danger/10 hover:text-danger disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                            title="삭제"
                            aria-label={`${r.summary} 삭제`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

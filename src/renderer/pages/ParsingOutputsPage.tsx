import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Inbox,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Trash2,
  RotateCcw,
  Archive,
  Hourglass,
  User as UserIcon,
  RefreshCw,
  FileSpreadsheet,
  NotebookPen,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { relative } from '@/lib/date';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useToast } from '@/stores/toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

type UploadRow = Awaited<ReturnType<NonNullable<Window['api']>['parsing']['listUploads']>>[number];

type Tab = 'pending' | 'consumed' | 'archived' | 'all';

const TAB_DEFS: Array<{ id: Tab; label: string; icon: typeof Inbox }> = [
  { id: 'pending',  label: '작업 대기',   icon: Hourglass },
  { id: 'consumed', label: '소비 완료',   icon: CheckCircle2 },
  { id: 'archived', label: '보관',        icon: Archive },
  { id: 'all',      label: '전체',        icon: Inbox },
];

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ParsingOutputsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const toast = useToast();
  const confirm = useConfirm();

  const isLeadership = !!user?.perms.isLeadership;
  const canConsume   = !!user?.perms.canReviewParsedExcel;
  const isTA         = !!user?.perms.isParsingAssistantOnly;

  const [tab, setTab] = useState<Tab>('pending');
  /** TA 는 자신이 올린 파일만 볼 수 있도록 서버에서 강제되지만,
   *  정규직이 본인이 최근에 올린 것만 보고 싶을 때 켤 수 있게 토글 제공. */
  const [mineOnly, setMineOnly] = useState<boolean>(isTA);
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({});

  const listQuery = useQuery({
    queryKey: ['parsing.uploads.list', tab, mineOnly],
    queryFn: () => api!.parsing.listUploads({
      status: tab,
      mineOnly: mineOnly || isTA || undefined,
    }),
    enabled: live,
    refetchInterval: 30_000,
  });

  const statsQuery = useQuery({
    queryKey: ['parsing.uploads.stats'],
    queryFn: () => api!.parsing.uploadsStats(),
    enabled: live,
    refetchInterval: 30_000,
  });

  const rows: UploadRow[] = listQuery.data ?? [];
  const stats = statsQuery.data ?? { pending: 0, consumed: 0, archived: 0, total: 0 };

  const markConsumed = useMutationWithToast({
    mutationFn: (payload: { id: number; note?: string | null }) =>
      api!.parsing.markConsumed(payload),
    successMessage: '소비 완료 처리되었습니다',
    errorMessage:   '소비 완료 처리에 실패했습니다',
    invalidates: [
      ['parsing.uploads.list'],
      ['parsing.uploads.stats'],
    ],
    onSuccess: (_res, vars) => {
      setNoteDraft((m) => {
        const next = { ...m };
        delete next[vars.id];
        return next;
      });
    },
  });

  const reopen = useMutationWithToast({
    mutationFn: (payload: { id: number }) => api!.parsing.reopenUpload(payload),
    successMessage: '대기 상태로 되돌렸습니다',
    errorMessage:   '상태 복원에 실패했습니다',
    invalidates: [
      ['parsing.uploads.list'],
      ['parsing.uploads.stats'],
    ],
  });

  const removeMut = useMutationWithToast({
    mutationFn: (payload: { id: number }) => api!.parsing.deleteUpload(payload),
    successMessage: '업로드를 삭제했습니다',
    errorMessage:   '삭제에 실패했습니다',
    invalidates: [
      ['parsing.uploads.list'],
      ['parsing.uploads.stats'],
    ],
  });

  /** Open in OS-default spreadsheet app (Excel 등). Only full-timers see this action. */
  async function handleOpen(row: UploadRow) {
    if (!api) return;
    const res = await api.parsing.openUpload({ id: row.id });
    if (!res.ok) {
      toast.err(res.error ?? '파일 열기에 실패했습니다');
    }
  }

  /** Download via buffer → blob URL. Works for everyone who can see the row. */
  async function handleDownload(row: UploadRow) {
    if (!api) return;
    const res = await api.parsing.downloadUpload({ id: row.id });
    if (!res.ok || !res.buffer) {
      toast.err(res.error ?? '다운로드에 실패했습니다');
      return;
    }
    const blob = new Blob([res.buffer], {
      type: res.mimeType ||
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename || row.original_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleMarkConsumed(row: UploadRow) {
    const note = (noteDraft[row.id] ?? '').trim() || null;
    const ok = await confirm({
      title: `${row.original_name} — 소비 완료 처리할까요?`,
      description: '과제를 전용 프로그램에 생성한 뒤 완료 처리하세요. 완료 후에도 기록은 남습니다.',
      confirmLabel: '소비 완료',
      tone: 'default',
    });
    if (!ok) return;
    markConsumed.mutate({ id: row.id, note });
  }

  async function handleReopen(row: UploadRow) {
    const ok = await confirm({
      title: '대기 상태로 되돌릴까요?',
      description: `"${row.original_name}" 업로드를 '작업 대기'로 되돌립니다. 실수로 완료 처리한 경우 사용하세요.`,
      confirmLabel: '되돌리기',
      tone: 'warn',
    });
    if (!ok) return;
    reopen.mutate({ id: row.id });
  }

  async function handleDelete(row: UploadRow) {
    const ok = await confirm({
      title: `${row.original_name} 삭제?`,
      description:
        row.status === 'consumed'
          ? '이미 소비 완료된 업로드입니다. 리더십만 삭제할 수 있습니다. 삭제하면 원본 파일도 사라집니다.'
          : '업로드와 원본 파일이 완전히 삭제됩니다. 복구할 수 없습니다.',
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!ok) return;
    removeMut.mutate({ id: row.id });
  }

  const filteredEmpty = !listQuery.isLoading && rows.length === 0;

  const tabBadge = useMemo(() => ({
    pending:  stats.pending,
    consumed: stats.consumed,
    archived: stats.archived,
    all:      stats.total,
  } satisfies Record<Tab, number>), [stats]);

  if (!canConsume && !isTA) {
    // TA, 정규직 파서, 리더십 외 역할은 접근 불가.
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertTriangle}
          tone="error"
          title="권한이 없습니다"
          hint="이 화면은 조교가 올린 파싱 엑셀을 소비하는 정규직/리더십 전용입니다."
        />
      </div>
    );
  }

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 파싱 결과함을 확인할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <Inbox size={20} /> 파싱 결과함
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            조교(TA)가 업로드한 파싱 엑셀을 확인하고, 전용 프로그램으로 수행평가를 생성한 후
            "소비 완료" 로 표시하세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              listQuery.refetch();
              statsQuery.refetch();
            }}
            className="btn-ghost text-xs flex items-center gap-1"
            disabled={listQuery.isFetching || statsQuery.isFetching}
            aria-label="목록 새로고침"
          >
            <RefreshCw
              size={12}
              className={cn(listQuery.isFetching && 'animate-spin')}
              aria-hidden="true"
            />
            새로고침
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="작업 대기"  value={stats.pending}  tone="amber"   icon={Hourglass} />
        <StatCard label="소비 완료"  value={stats.consumed} tone="emerald" icon={CheckCircle2} />
        <StatCard label="보관"       value={stats.archived} tone="slate"   icon={Archive} />
        <StatCard label="전체"       value={stats.total}    tone="accent"  icon={Inbox} />
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-soft/40 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="상태 탭">
            {TAB_DEFS.map((t) => {
              const active = tab === t.id;
              const Icon = t.icon;
              const n = tabBadge[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    active
                      ? 'bg-accent text-white'
                      : 'bg-bg-soft text-fg-muted hover:bg-bg-card hover:text-fg',
                  )}
                >
                  <Icon size={12} aria-hidden="true" />
                  {t.label}
                  <span
                    className={cn(
                      'ml-0.5 rounded-full px-1.5 py-0 text-[10px] leading-4',
                      active ? 'bg-white/20 text-white' : 'bg-bg-card text-fg-subtle',
                    )}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs">
            {!isTA && (
              <label className="inline-flex items-center gap-1 text-fg-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-accent"
                  checked={mineOnly}
                  onChange={(e) => setMineOnly(e.target.checked)}
                />
                내 업로드만
              </label>
            )}
            <span className="text-fg-subtle" aria-live="polite">
              {rows.length}건
            </span>
          </div>
        </div>

        {listQuery.isLoading ? (
          <LoadingPanel label="업로드 목록을 불러오는 중…" className="py-10" />
        ) : listQuery.isError ? (
          <EmptyState
            tone="error"
            icon={AlertTriangle}
            title="업로드 목록을 불러오지 못했습니다"
            hint="네트워크 상태를 확인하거나 잠시 후 다시 시도해 주세요."
            action={
              <button className="btn-outline" onClick={() => listQuery.refetch()}>
                다시 시도
              </button>
            }
            className="border-0"
          />
        ) : filteredEmpty ? (
          <EmptyState
            icon={tab === 'pending' ? Hourglass : Inbox}
            title={
              tab === 'pending'
                ? '작업 대기 중인 파일이 없습니다'
                : tab === 'consumed'
                  ? '소비 완료된 파일이 없습니다'
                  : tab === 'archived'
                    ? '보관된 파일이 없습니다'
                    : '업로드된 파일이 없습니다'
            }
            hint={
              tab === 'pending'
                ? '조교가 엑셀을 업로드하면 이 곳에 표시됩니다.'
                : '탭을 바꾸거나 필터를 해제해 보세요.'
            }
            className="border-0"
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="px-3 py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-md bg-emerald-500/10 text-emerald-300 shrink-0">
                    <FileSpreadsheet size={16} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-fg truncate">{row.original_name}</span>
                      <StatusBadge status={row.status} />
                      <span className="text-[11px] text-fg-subtle">
                        {formatBytes(row.size_bytes)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-fg-subtle">
                      <span className="inline-flex items-center gap-1">
                        <UserIcon size={10} aria-hidden="true" />
                        {row.uploader_name ?? '알 수 없음'}
                      </span>
                      <span>{relative(row.uploaded_at)}</span>
                      {row.student_code && (
                        <span className="font-mono">학생 {row.student_code}</span>
                      )}
                      {row.subject && <span>과목 {row.subject}</span>}
                      {row.title && (
                        <span className="line-clamp-1 max-w-xs">평가명: {row.title}</span>
                      )}
                    </div>
                    {row.note && (
                      <div className="mt-1 rounded border border-border bg-bg-soft/50 px-2 py-1 text-[11px] text-fg-muted">
                        <span className="mr-1 font-medium text-fg-subtle">메모:</span>
                        {row.note}
                      </div>
                    )}
                    {row.status === 'consumed' && (
                      <div className="mt-1 rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-[11px] text-emerald-300/90">
                        <span className="font-medium">소비 완료</span>
                        {row.consumer_name ? ` · ${row.consumer_name}` : ''}
                        {row.consumed_at ? ` · ${relative(row.consumed_at)}` : ''}
                        {row.consumed_note ? ` — ${row.consumed_note}` : ''}
                      </div>
                    )}

                    {/* Consumption note input (pending only + canConsume) */}
                    {row.status === 'pending' && canConsume && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <NotebookPen size={11} className="text-fg-subtle" aria-hidden="true" />
                        <input
                          type="text"
                          placeholder="메모(선택) — 무엇을 어떻게 생성했는지"
                          value={noteDraft[row.id] ?? ''}
                          onChange={(e) =>
                            setNoteDraft((m) => ({ ...m, [row.id]: e.target.value }))
                          }
                          className="input text-xs py-1 w-72 max-w-full"
                          aria-label="소비 완료 메모"
                          maxLength={300}
                        />
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-1 shrink-0">
                    {canConsume && (
                      <button
                        type="button"
                        onClick={() => handleOpen(row)}
                        title="기본 프로그램(엑셀)에서 열기"
                        className="btn-ghost text-[11px] h-7 flex items-center gap-1"
                      >
                        <ExternalLink size={11} /> 열기
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDownload(row)}
                      title="다운로드"
                      className="btn-ghost text-[11px] h-7 flex items-center gap-1"
                    >
                      <Download size={11} /> 다운로드
                    </button>

                    {row.status === 'pending' && canConsume && (
                      <button
                        type="button"
                        onClick={() => handleMarkConsumed(row)}
                        disabled={markConsumed.isPending}
                        title="전용 프로그램으로 수행평가를 생성한 뒤 완료 처리"
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium',
                          'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
                          'disabled:opacity-50',
                        )}
                      >
                        {markConsumed.isPending && markConsumed.variables?.id === row.id ? (
                          <Spinner size={11} />
                        ) : (
                          <CheckCircle2 size={11} />
                        )}
                        소비 완료
                      </button>
                    )}

                    {row.status !== 'pending' && canConsume && (
                      <button
                        type="button"
                        onClick={() => handleReopen(row)}
                        disabled={reopen.isPending}
                        title="대기 상태로 되돌리기"
                        className="btn-ghost text-[11px] h-7 flex items-center gap-1 text-amber-300 hover:bg-amber-500/10"
                      >
                        <RotateCcw size={11} /> 되돌리기
                      </button>
                    )}

                    {(
                      row.uploader_user_id === user?.id ||
                      isLeadership ||
                      (row.status !== 'consumed' && canConsume)
                    ) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(row)}
                        disabled={removeMut.isPending}
                        title="삭제"
                        className="btn-ghost text-[11px] h-7 flex items-center gap-1 text-rose-300 hover:bg-rose-500/10"
                      >
                        <Trash2 size={11} /> 삭제
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- */
/*  small visual helpers                                                  */
/* --------------------------------------------------------------------- */

function StatusBadge({ status }: { status: UploadRow['status'] }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
        <Hourglass size={10} aria-hidden="true" /> 대기
      </span>
    );
  }
  if (status === 'consumed') {
    return (
      <span className="inline-flex items-center gap-0.5 rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
        <CheckCircle2 size={10} aria-hidden="true" /> 소비 완료
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 rounded border border-slate-500/30 bg-slate-500/15 px-1.5 py-0.5 text-[10px] text-slate-300">
      <Archive size={10} aria-hidden="true" /> 보관
    </span>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  tone: 'amber' | 'emerald' | 'slate' | 'accent';
  icon: typeof Inbox;
}) {
  const toneCls =
    tone === 'amber'
      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
      : tone === 'emerald'
        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        : tone === 'slate'
          ? 'bg-slate-500/10 border-slate-500/30 text-slate-300'
          : 'bg-accent/10 border-accent/30 text-accent';
  return (
    <div className={cn('rounded-lg border px-3 py-2 flex items-center gap-3', toneCls)}>
      <div className="grid h-8 w-8 place-items-center rounded-full bg-bg-soft/60">
        <Icon size={14} aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
        <div className="text-xl font-semibold text-fg leading-tight">{value}</div>
      </div>
    </div>
  );
}

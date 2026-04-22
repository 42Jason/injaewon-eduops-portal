import { useMemo, useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckSquare, Square, Check, X, RotateCcw, User as UserIcon, Clock,
  ShieldCheck, AlertTriangle, MessageSquare, ClipboardCheck, Inbox,
  FileDown,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import type { AssignmentState, Risk } from '@shared/types/assignment';
import { riskChipClass, riskLabel, formatDueLabel, stateChipClass } from '@/lib/assignment';
import { fmtDateTime, relative } from '@/lib/date';
import { cn } from '@/lib/cn';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useToast } from '@/stores/toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField, Textarea } from '@/components/ui/FormField';
import { firstError, maxLength } from '@/lib/validators';

interface QAAssignmentRow {
  id: number;
  code: string;
  subject: string;
  publisher?: string | null;
  student_code?: string;
  assignment_title?: string;
  title?: string;
  state: AssignmentState;
  risk: Risk;
  qa1_id?: number | null;
  qa_final_id?: number | null;
  parser_name?: string | null;
  qa1_name?: string | null;
  qa_final_name?: string | null;
  due_at?: string | null;
  received_at?: string;
  outline?: string | null;
  rubric?: string | null;
  teacher_requirements?: string | null;
  student_requests?: string | null;
}

interface QAReviewRow {
  id: number;
  stage: 'QA1' | 'QA_FINAL';
  result: 'approved' | 'rejected' | 'revision_requested';
  comment?: string | null;
  reviewed_at: string;
  reviewer_name?: string | null;
  reviewer_role?: string | null;
  checklist_json?: string | null;
}

interface ChecklistTemplate {
  id: number;
  stage: 'QA1' | 'QA_FINAL';
  version: string;
  items_json: string;
  is_active: number;
}

interface ChecklistItem {
  id?: string;
  key: string;
  label: string;
  required?: boolean;
}

interface ReviewFileRow {
  id: string;
  name: string;
  url?: string | null;
  jsonContent?: string | null;
  kind?: string | null;
  source?: string | null;
  description?: string | null;
}

const INBOX_STATES_QA1: AssignmentState[] = ['1차QA대기', '1차QA진행중', '1차QA반려'];
const INBOX_STATES_QAFINAL: AssignmentState[] = ['최종QA대기', '최종QA진행중', '최종QA반려'];
const EDITABLE_STATES_QA1: AssignmentState[] = ['1차QA대기', '1차QA진행중'];
const EDITABLE_STATES_QAFINAL: AssignmentState[] = ['최종QA대기', '최종QA진행중'];

const commentRules = firstError<string>([maxLength(1000)]);
const noteRules = firstError<string>([maxLength(200)]);

function safeDownloadName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '_') || 'download.json';
}

function downloadTextFile(name: string, content: string, mimeType = 'application/json') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeDownloadName(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const RESULT_LABEL: Record<'approved' | 'rejected' | 'revision_requested', string> = {
  approved: '승인',
  rejected: '반려',
  revision_requested: '수정 요청',
};

interface Props {
  stage: 'QA1' | 'QA_FINAL';
}

export function QAChecklistPage({ stage }: Props) {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const toast = useToast();
  const confirm = useConfirm();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checks, setChecks] = useState<Record<string, { checked: boolean; note?: string }>>({});
  const [comment, setComment] = useState('');
  const [commentTouched, setCommentTouched] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string | null>(null);
  const lastSavedDraftRef = useRef<string>('');

  const stageLabel = stage === 'QA1' ? '1차 QA' : '최종 QA';
  const inboxStates = stage === 'QA1' ? INBOX_STATES_QA1 : INBOX_STATES_QAFINAL;
  const editableStates = stage === 'QA1' ? EDITABLE_STATES_QA1 : EDITABLE_STATES_QAFINAL;
  const canUseThisStage = stage === 'QA1'
    ? !!user?.perms.canReviewQA1
    : !!user?.perms.canReviewQAFinal;

  // Fetch the ENTIRE list then filter to inbox states client-side.
  const listQuery = useQuery({
    queryKey: ['qa.inbox', stage],
    queryFn: async () => {
      const rows = (await api!.assignments.list()) as unknown as QAAssignmentRow[];
      return rows.filter((r) => inboxStates.includes(r.state));
    },
    enabled: live && canUseThisStage,
  });

  const rows = listQuery.data ?? [];

  const templateQuery = useQuery({
    queryKey: ['qa.template', stage],
    queryFn: async () => {
      const list = (await api!.qa.templates(stage)) as unknown as ChecklistTemplate[];
      return list[0] ?? null;
    },
    enabled: live && canUseThisStage,
  });

  const items: ChecklistItem[] = useMemo(() => {
    const tpl = templateQuery.data;
    if (!tpl) return [];
    try {
      const parsed = JSON.parse(tpl.items_json) as Array<Partial<ChecklistItem>>;
      if (!Array.isArray(parsed)) return [];
      const usedKeys = new Set<string>();
      return parsed.map((item, index) => {
        const baseKey = String(item.key || item.id || `item-${index + 1}`).trim();
        let key = baseKey || `item-${index + 1}`;
        let duplicateIndex = 2;
        while (usedKeys.has(key)) {
          key = `${baseKey || `item-${index + 1}`}-${duplicateIndex}`;
          duplicateIndex += 1;
        }
        usedKeys.add(key);
        return {
          ...item,
          key,
          label: item.label || `체크 항목 ${index + 1}`,
        };
      });
    } catch {
      return [];
    }
  }, [templateQuery.data]);

  const selected = useMemo(() => {
    if (!rows.length) return null;
    const found = rows.find((r) => r.id === selectedId);
    return found ?? rows[0];
  }, [rows, selectedId]);

  const draftKey = selected ? `eduops.qaDraft.${stage}.${selected.id}` : null;

  const reviewsQuery = useQuery({
    queryKey: ['qa.reviews', selected?.id],
    queryFn: () =>
      api!.assignments.qaReviews(selected!.id) as unknown as Promise<QAReviewRow[]>,
    enabled: live && canUseThisStage && !!selected,
  });

  const filesQuery = useQuery({
    queryKey: ['qa.reviewFiles', selected?.id],
    queryFn: () =>
      api!.assignments.reviewFiles(selected!.id) as unknown as Promise<ReviewFileRow[]>,
    enabled: live && canUseThisStage && !!selected,
  });

  const selectedReviewerId = selected
    ? (stage === 'QA1' ? selected.qa1_id : selected.qa_final_id)
    : null;
  const canEditSelected = Boolean(
    canUseThisStage &&
    selected &&
    editableStates.includes(selected.state) &&
    (selectedReviewerId == null ||
      selectedReviewerId === user?.id ||
      user?.perms.isLeadership),
  );

  const editBlockedReason = !canUseThisStage
    ? `${stageLabel} 권한이 없습니다.`
    : selected && !editableStates.includes(selected.state)
      ? '현재 상태에서는 QA 제출을 할 수 없습니다.'
      : selectedReviewerId != null && selectedReviewerId !== user?.id && !user?.perms.isLeadership
        ? '이 과제의 담당 QA만 체크리스트를 제출할 수 있습니다.'
        : null;

  // Reset checklist state when selection changes.
  useEffect(() => {
    if (!items.length || !selected || !draftKey) {
      setLoadedDraftKey(null);
      return;
    }
    const init: Record<string, { checked: boolean; note?: string }> = {};
    for (const it of items) init[it.key] = { checked: false };
    let nextChecks = init;
    let nextComment = '';
    let nextShowReview = false;
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          checks?: Record<string, { checked?: boolean; note?: string }>;
          comment?: string;
          showReview?: boolean;
        };
        nextChecks = { ...init };
        for (const it of items) {
          const savedItem = parsed.checks?.[it.key];
          if (!savedItem) continue;
          nextChecks[it.key] = {
            checked: !!savedItem.checked,
            note: savedItem.note ?? '',
          };
        }
        nextComment = parsed.comment ?? '';
        nextShowReview = !!parsed.showReview;
      }
    } catch {
      window.localStorage.removeItem(draftKey);
    }
    setChecks(nextChecks);
    setComment(nextComment);
    setCommentTouched(false);
    setShowReview(nextShowReview);
    setLoadedDraftKey(draftKey);
    lastSavedDraftRef.current = '';
  }, [selected, draftKey, items]);

  useEffect(() => {
    if (!draftKey || loadedDraftKey !== draftKey || !items.length || !canEditSelected) return;
    const payload = JSON.stringify({
      checks,
      comment,
      showReview,
      savedAt: new Date().toISOString(),
    });
    if (lastSavedDraftRef.current === payload) return;
    window.localStorage.setItem(draftKey, payload);
    lastSavedDraftRef.current = payload;
  }, [canEditSelected, checks, comment, draftKey, items.length, loadedDraftKey, showReview]);

  const submitMut = useMutationWithToast<
    { ok: boolean; error?: string; nextState?: string },
    Error,
    { result: 'approved' | 'rejected' | 'revision_requested' }
  >({
    mutationFn: (payload) => {
      if (!live || !selected || !user || !canEditSelected) {
        return Promise.resolve({ ok: false, error: 'forbidden' });
      }
      return api!.qa.submit({
        assignmentId: selected.id,
        stage,
        result: payload.result,
        checklist: checks,
        comment: comment || undefined,
      });
    },
    successMessage: false,
    errorMessage: 'QA 제출에 실패했습니다',
    invalidates: [
      ['qa.inbox'],
      ['qa.reviews'],
      ['assignments.list'],
      ['home.stats'],
    ],
    onSuccess: (res, vars) => {
      if (res.ok) {
        toast.ok(`${stageLabel} ${RESULT_LABEL[vars.result]} 처리되었습니다`);
        if (draftKey) window.localStorage.removeItem(draftKey);
        setLoadedDraftKey(null);
        lastSavedDraftRef.current = '';
        setShowReview(false);
        setComment('');
        setCommentTouched(false);
      }
    },
  });

  const requiredUnchecked = useMemo(() => {
    return items.filter((it) => it.required && !checks[it.key]?.checked);
  }, [items, checks]);
  const allRequiredOk = requiredUnchecked.length === 0;
  const hasCheck = Object.values(checks).some((v) => v.checked);

  const commentError = commentTouched ? commentRules(comment) : null;

  async function submitReview(result: 'approved' | 'rejected' | 'revision_requested') {
    if (submitMut.isPending || !canEditSelected) return;
    if (commentRules(comment)) {
      setCommentTouched(true);
      return;
    }
    if (result === 'rejected') {
      const ok = await confirm({
        title: `${stageLabel}를 반려하시겠습니까?`,
        description: '반려 시 파서(또는 1차 QA) 담당자에게 되돌아갑니다. 코멘트를 남긴 뒤 진행해 주세요.',
        confirmLabel: '반려',
        tone: 'danger',
      });
      if (!ok) return;
    }
    submitMut.mutate({ result });
  }

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 {stageLabel} 큐를 확인할 수 있습니다.
        </div>
      </div>
    );
  }

  if (!canUseThisStage) {
    return (
      <div className="p-6">
        <div className="card max-w-xl">
          <EmptyState
            icon={ShieldCheck}
            tone="error"
            title={`${stageLabel} 접근 권한이 없습니다`}
            hint="계정 역할과 담당 단계가 맞는지 직원 관리에서 확인해 주세요."
          />
        </div>
      </div>
    );
  }

  const inboxLoading = listQuery.isLoading;
  const inboxError = listQuery.isError;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <ShieldCheck size={20} aria-hidden="true" /> {stageLabel}
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            {stage === 'QA1'
              ? '파싱 완료된 과제를 1차 검토합니다. 통과 시 최종 QA 단계로 넘어갑니다.'
              : '1차 QA 통과 과제를 최종 검토합니다. 승인 시 과제가 완료 처리됩니다.'}
          </p>
        </div>
        <div className="text-xs text-fg-subtle">
          체크리스트 v{templateQuery.data?.version ?? '-'}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Inbox */}
        <div className="col-span-12 lg:col-span-4 card p-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-bg-soft/40 flex items-center justify-between">
            <span className="text-sm font-medium">검토 대기</span>
            <span className="text-xs text-fg-subtle tabular-nums">{rows.length}건</span>
          </div>
          <div
            className="max-h-[70vh] overflow-y-auto divide-y divide-border"
            role="listbox"
            aria-label={`${stageLabel} 검토 대기 목록`}
          >
            {inboxError ? (
              <div className="p-4">
                <EmptyState
                  icon={AlertTriangle}
                  tone="error"
                  title="목록을 불러오지 못했습니다"
                  action={
                    <button
                      type="button"
                      onClick={() => listQuery.refetch()}
                      className="btn-outline text-xs flex items-center gap-1"
                    >
                      <RotateCcw size={10} /> 다시 시도
                    </button>
                  }
                />
              </div>
            ) : inboxLoading ? (
              <LoadingPanel label="검토 대기 목록을 불러오는 중…" />
            ) : rows.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  icon={Inbox}
                  title="검토 대기 건이 없습니다"
                  hint="신규 과제가 해당 단계에 도달하면 여기에 표시됩니다."
                />
              </div>
            ) : (
              rows.map((r) => {
                const active = selected?.id === r.id;
                const due = formatDueLabel(r.due_at ?? null);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    role="option"
                    aria-selected={active}
                    aria-label={`${r.code} ${r.assignment_title ?? r.title ?? ''}`}
                    className={cn(
                      'w-full text-left px-3 py-2.5 space-y-1 transition',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset',
                      active ? 'bg-accent/10' : 'hover:bg-bg-soft/40',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-fg-subtle">{r.code}</span>
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px]', riskChipClass(r.risk))}>
                        {riskLabel(r.risk)}
                      </span>
                    </div>
                    <div className="text-sm text-fg line-clamp-1">
                      {r.assignment_title ?? r.title ?? '-'}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-fg-subtle">
                      <span className="truncate">
                        {r.subject} · {r.student_code ?? '-'}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 ml-1',
                          due.tone === 'danger' && 'text-rose-300',
                          due.tone === 'warning' && 'text-amber-300',
                        )}
                      >
                        {due.label}
                      </span>
                    </div>
                    <div>
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px]', stateChipClass(r.state))}>
                        {r.state}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Detail + Checklist */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {!selected && !inboxLoading && !inboxError && rows.length > 0 && (
            <div className="card text-sm text-fg-muted">
              좌측에서 검토할 과제를 선택하세요.
            </div>
          )}

          {selected && (
            <>
              {/* Summary card */}
              <div className="card space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-fg-subtle">{selected.code}</span>
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px]', stateChipClass(selected.state))}>
                        {selected.state}
                      </span>
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px]', riskChipClass(selected.risk))}>
                        {riskLabel(selected.risk)}
                      </span>
                    </div>
                    <h2 className="text-lg font-semibold mt-1">
                      {selected.assignment_title ?? selected.title ?? '-'}
                    </h2>
                    <div className="text-xs text-fg-subtle mt-0.5">
                      {selected.subject}
                      {selected.publisher && ` · ${selected.publisher}`}
                      {` · 학생 ${selected.student_code ?? '-'}`}
                    </div>
                  </div>
                  <div className="text-right text-xs text-fg-subtle">
                    {selected.due_at && (
                      <div className="flex items-center gap-1 justify-end">
                        <Clock size={11} aria-hidden="true" /> 마감 {fmtDateTime(selected.due_at)}
                      </div>
                    )}
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <UserIcon size={11} aria-hidden="true" />
                      {stage === 'QA1' ? (selected.parser_name ?? '-') + ' (파서)'
                        : (selected.qa1_name ?? '-') + ' (1차)'}
                    </div>
                  </div>
                </div>

                {(selected.outline || selected.rubric) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    {selected.outline && (
                      <div className="p-2 rounded border border-border bg-bg-soft/40">
                        <div className="text-fg-subtle mb-1">개요</div>
                        <div className="text-fg-muted whitespace-pre-wrap line-clamp-6">{selected.outline}</div>
                      </div>
                    )}
                    {selected.rubric && (
                      <div className="p-2 rounded border border-border bg-bg-soft/40">
                        <div className="text-fg-subtle mb-1">평가 기준</div>
                        <div className="text-fg-muted whitespace-pre-wrap line-clamp-6">{selected.rubric}</div>
                      </div>
                    )}
                  </div>
                )}
                <div className="rounded border border-border bg-bg-soft/40 p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-fg flex items-center gap-1.5">
                      <FileDown size={13} aria-hidden="true" /> 검토 파일
                    </div>
                    <div className="text-[11px] text-fg-subtle">
                      {filesQuery.data?.length ?? 0}개
                    </div>
                  </div>
                  {filesQuery.isLoading ? (
                    <div className="text-[11px] text-fg-subtle">파일 목록을 불러오는 중...</div>
                  ) : !filesQuery.data?.length ? (
                    <div className="text-[11px] text-fg-subtle">
                      연결된 파서 파일 또는 보고서 파일이 없습니다.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {filesQuery.data.map((file) =>
                        file.jsonContent ? (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => downloadTextFile(file.name, file.jsonContent ?? '')}
                            className="btn-outline text-xs inline-flex items-center gap-1"
                            title={file.description ?? undefined}
                          >
                            <FileDown size={12} aria-hidden="true" />
                            {file.name}
                          </button>
                        ) : file.url ? (
                          <a
                            key={file.id}
                            href={file.url}
                            target="_blank"
                            rel="noreferrer"
                            download={file.name}
                            className="btn-outline text-xs inline-flex items-center gap-1"
                            title={file.description ?? undefined}
                          >
                            <FileDown size={12} aria-hidden="true" />
                            {file.name}
                          </a>
                        ) : (
                          <span
                            key={file.id}
                            className="rounded border border-border px-2 py-1 text-xs text-fg-subtle"
                            title={file.description ?? undefined}
                          >
                            {file.name}
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Checklist */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <ClipboardCheck size={15} aria-hidden="true" /> {stageLabel} 체크리스트
                  </h3>
                  {!allRequiredOk && (
                    <span
                      className="text-[11px] text-amber-300 flex items-center gap-1"
                      role="status"
                    >
                      <AlertTriangle size={11} aria-hidden="true" />
                      필수 항목 {requiredUnchecked.length}개 미체크
                    </span>
                  )}
                </div>
                {editBlockedReason && (
                  <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                    {editBlockedReason}
                  </div>
                )}

                {templateQuery.isLoading ? (
                  <LoadingPanel label="체크리스트 템플릿을 불러오는 중…" />
                ) : templateQuery.isError ? (
                  <EmptyState
                    icon={AlertTriangle}
                    tone="error"
                    title="템플릿을 불러오지 못했습니다"
                    action={
                      <button
                        type="button"
                        onClick={() => templateQuery.refetch()}
                        className="btn-outline text-xs flex items-center gap-1"
                      >
                        <RotateCcw size={10} /> 다시 시도
                      </button>
                    }
                  />
                ) : items.length === 0 ? (
                  <EmptyState
                    icon={ClipboardCheck}
                    title="활성화된 체크리스트가 없습니다"
                    hint="자동화 · 설정에서 qa.checklist.* 템플릿을 등록하세요."
                  />
                ) : (
                  <div className="space-y-1.5" role="list">
                    {items.map((it) => {
                      const v = checks[it.key] ?? { checked: false };
                      const noteErr = noteRules(v.note ?? '');
                      return (
                        <div
                          key={it.key}
                          role="listitem"
                          className={cn(
                            'flex items-start gap-2 p-2 rounded border transition',
                            v.checked
                              ? 'border-emerald-500/30 bg-emerald-500/5'
                              : 'border-border hover:border-fg-subtle',
                          )}
                        >
                          <button
                            type="button"
                            disabled={!canEditSelected || submitMut.isPending}
                            onClick={() =>
                              setChecks((p) => ({
                                ...p,
                                [it.key]: { ...p[it.key], checked: !v.checked },
                              }))
                            }
                            aria-pressed={v.checked}
                            aria-label={`${it.label}${it.required ? ' (필수)' : ''} ${v.checked ? '체크 해제' : '체크'}`}
                            className={cn(
                              'pt-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded',
                              (!canEditSelected || submitMut.isPending) && 'cursor-not-allowed opacity-50',
                            )}
                          >
                            {v.checked ? (
                              <CheckSquare size={16} className="text-emerald-300" aria-hidden="true" />
                            ) : (
                              <Square size={16} className="text-fg-subtle" aria-hidden="true" />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm flex items-center gap-1.5">
                              <span className="text-fg">{it.label}</span>
                              {it.required && (
                                <span className="text-[10px] text-rose-300 border border-rose-500/30 px-1 rounded">
                                  필수
                                </span>
                              )}
                            </div>
                            <input
                              type="text"
                              value={v.note ?? ''}
                              placeholder="메모 (선택)"
                              maxLength={200}
                              disabled={!canEditSelected || submitMut.isPending}
                              aria-label={`${it.label} 메모`}
                              aria-invalid={noteErr ? true : undefined}
                              onChange={(e) =>
                                setChecks((p) => ({
                                  ...p,
                                  [it.key]: {
                                    ...(p[it.key] ?? { checked: false }),
                                    note: e.target.value,
                                  },
                                }))
                              }
                              className={cn(
                                'input text-xs py-1 mt-1 w-full',
                                noteErr && 'border-danger focus-visible:ring-danger/40',
                                (!canEditSelected || submitMut.isPending) && 'cursor-not-allowed opacity-60',
                              )}
                            />
                            {noteErr && (
                              <p className="text-[10px] text-danger mt-0.5" role="alert">
                                {noteErr}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Result controls */}
                {!showReview ? (
                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={!canEditSelected || !allRequiredOk || !hasCheck}
                      onClick={() => setShowReview(true)}
                      className="btn-primary text-sm flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-accent/40"
                      aria-label="리뷰 제출 단계로 이동"
                    >
                      <Check size={14} aria-hidden="true" /> 리뷰 제출
                    </button>
                    <span className="text-xs text-fg-subtle">
                      필수 항목을 모두 체크 후 리뷰 유형을 선택합니다.
                    </span>
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    <FormField
                      label={
                        <span className="flex items-center gap-1">
                          <MessageSquare size={12} aria-hidden="true" /> 코멘트
                        </span>
                      }
                      hint="승인/반려/수정 요청 사유를 기록합니다."
                      error={commentError}
                      count={comment.length}
                      max={1000}
                    >
                      {(slot) => (
                        <Textarea
                          {...slot}
                          value={comment}
                          rows={3}
                          maxLength={1000}
                          disabled={!canEditSelected || submitMut.isPending}
                          onChange={(e) => setComment(e.target.value)}
                          onBlur={() => setCommentTouched(true)}
                          placeholder={
                            stage === 'QA1'
                              ? '1차 검토 결과 및 다음 단계에 전달할 메모'
                              : '최종 승인/반려 사유'
                          }
                          className="text-sm"
                        />
                      )}
                    </FormField>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        disabled={!canEditSelected || submitMut.isPending}
                        onClick={() => submitReview('approved')}
                        className="btn-primary text-sm bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                      >
                        {submitMut.isPending ? <Spinner size={13} /> : <Check size={14} aria-hidden="true" />}
                        승인
                      </button>
                      <button
                        type="button"
                        disabled={!canEditSelected || submitMut.isPending}
                        onClick={() => submitReview('revision_requested')}
                        className="btn-outline text-sm flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        {submitMut.isPending ? <Spinner size={13} /> : <RotateCcw size={14} aria-hidden="true" />}
                        수정 요청
                      </button>
                      <button
                        type="button"
                        disabled={!canEditSelected || submitMut.isPending}
                        onClick={() => submitReview('rejected')}
                        className="btn-outline text-sm border-rose-500/40 text-rose-300 flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-rose-500/40"
                      >
                        {submitMut.isPending ? <Spinner size={13} /> : <X size={14} aria-hidden="true" />}
                        반려
                      </button>
                      <button
                        type="button"
                        disabled={submitMut.isPending}
                        onClick={() => {
                          setShowReview(false);
                          setCommentTouched(false);
                        }}
                        className="btn-ghost text-sm ml-auto"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Previous reviews */}
              <div className="card">
                <h3 className="text-sm font-semibold mb-2">이력</h3>
                {reviewsQuery.isLoading ? (
                  <LoadingPanel label="리뷰 이력을 불러오는 중…" />
                ) : reviewsQuery.isError ? (
                  <EmptyState
                    icon={AlertTriangle}
                    tone="error"
                    title="이력을 불러오지 못했습니다"
                    action={
                      <button
                        type="button"
                        onClick={() => reviewsQuery.refetch()}
                        className="btn-outline text-xs flex items-center gap-1"
                      >
                        <RotateCcw size={10} /> 다시 시도
                      </button>
                    }
                  />
                ) : !reviewsQuery.data || reviewsQuery.data.length === 0 ? (
                  <div className="text-sm text-fg-subtle py-2">아직 리뷰 기록이 없습니다.</div>
                ) : (
                  <div className="space-y-2">
                    {reviewsQuery.data.map((rv) => {
                      const tone =
                        rv.result === 'approved'
                          ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5'
                          : rv.result === 'rejected'
                            ? 'text-rose-300 border-rose-500/30 bg-rose-500/5'
                            : 'text-amber-300 border-amber-500/30 bg-amber-500/5';
                      const label = RESULT_LABEL[rv.result];
                      return (
                        <div
                          key={rv.id}
                          className={cn('p-2 rounded border text-xs space-y-1', tone)}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              {rv.stage === 'QA1' ? '1차 QA' : '최종 QA'} — {label}
                            </span>
                            <span className="text-fg-subtle">
                              {relative(rv.reviewed_at)}
                            </span>
                          </div>
                          <div className="text-fg-muted">
                            {rv.reviewer_name ?? '-'} · {fmtDateTime(rv.reviewed_at)}
                          </div>
                          {rv.comment && (
                            <div className="text-fg whitespace-pre-wrap">{rv.comment}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function QAFirstPage() {
  return <QAChecklistPage stage="QA1" />;
}

export function QAFinalPage() {
  return <QAChecklistPage stage="QA_FINAL" />;
}

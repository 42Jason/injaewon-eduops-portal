import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare, Square, Check, X, RotateCcw, User as UserIcon, Clock,
  ShieldCheck, AlertTriangle, MessageSquare, ClipboardCheck,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import type { AssignmentState, Risk } from '@shared/types/assignment';
import { riskChipClass, riskLabel, formatDueLabel, stateChipClass } from '@/lib/assignment';
import { fmtDateTime, relative } from '@/lib/date';
import { cn } from '@/lib/cn';

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
  key: string;
  label: string;
  required?: boolean;
}

const INBOX_STATES_QA1: AssignmentState[] = ['1차QA대기', '1차QA진행중', '1차QA반려'];
const INBOX_STATES_QAFINAL: AssignmentState[] = ['최종QA대기', '최종QA진행중', '최종QA반려'];

interface Props {
  stage: 'QA1' | 'QA_FINAL';
}

export function QAChecklistPage({ stage }: Props) {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [checks, setChecks] = useState<Record<string, { checked: boolean; note?: string }>>({});
  const [comment, setComment] = useState('');
  const [showReview, setShowReview] = useState(false);

  const stageLabel = stage === 'QA1' ? '1차 QA' : '최종 QA';
  const inboxStates = stage === 'QA1' ? INBOX_STATES_QA1 : INBOX_STATES_QAFINAL;

  // Fetch the ENTIRE list then filter to inbox states client-side.
  const listQuery = useQuery({
    queryKey: ['qa.inbox', stage],
    queryFn: async () => {
      const rows = (await api!.assignments.list()) as unknown as QAAssignmentRow[];
      return rows.filter((r) => inboxStates.includes(r.state));
    },
    enabled: live,
  });

  const rows = listQuery.data ?? [];

  const templateQuery = useQuery({
    queryKey: ['qa.template', stage],
    queryFn: async () => {
      const list = (await api!.qa.templates(stage)) as unknown as ChecklistTemplate[];
      return list[0] ?? null;
    },
    enabled: live,
  });

  const items: ChecklistItem[] = useMemo(() => {
    const tpl = templateQuery.data;
    if (!tpl) return [];
    try {
      return JSON.parse(tpl.items_json);
    } catch {
      return [];
    }
  }, [templateQuery.data]);

  const selected = useMemo(() => {
    if (!rows.length) return null;
    const found = rows.find((r) => r.id === selectedId);
    return found ?? rows[0];
  }, [rows, selectedId]);

  const reviewsQuery = useQuery({
    queryKey: ['qa.reviews', selected?.id],
    queryFn: () =>
      api!.assignments.qaReviews(selected!.id) as Promise<QAReviewRow[]>,
    enabled: live && !!selected,
  });

  // Reset checklist state when selection changes.
  useEffect(() => {
    if (!items.length) return;
    const init: Record<string, { checked: boolean; note?: string }> = {};
    for (const it of items) init[it.key] = { checked: false };
    setChecks(init);
    setComment('');
    setShowReview(false);
  }, [selected?.id, items]);

  const submitMut = useMutation({
    mutationFn: (payload: {
      result: 'approved' | 'rejected' | 'revision_requested';
    }) => {
      if (!live || !selected || !user) return Promise.resolve({ ok: false });
      return api!.qa.submit({
        assignmentId: selected.id,
        stage,
        reviewerId: user.id,
        result: payload.result,
        checklist: checks,
        comment: comment || undefined,
      });
    },
    onSuccess: (res: { ok: boolean; error?: string; nextState?: string }) => {
      if (res?.ok) {
        qc.invalidateQueries({ queryKey: ['qa.inbox'] });
        qc.invalidateQueries({ queryKey: ['qa.reviews'] });
        qc.invalidateQueries({ queryKey: ['assignments.list'] });
        qc.invalidateQueries({ queryKey: ['home.stats'] });
        setShowReview(false);
        setComment('');
      } else {
        alert(`제출 실패: ${res?.error ?? 'unknown'}`);
      }
    },
  });

  const requiredUnchecked = useMemo(() => {
    return items.filter((it) => it.required && !checks[it.key]?.checked);
  }, [items, checks]);
  const allRequiredOk = requiredUnchecked.length === 0;
  const hasCheck = Object.values(checks).some((v) => v.checked);

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 {stageLabel} 큐를 확인할 수 있습니다.
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
            <ShieldCheck size={20} /> {stageLabel}
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
            <span className="text-xs text-fg-subtle">{rows.length}건</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
            {rows.length === 0 && (
              <div className="p-6 text-center text-sm text-fg-subtle">
                검토 대기 건이 없습니다.
              </div>
            )}
            {rows.map((r) => {
              const active = selected?.id === r.id;
              const due = formatDueLabel(r.due_at ?? null);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 space-y-1 transition',
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
            })}
          </div>
        </div>

        {/* Detail + Checklist */}
        <div className="col-span-12 lg:col-span-8 space-y-4">
          {!selected && (
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
                        <Clock size={11} /> 마감 {fmtDateTime(selected.due_at)}
                      </div>
                    )}
                    <div className="flex items-center gap-1 justify-end mt-0.5">
                      <UserIcon size={11} />
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
              </div>

              {/* Checklist */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-1.5">
                    <ClipboardCheck size={15} /> {stageLabel} 체크리스트
                  </h3>
                  {!allRequiredOk && (
                    <span className="text-[11px] text-amber-300 flex items-center gap-1">
                      <AlertTriangle size={11} /> 필수 항목 {requiredUnchecked.length}개 미체크
                    </span>
                  )}
                </div>

                {items.length === 0 && (
                  <div className="text-sm text-fg-subtle">
                    활성화된 체크리스트 템플릿이 없습니다.
                  </div>
                )}

                <div className="space-y-1.5">
                  {items.map((it) => {
                    const v = checks[it.key] ?? { checked: false };
                    return (
                      <div
                        key={it.key}
                        className={cn(
                          'flex items-start gap-2 p-2 rounded border transition',
                          v.checked
                            ? 'border-emerald-500/30 bg-emerald-500/5'
                            : 'border-border hover:border-fg-subtle',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setChecks((p) => ({
                              ...p,
                              [it.key]: { ...p[it.key], checked: !v.checked },
                            }))
                          }
                          className="pt-0.5"
                        >
                          {v.checked ? (
                            <CheckSquare size={16} className="text-emerald-300" />
                          ) : (
                            <Square size={16} className="text-fg-subtle" />
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
                            onChange={(e) =>
                              setChecks((p) => ({
                                ...p,
                                [it.key]: {
                                  ...(p[it.key] ?? { checked: false }),
                                  note: e.target.value,
                                },
                              }))
                            }
                            className="input text-xs py-1 mt-1 w-full"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Result controls */}
                {!showReview ? (
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!allRequiredOk || !hasCheck}
                      onClick={() => setShowReview(true)}
                      className="btn-primary text-sm flex items-center gap-1.5"
                    >
                      <Check size={14} /> 리뷰 제출
                    </button>
                    <span className="text-xs text-fg-subtle">
                      필수 항목을 모두 체크 후 리뷰 유형을 선택합니다.
                    </span>
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    <label className="text-xs text-fg-subtle flex items-center gap-1">
                      <MessageSquare size={12} /> 코멘트
                    </label>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                      className="input text-sm w-full"
                      placeholder={
                        stage === 'QA1'
                          ? '1차 검토 결과 및 다음 단계에 전달할 메모'
                          : '최종 승인/반려 사유'
                      }
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        disabled={submitMut.isPending}
                        onClick={() => submitMut.mutate({ result: 'approved' })}
                        className="btn-primary text-sm bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1.5"
                      >
                        <Check size={14} /> 승인
                      </button>
                      <button
                        type="button"
                        disabled={submitMut.isPending}
                        onClick={() => submitMut.mutate({ result: 'revision_requested' })}
                        className="btn-outline text-sm flex items-center gap-1.5"
                      >
                        <RotateCcw size={14} /> 수정 요청
                      </button>
                      <button
                        type="button"
                        disabled={submitMut.isPending}
                        onClick={() => submitMut.mutate({ result: 'rejected' })}
                        className="btn-outline text-sm border-rose-500/40 text-rose-300 flex items-center gap-1.5"
                      >
                        <X size={14} /> 반려
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowReview(false)}
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
                {(!reviewsQuery.data || reviewsQuery.data.length === 0) && (
                  <div className="text-sm text-fg-subtle">아직 리뷰 기록이 없습니다.</div>
                )}
                <div className="space-y-2">
                  {(reviewsQuery.data ?? []).map((rv) => {
                    const tone =
                      rv.result === 'approved'
                        ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5'
                        : rv.result === 'rejected'
                          ? 'text-rose-300 border-rose-500/30 bg-rose-500/5'
                          : 'text-amber-300 border-amber-500/30 bg-amber-500/5';
                    const label =
                      rv.result === 'approved'
                        ? '승인'
                        : rv.result === 'rejected'
                          ? '반려'
                          : '수정요청';
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

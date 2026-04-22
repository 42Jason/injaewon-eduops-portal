import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Edit3, FileText, Plus, Trash2 } from 'lucide-react';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { firstError, required } from '@/lib/validators';
import { fmtDate } from '@/lib/date';
import { sortIsoDesc, studentIdsKey, TOPIC_STATUS, uniqueById } from './model';
import type {
  ArchiveCategory,
  ArchiveFileRow,
  AssignmentRow,
  CounselingLogRow,
  GradeRow,
  ParsingDetail,
  ParsingJsonDraft,
  ParsingRow,
  StudentDetail,
  StudentGroupRow,
  StudentListRow,
  Tab,
  TopicRow,
  TopicStatus,
} from './model';

import { useMemoResetModal } from './hooks';
import { StatusBadge } from './detail';

export function TopicsTab({
  studentId,
  studentIds,
  currentUserId,
}: {
  studentId: number;
  studentIds?: number[];
  currentUserId: number;
}) {
  const api = getApi()!;
  const confirm = useConfirm();
  const [editing, setEditing] = useState<TopicRow | 'new' | null>(null);

  const ids = studentIds && studentIds.length > 0 ? studentIds : [studentId];
  const groupKey = studentIdsKey(ids);

  const topicsQuery = useQuery({
    queryKey: ['students.topics.grouped', groupKey],
    queryFn: async () =>
      sortIsoDesc(
        uniqueById(
          (await Promise.all(
            ids.map((id) => api.students.listReportTopics(id) as unknown as Promise<TopicRow[]>),
          )).flat(),
        ),
        (row) => row.updated_at,
      ),
  });

  const topics = topicsQuery.data ?? [];

  const deleteMutation = useMutationWithToast({
    mutationFn: (id: number) => api.students.deleteReportTopic({ id, actorId: currentUserId }),
    successMessage: '주제를 삭제했습니다',
    errorMessage: '주제 삭제에 실패했습니다',
    invalidates: [
      ['students.topics', studentId],
      ['students.topics.grouped'],
      ['students.list'],
    ],
  });

  async function handleDelete(t: TopicRow) {
    const ok = await confirm({
      title: '보고서 주제 삭제',
      description: `"${t.title}" 주제를 정말 삭제할까요? 연결된 파일은 주제 연결만 해제되고 파일 자체는 남습니다.`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (ok) deleteMutation.mutate(t.id);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg flex items-center gap-1.5">
          <FileText size={14} /> 수행평가 / 보고서 주제
        </h3>
        <button
          type="button"
          className="btn-primary text-xs flex items-center gap-1"
          onClick={() => setEditing('new')}
        >
          <Plus size={12} /> 새 주제 추가
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        {topicsQuery.isLoading ? (
          <LoadingPanel label="보고서 주제를 불러오는 중…" />
        ) : topics.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="등록된 보고서 주제가 없습니다"
            hint="오른쪽 상단의 '새 주제 추가' 버튼으로 등록하세요."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-bg-soft/50 text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">제목</th>
                  <th className="px-3 py-2 text-left font-medium">과목</th>
                  <th className="px-3 py-2 text-left font-medium">주제</th>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">마감</th>
                  <th className="px-3 py-2 text-left font-medium">제출</th>
                  <th className="px-3 py-2 text-left font-medium">점수</th>
                  <th className="px-3 py-2 text-left font-medium">파일</th>
                  <th className="px-3 py-2 text-right font-medium">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topics.map((t) => (
                  <tr key={t.id} className="hover:bg-bg-soft/40">
                    <td className="px-3 py-2">
                      <div className="font-medium text-fg">{t.title}</div>
                      {t.assignment_code && (
                        <div className="text-[10px] text-fg-subtle tabular-nums">
                          연결: {t.assignment_code}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{t.subject ?? '—'}</td>
                    <td className="px-3 py-2 text-fg-muted max-w-[240px] truncate">
                      {t.topic ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-fg-subtle">
                      {t.due_at ? fmtDate(t.due_at) : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-fg-subtle">
                      {t.submitted_at ? fmtDate(t.submitted_at) : '—'}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{t.score ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-fg-subtle">{t.file_count}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="btn-ghost text-xs flex items-center gap-1"
                          onClick={() => setEditing(t)}
                        >
                          <Edit3 size={12} /> 수정
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs text-rose-300 flex items-center gap-1"
                          onClick={() => handleDelete(t)}
                        >
                          <Trash2 size={12} /> 삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TopicModal
        studentId={studentId}
        currentUserId={currentUserId}
        initial={editing}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

// -----------------------------------------------------------------------------
// Topic modal (create / edit)
// -----------------------------------------------------------------------------

function TopicModal({
  studentId,
  currentUserId,
  initial,
  onClose,
}: {
  studentId: number;
  currentUserId: number;
  initial: TopicRow | 'new' | null;
  onClose: () => void;
}) {
  const api = getApi()!;
  const open = initial !== null;
  const editing = initial && initial !== 'new' ? initial : null;

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [status, setStatus] = useState<TopicStatus>('planned');
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [dueAt, setDueAt] = useState('');
  const [submittedAt, setSubmittedAt] = useState('');
  const [score, setScore] = useState('');
  const [memo, setMemo] = useState('');
  const [touched, setTouched] = useState(false);

  // reset when the modal opens or the edited row changes
  useMemoResetModal(open, editing, {
    setTitle,
    setSubject,
    setTopic,
    setStatus,
    setAssignmentId,
    setDueAt,
    setSubmittedAt,
    setScore,
    setMemo,
    setTouched,
  });

  const assignmentsForStudent = useQuery({
    queryKey: ['students.history', studentId],
    queryFn: () =>
      api.students.history(studentId) as unknown as Promise<{
        assignments: AssignmentRow[];
        parsings: ParsingRow[];
      }>,
    enabled: open,
  });

  const assignments = assignmentsForStudent.data?.assignments ?? [];

  const titleErr =
    touched && firstError<string>([required('제목은 필수입니다')])(title);

  const save = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.students.upsertReportTopic>[0]) =>
      api.students.upsertReportTopic(payload),
    successMessage: editing ? '주제를 수정했습니다' : '주제를 추가했습니다',
    errorMessage: '주제 저장에 실패했습니다',
    invalidates: [
      ['students.topics', studentId],
      ['students.topics.grouped'],
      ['students.list'],
    ],
    onSuccess: () => onClose(),
  });

  function submit() {
    setTouched(true);
    if (titleErr) return;
    save.mutate({
      id: editing?.id,
      studentId,
      title: title.trim(),
      subject: subject.trim() || null,
      topic: topic.trim() || null,
      status,
      assignmentId: assignmentId ?? null,
      dueAt: dueAt || null,
      submittedAt: submittedAt || null,
      score: score.trim() || null,
      memo: memo.trim() || null,
      actorId: currentUserId,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? '보고서 주제 수정' : '새 보고서 주제'}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={submit}
            disabled={save.isPending}
          >
            {save.isPending ? '저장 중…' : '저장'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="제목" required error={titleErr || null} className="md:col-span-2">
          {(slot) => (
            <TextInput
              {...slot}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 2025-2 화학 수행평가 - 이온결합"
              maxLength={120}
            />
          )}
        </FormField>
        <FormField label="과목">
          {(slot) => (
            <TextInput
              {...slot}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="화학 / 국어 / 영어 …"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="상태">
          {(slot) => (
            <SelectInput
              {...slot}
              value={status}
              onChange={(e) => setStatus(e.target.value as TopicStatus)}
            >
              {(Object.keys(TOPIC_STATUS) as TopicStatus[]).map((s) => (
                <option key={s} value={s}>
                  {TOPIC_STATUS[s].label}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
        <FormField label="세부 주제" className="md:col-span-2">
          {(slot) => (
            <Textarea
              {...slot}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="구체적인 연구 주제, 범위, 참고한 단원 등"
              rows={2}
              maxLength={500}
            />
          )}
        </FormField>
        <FormField label="연결된 과제">
          {(slot) => (
            <SelectInput
              {...slot}
              value={assignmentId === null ? '' : String(assignmentId)}
              onChange={(e) =>
                setAssignmentId(e.target.value === '' ? null : Number(e.target.value))
              }
            >
              <option value="">(선택 안 함)</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.title}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
        <FormField label="점수 / 등급">
          {(slot) => (
            <TextInput
              {...slot}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="A+, 95/100, 상위 10% …"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="마감일">
          {(slot) => (
            <TextInput
              {...slot}
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="제출일">
          {(slot) => (
            <TextInput
              {...slot}
              type="date"
              value={submittedAt}
              onChange={(e) => setSubmittedAt(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="메모" className="md:col-span-2">
          {(slot) => (
            <Textarea
              {...slot}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="교사 피드백, 주의사항, 다음 학기 계획 등"
              rows={3}
              maxLength={1000}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Tab: Files — metadata-only archive (bytes not stored yet)
// -----------------------------------------------------------------------------

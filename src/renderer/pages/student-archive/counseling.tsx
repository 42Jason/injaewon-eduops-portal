import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Edit3, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, TextInput, Textarea } from '@/components/ui/FormField';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { firstError, required } from '@/lib/validators';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { sortIsoDesc, studentIdsKey, uniqueById } from './model';
import type { CounselingLogRow } from './model';

// -----------------------------------------------------------------------------
// Tab: Counseling logs (상담 이력)
// -----------------------------------------------------------------------------

export function CounselingTab({
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
  const [editing, setEditing] = useState<CounselingLogRow | 'new' | null>(null);

  const ids = studentIds && studentIds.length > 0 ? studentIds : [studentId];
  const groupKey = studentIdsKey(ids);

  const logsQuery = useQuery({
    queryKey: ['students.counseling.grouped', groupKey],
    queryFn: async () =>
      sortIsoDesc(
        uniqueById(
          (await Promise.all(
            ids.map((id) => api.students.listCounseling(id) as unknown as Promise<CounselingLogRow[]>),
          )).flat(),
        ),
        (row) => row.log_date || row.updated_at,
      ),
  });

  const logs = logsQuery.data ?? [];

  const deleteMutation = useMutationWithToast({
    mutationFn: (id: number) =>
      api.students.deleteCounseling({ id, actorId: currentUserId }),
    successMessage: '상담 기록을 삭제했습니다',
    errorMessage: '삭제에 실패했습니다',
    invalidates: [['students.counseling'], ['students.counseling.grouped']],
  });

  async function handleDelete(log: CounselingLogRow) {
    const ok = await confirm({
      title: '상담 기록 삭제',
      description: `"${log.title}" 상담 기록을 삭제할까요?`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (ok) deleteMutation.mutate(log.id);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg flex items-center gap-1.5">
          <MessageSquare size={14} /> 상담 이력
        </h3>
        <button
          type="button"
          className="btn-primary text-xs flex items-center gap-1"
          onClick={() => setEditing('new')}
        >
          <Plus size={12} /> 상담 기록 추가
        </button>
      </div>

      {logsQuery.isLoading ? (
        <LoadingPanel label="상담 이력을 불러오는 중…" />
      ) : logs.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={MessageSquare}
            title="등록된 상담 기록이 없습니다"
            hint="'상담 기록 추가'로 학생/학부모 상담 내역을 기록합니다."
          />
        </div>
      ) : (
        <ol className="space-y-2">
          {logs.map((log) => (
            <li key={log.id} className="card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
                    <span className="tabular-nums text-fg-subtle text-xs">
                      {fmtDate(log.log_date)}
                    </span>
                    <span className="font-semibold">{log.title}</span>
                    {log.category && (
                      <span className="rounded border border-border bg-bg-soft px-1.5 py-0.5 text-[10px] text-fg-muted">
                        {log.category}
                      </span>
                    )}
                  </div>
                  {log.body && (
                    <p className="mt-1 text-xs text-fg-muted whitespace-pre-line">
                      {log.body}
                    </p>
                  )}
                  <div className="mt-1 text-[10px] text-fg-subtle">
                    작성 {log.created_by_name ?? '—'} · {fmtDateTime(log.updated_at)}
                  </div>
                </div>
                <div className="inline-flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    className="btn-ghost text-xs flex items-center gap-1"
                    onClick={() => setEditing(log)}
                  >
                    <Edit3 size={12} /> 수정
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs text-rose-300 flex items-center gap-1"
                    onClick={() => handleDelete(log)}
                  >
                    <Trash2 size={12} /> 삭제
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <CounselingModal
        studentId={studentId}
        currentUserId={currentUserId}
        initial={editing}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

function CounselingModal({
  studentId,
  currentUserId,
  initial,
  onClose,
}: {
  studentId: number;
  currentUserId: number;
  initial: CounselingLogRow | 'new' | null;
  onClose: () => void;
}) {
  const api = getApi()!;
  const open = initial !== null;
  const editing = initial && initial !== 'new' ? initial : null;

  const [logDate, setLogDate] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setLogDate(editing.log_date ? editing.log_date.slice(0, 10) : '');
      setTitle(editing.title);
      setBody(editing.body ?? '');
      setCategory(editing.category ?? '');
    } else {
      const today = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      setLogDate(
        `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
      );
      setTitle('');
      setBody('');
      setCategory('');
    }
    setTouched(false);
  }, [open, editing]);

  const logDateErr =
    touched && firstError<string>([required('상담 일자는 필수입니다')])(logDate);
  const titleErr =
    touched && firstError<string>([required('제목은 필수입니다')])(title);

  const save = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.students.upsertCounseling>[0]) =>
      api.students.upsertCounseling(payload),
    successMessage: editing ? '상담 기록을 수정했습니다' : '상담 기록을 추가했습니다',
    errorMessage: '상담 저장에 실패했습니다',
    invalidates: [['students.counseling'], ['students.counseling.grouped']],
    onSuccess: () => onClose(),
  });

  function submit() {
    setTouched(true);
    if (logDateErr || titleErr) return;
    save.mutate({
      id: editing?.id,
      studentId,
      logDate,
      title: title.trim(),
      body: body.trim() || null,
      category: category.trim() || null,
      actorId: currentUserId,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? '상담 기록 수정' : '상담 기록 추가'}
      size="md"
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
        <FormField label="상담 일자" required error={logDateErr || null}>
          {(slot) => (
            <TextInput
              {...slot}
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="분류" hint="예: 학부모, 학생, 진로, 학습 등">
          {(slot) => (
            <TextInput
              {...slot}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="(선택) 학부모 / 학생 / 진로 …"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="제목" required error={titleErr || null} className="md:col-span-2">
          {(slot) => (
            <TextInput
              {...slot}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 2025-1 수행평가 일정 조정 요청"
              maxLength={120}
            />
          )}
        </FormField>
        <FormField label="내용" className="md:col-span-2">
          {(slot) => (
            <Textarea
              {...slot}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="상담 내용·결정 사항·후속 조치 등을 자유롭게 기록합니다."
              rows={6}
              maxLength={4000}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

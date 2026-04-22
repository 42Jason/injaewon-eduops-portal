import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Edit3, GraduationCap, Plus, Trash2 } from 'lucide-react';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, TextInput, Textarea } from '@/components/ui/FormField';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { firstError, required } from '@/lib/validators';
import { fmtDateTime } from '@/lib/date';
import { sortIsoDesc, studentIdsKey, uniqueById } from './model';
import type { GradeRow } from './model';

// -----------------------------------------------------------------------------
// Tab: Grades (내신 성적)
// -----------------------------------------------------------------------------

export function GradesTab({
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
  const [editing, setEditing] = useState<GradeRow | 'new' | null>(null);

  const ids = studentIds && studentIds.length > 0 ? studentIds : [studentId];
  const groupKey = studentIdsKey(ids);

  const gradesQuery = useQuery({
    queryKey: ['students.grades.grouped', groupKey],
    queryFn: async () =>
      sortIsoDesc(
        uniqueById(
          (await Promise.all(
            ids.map((id) => api.students.listGrades(id) as unknown as Promise<GradeRow[]>),
          )).flat(),
        ),
        (row) => row.updated_at,
      ),
  });

  const grades = gradesQuery.data ?? [];

  // Group by grade_level/semester for readability.
  const grouped = useMemo(() => {
    const groups = new Map<string, GradeRow[]>();
    for (const g of grades) {
      const key = `${g.grade_level} / ${g.semester}`;
      const arr = groups.get(key) ?? [];
      arr.push(g);
      groups.set(key, arr);
    }
    return Array.from(groups.entries());
  }, [grades]);

  const deleteMutation = useMutationWithToast({
    mutationFn: (id: number) =>
      api.students.deleteGrade({ id, actorId: currentUserId }),
    successMessage: '내신 성적을 삭제했습니다',
    errorMessage: '삭제에 실패했습니다',
    invalidates: [['students.grades'], ['students.grades.grouped']],
  });

  async function handleDelete(g: GradeRow) {
    const ok = await confirm({
      title: '내신 성적 삭제',
      description: `${g.grade_level} ${g.semester} · ${g.subject} 기록을 삭제할까요?`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (ok) deleteMutation.mutate(g.id);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg flex items-center gap-1.5">
          <GraduationCap size={14} /> 내신 성적
        </h3>
        <button
          type="button"
          className="btn-primary text-xs flex items-center gap-1"
          onClick={() => setEditing('new')}
        >
          <Plus size={12} /> 내신 추가
        </button>
      </div>

      {gradesQuery.isLoading ? (
        <LoadingPanel label="내신 성적을 불러오는 중…" />
      ) : grades.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={GraduationCap}
            title="등록된 내신 성적이 없습니다"
            hint="'내신 추가' 버튼으로 학년/학기/과목별 성적을 기록합니다."
          />
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(([key, rows]) => (
            <div key={key} className="card p-0 overflow-hidden">
              <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 bg-bg-soft/30">
                <h4 className="text-xs font-semibold text-fg">{key}</h4>
                <span className="text-[11px] text-fg-subtle">{rows.length}과목</span>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-bg-soft/50 text-fg-muted">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">과목</th>
                      <th className="px-3 py-2 text-left font-medium">등급</th>
                      <th className="px-3 py-2 text-left font-medium">원점수</th>
                      <th className="px-3 py-2 text-left font-medium">메모</th>
                      <th className="px-3 py-2 text-left font-medium">입력자</th>
                      <th className="px-3 py-2 text-right font-medium">액션</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((g) => (
                      <tr key={g.id} className="hover:bg-bg-soft/40">
                        <td className="px-3 py-2 font-medium text-fg">{g.subject}</td>
                        <td className="px-3 py-2 text-fg-muted">{g.score ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-fg-subtle">
                          {g.raw_score === null || g.raw_score === undefined ? '—' : g.raw_score}
                        </td>
                        <td className="px-3 py-2 text-fg-muted max-w-[260px] truncate">
                          {g.memo ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-fg-subtle">{g.created_by_name ?? '—'}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              className="btn-ghost text-xs flex items-center gap-1"
                              onClick={() => setEditing(g)}
                            >
                              <Edit3 size={12} /> 수정
                            </button>
                            <button
                              type="button"
                              className="btn-ghost text-xs text-rose-300 flex items-center gap-1"
                              onClick={() => handleDelete(g)}
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
            </div>
          ))}
        </div>
      )}

      <GradeModal
        studentId={studentId}
        currentUserId={currentUserId}
        initial={editing}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

function GradeModal({
  studentId,
  currentUserId,
  initial,
  onClose,
}: {
  studentId: number;
  currentUserId: number;
  initial: GradeRow | 'new' | null;
  onClose: () => void;
}) {
  const api = getApi()!;
  const open = initial !== null;
  const editing = initial && initial !== 'new' ? initial : null;

  const [gradeLevel, setGradeLevel] = useState('');
  const [semester, setSemester] = useState('');
  const [subject, setSubject] = useState('');
  const [score, setScore] = useState('');
  const [rawScore, setRawScore] = useState('');
  const [memo, setMemo] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setGradeLevel(editing.grade_level);
      setSemester(editing.semester);
      setSubject(editing.subject);
      setScore(editing.score ?? '');
      setRawScore(
        editing.raw_score === null || editing.raw_score === undefined
          ? ''
          : String(editing.raw_score),
      );
      setMemo(editing.memo ?? '');
    } else {
      setGradeLevel('');
      setSemester('');
      setSubject('');
      setScore('');
      setRawScore('');
      setMemo('');
    }
    setTouched(false);
  }, [open, editing]);

  const gradeLevelErr =
    touched && firstError<string>([required('학년은 필수입니다')])(gradeLevel);
  const semesterErr =
    touched && firstError<string>([required('학기는 필수입니다')])(semester);
  const subjectErr =
    touched && firstError<string>([required('과목은 필수입니다')])(subject);

  const save = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.students.upsertGrade>[0]) =>
      api.students.upsertGrade(payload),
    successMessage: editing ? '내신 성적을 수정했습니다' : '내신 성적을 추가했습니다',
    errorMessage: '내신 저장에 실패했습니다',
    invalidates: [['students.grades'], ['students.grades.grouped']],
    onSuccess: () => onClose(),
  });

  function submit() {
    setTouched(true);
    if (gradeLevelErr || semesterErr || subjectErr) return;
    const rawNum = rawScore.trim() === '' ? null : Number(rawScore);
    if (rawNum !== null && Number.isNaN(rawNum)) return;
    save.mutate({
      id: editing?.id,
      studentId,
      gradeLevel: gradeLevel.trim(),
      semester: semester.trim(),
      subject: subject.trim(),
      score: score.trim() || null,
      rawScore: rawNum,
      memo: memo.trim() || null,
      actorId: currentUserId,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? '내신 성적 수정' : '내신 성적 추가'}
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
        <FormField label="학년" required error={gradeLevelErr || null}>
          {(slot) => (
            <TextInput
              {...slot}
              value={gradeLevel}
              onChange={(e) => setGradeLevel(e.target.value)}
              placeholder="예: 고1 / 중3"
              maxLength={20}
            />
          )}
        </FormField>
        <FormField label="학기" required error={semesterErr || null}>
          {(slot) => (
            <TextInput
              {...slot}
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              placeholder="예: 1학기 / 2학기"
              maxLength={20}
            />
          )}
        </FormField>
        <FormField label="과목" required error={subjectErr || null} className="md:col-span-2">
          {(slot) => (
            <TextInput
              {...slot}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="예: 수학 / 국어 / 영어 …"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="등급 / 표기" hint="예: 1등급, A, 상위 10%">
          {(slot) => (
            <TextInput
              {...slot}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="예: 1등급"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="원점수" hint="숫자만 입력. 예: 92.5">
          {(slot) => (
            <TextInput
              {...slot}
              type="number"
              step="0.1"
              value={rawScore}
              onChange={(e) => setRawScore(e.target.value)}
              placeholder="예: 92.5"
            />
          )}
        </FormField>
        <FormField label="메모" className="md:col-span-2">
          {(slot) => (
            <Textarea
              {...slot}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="시험 범위·단원, 기억할 점, 피드백 등"
              rows={3}
              maxLength={1000}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

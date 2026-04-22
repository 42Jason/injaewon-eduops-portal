import { useEffect, useState } from 'react';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import { firstError, required } from '@/lib/validators';
import type { StudentDetail } from './model';

// -----------------------------------------------------------------------------
// Student create / edit modal
// -----------------------------------------------------------------------------

export function StudentEditModal({
  open,
  mode,
  initial,
  currentUserId,
  onClose,
  onCreated,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  initial: StudentDetail | null;
  currentUserId: number;
  onClose: () => void;
  onCreated?: (id: number) => void;
}) {
  const api = getApi()!;

  const [studentCode, setStudentCode] = useState('');
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');
  const [school, setSchool] = useState('');
  const [schoolNo, setSchoolNo] = useState('');
  const [phone, setPhone] = useState('');
  const [guardian, setGuardian] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [gradeMemo, setGradeMemo] = useState('');
  const [memo, setMemo] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit' && initial) {
      setStudentCode(initial.student_code);
      setName(initial.name);
      setGrade(initial.grade ?? '');
      setSchool(initial.school ?? '');
      setSchoolNo(initial.school_no ?? '');
      setPhone(initial.phone ?? '');
      setGuardian(initial.guardian ?? '');
      setGuardianPhone(initial.guardian_phone ?? '');
      setGradeMemo(initial.grade_memo ?? '');
      setMemo(initial.memo ?? '');
    } else {
      setStudentCode('');
      setName('');
      setGrade('');
      setSchool('');
      setSchoolNo('');
      setPhone('');
      setGuardian('');
      setGuardianPhone('');
      setGradeMemo('');
      setMemo('');
    }
    setTouched(false);
  }, [open, mode, initial]);

  const nameErr = touched && firstError<string>([required('이름은 필수입니다')])(name);
  const isEditing = mode === 'edit' && initial !== null;
  const fromNotion = isEditing && Boolean(initial?.notion_page_id);

  const createMutation = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.students.create>[0]) =>
      api.students.create(payload),
    successMessage: '학생을 추가했습니다',
    errorMessage: '학생 추가에 실패했습니다',
    invalidates: [['students.list']],
    onSuccess: (res) => {
      if (res?.ok && typeof res.id === 'number' && onCreated) {
        onCreated(res.id);
      }
      onClose();
    },
  });

  const updateMutation = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.students.update>[0]) =>
      api.students.update(payload),
    successMessage: '학생 정보를 수정했습니다',
    errorMessage: '학생 정보 수정에 실패했습니다',
    invalidates: initial
      ? [['students.list'], ['students.get'] as const]
      : [['students.list']],
    onSuccess: () => onClose(),
  });

  function submit() {
    setTouched(true);
    if (nameErr) return;
    if (isEditing && initial) {
      updateMutation.mutate({
        id: initial.id,
        name: name.trim(),
        grade: grade.trim() || null,
        school: school.trim() || null,
        schoolNo: schoolNo.trim() || null,
        phone: phone.trim() || null,
        guardian: guardian.trim() || null,
        guardianPhone: guardianPhone.trim() || null,
        gradeMemo: gradeMemo.trim() || null,
        memo: memo.trim() || null,
        actorId: currentUserId,
      });
    } else {
      createMutation.mutate({
        studentCode: studentCode.trim() || null,
        name: name.trim(),
        grade: grade.trim() || null,
        school: school.trim() || null,
        schoolNo: schoolNo.trim() || null,
        phone: phone.trim() || null,
        guardian: guardian.trim() || null,
        guardianPhone: guardianPhone.trim() || null,
        gradeMemo: gradeMemo.trim() || null,
        memo: memo.trim() || null,
        actorId: currentUserId,
      });
    }
  }

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? '학생 정보 수정' : '새 학생 추가'}
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
            disabled={saving}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </>
      }
    >
      {fromNotion && (
        <div className="mb-3 rounded border border-indigo-500/30 bg-indigo-500/10 p-2 text-[11px] text-indigo-200">
          이 학생은 노션에서 동기화되었습니다. 여기서 바꾼 내용은 로컬 DB에만 저장되며, 다음 노션 동기화 시 노션 값으로 덮어쓰일 수 있습니다.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField
          label="학생 코드"
          hint={
            isEditing
              ? '학생 코드는 최초 등록 시에만 지정합니다.'
              : '비워두면 M-YYMMDDHHmm-XXXX 형태로 자동 발급됩니다.'
          }
        >
          {(slot) => (
            <TextInput
              {...slot}
              value={studentCode}
              onChange={(e) => setStudentCode(e.target.value)}
              placeholder={isEditing ? '' : '예: 2025-SC-001 (선택)'}
              maxLength={60}
              disabled={isEditing}
            />
          )}
        </FormField>
        <FormField label="이름" required error={nameErr || null}>
          {(slot) => (
            <TextInput
              {...slot}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 홍길동"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="학년/학기">
          {(slot) => (
            <TextInput
              {...slot}
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="예: 고1 / 중3"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="학교">
          {(slot) => (
            <TextInput
              {...slot}
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="예: 한빛고등학교"
              maxLength={80}
            />
          )}
        </FormField>
        <FormField label="학번">
          {(slot) => (
            <TextInput
              {...slot}
              value={schoolNo}
              onChange={(e) => setSchoolNo(e.target.value)}
              placeholder="예: 1학년 3반 12번"
              maxLength={60}
            />
          )}
        </FormField>
        <FormField label="학생 연락처">
          {(slot) => (
            <TextInput
              {...slot}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="010-1234-5678"
              maxLength={30}
            />
          )}
        </FormField>
        <FormField label="보호자">
          {(slot) => (
            <TextInput
              {...slot}
              value={guardian}
              onChange={(e) => setGuardian(e.target.value)}
              placeholder="예: 홍부모"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="보호자 연락처">
          {(slot) => (
            <TextInput
              {...slot}
              value={guardianPhone}
              onChange={(e) => setGuardianPhone(e.target.value)}
              placeholder="010-9876-5432"
              maxLength={30}
            />
          )}
        </FormField>
        <FormField label="내신 메모" className="md:col-span-2" hint="자유 텍스트. 예: 2025-1 전 과목 1등급, 수학 약함 등">
          {(slot) => (
            <Textarea
              {...slot}
              value={gradeMemo}
              onChange={(e) => setGradeMemo(e.target.value)}
              placeholder="학생의 내신 상태·경향을 자유롭게 기록합니다."
              rows={3}
              maxLength={2000}
            />
          )}
        </FormField>
        <FormField label="일반 메모" className="md:col-span-2">
          {(slot) => (
            <Textarea
              {...slot}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="특이사항, 주의점, 상담 포인트 등"
              rows={3}
              maxLength={2000}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

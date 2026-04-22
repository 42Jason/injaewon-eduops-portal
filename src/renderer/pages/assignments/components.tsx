import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, RotateCcw, Sparkles, Trash2, Users as UsersIcon, X } from 'lucide-react';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import { Spinner } from '@/components/ui/Spinner';
import { ASSIGNMENT_STATES, type AssignmentState, type Risk } from '@shared/types/assignment';
import { stateChipClass } from '@/lib/assignment';
import { fmtDateTime } from '@/lib/date';
import { cn } from '@/lib/cn';
import { pick, rowDue, rowScope, rowStudent, rowTitle } from './model';
import type { AssignmentRow, ParsingRow, QaReviewRow } from './model';

/* ========================================================================= */
/* helpers                                                                   */

export function AssigneeCard({ role, name }: { role: string; name: string | null }) {
  return (
    <div className="rounded-md border border-border bg-bg-soft/40 p-2">
      <div className="text-[10px] text-fg-subtle">{role}</div>
      <div className={cn('mt-0.5 truncate', name ? 'text-fg' : 'text-fg-subtle')}>
        {name ?? '미배정'}
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'warning' | 'ok' | 'muted';
}) {
  return (
    <div className="rounded-md border border-border bg-bg-soft/40 p-2">
      <div className="text-[10px] text-fg-subtle">{label}</div>
      <div
        className={cn(
          'mt-0.5',
          tone === 'danger'  && 'text-rose-300',
          tone === 'warning' && 'text-amber-300',
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function ParsingCard({ data }: { data: ParsingRow }) {
  let fields: Record<string, unknown> | null = null;
  try {
    fields = data.content_json ? JSON.parse(data.content_json) : null;
  } catch {
    fields = null;
  }
  return (
    <div className="rounded-lg border border-border bg-bg-soft/40 p-3 space-y-2">
      {data.ai_summary && (
        <div className="rounded-md border border-accent/30 bg-accent/5 p-2 text-xs text-fg leading-relaxed">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">AI 요약</span>
          <div className="mt-0.5">{data.ai_summary}</div>
          {typeof data.confidence === 'number' && (
            <div className="mt-1 text-[10px] text-fg-subtle">신뢰도 {Math.round(data.confidence * 100)}%</div>
          )}
        </div>
      )}
      {fields && (
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
          {(
            [
              ['subject',             '과목'],
              ['publisher',           '출판사'],
              ['studentCode',         '학생'],
              ['assignmentTitle',     '수행평가명'],
              ['assignmentScope',     '수행범위'],
              ['lengthRequirement',   '분량'],
              ['outline',             '개요'],
              ['rubric',              '평가기준'],
              ['teacherRequirements', '교사요구'],
              ['studentRequests',     '학생요구'],
            ] as const
          ).map(([k, label]) => {
            const v = fields![k];
            if (!v) return null;
            return (
              <div key={k} className="col-span-2 grid grid-cols-[80px_1fr] gap-2">
                <dt className="text-fg-subtle">{label}</dt>
                <dd className="text-fg">{String(v)}</dd>
              </div>
            );
          })}
        </dl>
      )}
      <div className="text-[10px] text-fg-subtle">파싱 시각: {fmtDateTime(data.parsed_at)} · v{data.version ?? 1}</div>
    </div>
  );
}

export function ResultPill({ result }: { result: QaReviewRow['result'] }) {
  if (result === 'approved')
    return <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-emerald-300">승인</span>;
  if (result === 'rejected')
    return <span className="rounded bg-rose-500/15 px-1 py-0.5 text-rose-300">반려</span>;
  return <span className="rounded bg-amber-500/15 px-1 py-0.5 text-amber-300">수정요청</span>;
}

export function ActionButtons({
  state,
  canParse,
  canQa1,
  canQaFinal,
  disabled,
  pending,
  onTransition,
}: {
  state: AssignmentState;
  canParse?: boolean;
  canQa1?: boolean;
  canQaFinal?: boolean;
  disabled?: boolean;
  pending?: boolean;
  onTransition: (next: AssignmentState) => void;
}) {
  const buttons: Array<{ label: string; next: AssignmentState; icon: typeof Check; variant: 'primary' | 'danger' | 'ghost' }> = [];

  if (canParse) {
    if (state === '파싱대기' || state === '신규접수')
      buttons.push({ label: '파싱 시작', next: '파싱진행중', icon: Sparkles, variant: 'primary' });
    if (state === '파싱진행중' || state === '파싱확인필요')
      buttons.push({ label: '파싱 완료 → 1차 QA', next: '1차QA대기', icon: Check, variant: 'primary' });
  }

  if (canQa1) {
    if (state === '1차QA대기')
      buttons.push({ label: '1차 QA 시작', next: '1차QA진행중', icon: Sparkles, variant: 'primary' });
    if (state === '1차QA진행중') {
      buttons.push({ label: '승인 → 최종 QA', next: '최종QA대기', icon: Check,  variant: 'primary' });
      buttons.push({ label: '반려',           next: '1차QA반려',  icon: X,      variant: 'danger' });
    }
    if (state === '1차QA반려')
      buttons.push({ label: '재파싱 요청',   next: '파싱진행중',  icon: RotateCcw, variant: 'ghost' });
  }

  if (canQaFinal) {
    if (state === '최종QA대기')
      buttons.push({ label: '최종 QA 시작',     next: '최종QA진행중', icon: Sparkles, variant: 'primary' });
    if (state === '최종QA진행중') {
      buttons.push({ label: '승인완료',         next: '승인완료',      icon: Check,    variant: 'primary' });
      buttons.push({ label: '수정요청',         next: '수정요청',      icon: RotateCcw, variant: 'ghost' });
      buttons.push({ label: '반려',             next: '최종QA반려',    icon: X,        variant: 'danger' });
    }
    if (state === '승인완료')
      buttons.push({ label: '완료 처리',        next: '완료',          icon: Check,    variant: 'primary' });
  }

  if (buttons.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-bg-soft/40 p-3 text-[11px] text-fg-subtle">
        현재 상태에서 수행 가능한 액션이 없거나 권한이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {buttons.map((b) => {
        const Icon = b.icon;
        return (
          <button
            key={b.label + b.next}
            type="button"
            onClick={() => onTransition(b.next)}
            disabled={disabled}
            className={cn(
              'w-full inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              b.variant === 'primary' && 'border-accent bg-accent/10 text-accent hover:bg-accent/20',
              b.variant === 'danger'  && 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
              b.variant === 'ghost'   && 'border-border bg-bg-soft text-fg-muted hover:bg-bg-soft/70',
            )}
          >
            {pending ? <Spinner size={12} /> : <Icon size={12} />} {b.label}
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// Bulk toolbar (appears when rows are checked)
// =============================================================================

interface UserOption {
  id: number;
  name: string;
  role: string;
}

export function BulkToolbar({
  count,
  bulkMenu,
  setBulkMenu,
  onBulkState,
  onBulkAssign,
  onBulkDelete,
  onClear,
  pending,
}: {
  count: number;
  bulkMenu: 'state' | 'assign' | null;
  setBulkMenu: (m: 'state' | 'assign' | null) => void;
  onBulkState: (state: AssignmentState) => void;
  onBulkAssign: (a: {
    parserId?: number | null;
    qa1Id?: number | null;
    qaFinalId?: number | null;
  }) => void;
  onBulkDelete: () => void;
  onClear: () => void;
  pending: boolean;
}) {
  const api = getApi();
  const usersQuery = useQuery({
    queryKey: ['users.list'],
    queryFn: () => api!.users.list() as unknown as Promise<UserOption[]>,
    enabled: !!api && bulkMenu === 'assign',
    staleTime: 5 * 60 * 1000,
  });

  const [parserId, setParserId] = useState<number | ''>('');
  const [qa1Id, setQa1Id] = useState<number | ''>('');
  const [qaFinalId, setQaFinalId] = useState<number | ''>('');

  useEffect(() => {
    if (bulkMenu !== 'assign') {
      setParserId('');
      setQa1Id('');
      setQaFinalId('');
    }
  }, [bulkMenu]);

  return (
    <div className="card flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="text-xs font-medium text-fg">
        선택 <span className="text-accent tabular-nums">{count}</span> 건
      </span>
      <div className="mx-1 h-4 w-px bg-border" />

      {/* --- state menu --- */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setBulkMenu(bulkMenu === 'state' ? null : 'state')}
          disabled={pending}
          className="btn-outline text-xs inline-flex items-center gap-1"
          aria-expanded={bulkMenu === 'state'}
        >
          <RotateCcw size={11} /> 일괄 상태 변경
        </button>
        {bulkMenu === 'state' && (
          <div
            className="absolute z-20 mt-1 max-h-64 w-44 overflow-y-auto rounded-md border border-border bg-bg shadow-lg"
            role="menu"
          >
            {ASSIGNMENT_STATES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onBulkState(s)}
                disabled={pending}
                className={cn(
                  'block w-full px-3 py-1.5 text-left text-[11px] hover:bg-bg-soft',
                )}
                role="menuitem"
              >
                <span className={cn('rounded px-1.5 py-0.5 mr-1.5', stateChipClass(s))}>
                  {s}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* --- assign menu --- */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setBulkMenu(bulkMenu === 'assign' ? null : 'assign')}
          disabled={pending}
          className="btn-outline text-xs inline-flex items-center gap-1"
          aria-expanded={bulkMenu === 'assign'}
        >
          <UsersIcon size={11} /> 일괄 담당자 지정
        </button>
        {bulkMenu === 'assign' && (
          <div className="absolute z-20 mt-1 w-80 rounded-md border border-border bg-bg p-3 shadow-lg">
            <div className="space-y-2 text-[11px]">
              <AssignSelect
                label="파싱 담당"
                value={parserId}
                onChange={setParserId}
                users={usersQuery.data ?? []}
              />
              <AssignSelect
                label="1차 QA"
                value={qa1Id}
                onChange={setQa1Id}
                users={usersQuery.data ?? []}
              />
              <AssignSelect
                label="최종 QA"
                value={qaFinalId}
                onChange={setQaFinalId}
                users={usersQuery.data ?? []}
              />
              <div className="text-[10px] text-fg-subtle">
                비워두면 해당 역할은 변경하지 않습니다. "미배정"을 선택하면 해당 역할을 비웁니다.
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setBulkMenu(null)}
                  className="btn-ghost text-[11px]"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // -1 sentinel → null (unassign), '' → undefined (no change)
                    const norm = (v: number | '') =>
                      v === '' ? undefined : v === -1 ? null : v;
                    onBulkAssign({
                      parserId: norm(parserId),
                      qa1Id: norm(qa1Id),
                      qaFinalId: norm(qaFinalId),
                    });
                  }}
                  disabled={
                    pending ||
                    (parserId === '' && qa1Id === '' && qaFinalId === '')
                  }
                  className="btn-primary text-[11px]"
                >
                  적용
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* --- bulk delete --- */}
      <button
        type="button"
        onClick={onBulkDelete}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
      >
        <Trash2 size={11} /> 일괄 삭제
      </button>

      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-[11px] text-fg-subtle hover:text-fg underline underline-offset-2"
      >
        선택 해제
      </button>
    </div>
  );
}

function AssignSelect({
  label,
  value,
  onChange,
  users,
}: {
  label: string;
  value: number | '';
  onChange: (v: number | '') => void;
  users: UserOption[];
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-16 shrink-0 text-fg-muted">{label}</label>
      <select
        value={value === '' ? '' : value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? '' : Number(v));
        }}
        className="input flex-1 h-7 text-[11px]"
      >
        <option value="">변경하지 않음</option>
        <option value="-1">(미배정으로 비우기)</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} · {u.role}
          </option>
        ))}
      </select>
    </div>
  );
}

// =============================================================================
// Assignment create / edit modal
// =============================================================================

interface StudentOption {
  id: number;
  name: string;
  student_code: string;
  grade?: string | null;
}

/** Shared initial-row shape for the edit modal (accepts both snake + camel fields). */
export type AssignmentEditInitial = AssignmentRow;

export function AssignmentEditModal({
  open,
  mode,
  initial,
  currentUserId,
  currentUserRole,
  onClose,
  onCreated,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  initial: AssignmentEditInitial | null;
  currentUserId: number;
  currentUserRole: string;
  onClose: () => void;
  onCreated?: (id: number) => void;
}) {
  const api = getApi()!;
  const isEditing = mode === 'edit' && !!initial;

  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [publisher, setPublisher] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [studentId, setStudentId] = useState<number | ''>('');
  const [scope, setScope] = useState('');
  const [lengthReq, setLengthReq] = useState('');
  const [outline, setOutline] = useState('');
  const [rubric, setRubric] = useState('');
  const [teacherReq, setTeacherReq] = useState('');
  const [studentReq, setStudentReq] = useState('');
  const [state, setState] = useState<AssignmentState>('신규접수');
  const [risk, setRisk] = useState<Risk>('medium');
  const [parserId, setParserId] = useState<number | ''>('');
  const [qa1Id, setQa1Id] = useState<number | ''>('');
  const [qaFinalId, setQaFinalId] = useState<number | ''>('');
  const [dueAt, setDueAt] = useState('');
  const [touched, setTouched] = useState(false);

  const usersQuery = useQuery({
    queryKey: ['users.list'],
    queryFn: () => api.users.list() as unknown as Promise<UserOption[]>,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const studentsQuery = useQuery({
    queryKey: ['students.list', 'modal', currentUserId, currentUserRole],
    queryFn: () => api.students.list({ limit: 500 }) as unknown as Promise<StudentOption[]>,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!open) return;
    if (isEditing && initial) {
      setSubject(initial.subject ?? '');
      setTitle(rowTitle(initial) === '-' ? '' : rowTitle(initial));
      setPublisher(initial.publisher ?? '');
      setStudentCode(rowStudent(initial) === '-' ? '' : rowStudent(initial));
      setStudentId('');
      setScope(rowScope(initial) ?? '');
      setLengthReq(
        (pick<string>(initial, 'lengthRequirement', 'length_requirement') as string) ?? '',
      );
      setOutline(initial.outline ?? '');
      setRubric(initial.rubric ?? '');
      setTeacherReq(
        (pick<string>(initial, 'teacherRequirements', 'teacher_requirements') as string) ?? '',
      );
      setStudentReq(
        (pick<string>(initial, 'studentRequests', 'student_requests') as string) ?? '',
      );
      setState(initial.state);
      setRisk(initial.risk);
      setParserId(
        (pick<number>(initial, 'parserId', 'parser_id') as number | undefined) ?? '',
      );
      setQa1Id((pick<number>(initial, 'qa1Id', 'qa1_id') as number | undefined) ?? '');
      setQaFinalId(
        (pick<number>(initial, 'qaFinalId', 'qa_final_id') as number | undefined) ?? '',
      );
      const due = rowDue(initial);
      setDueAt(due ? due.slice(0, 10) : '');
    } else {
      setSubject('');
      setTitle('');
      setPublisher('');
      setStudentCode('');
      setStudentId('');
      setScope('');
      setLengthReq('');
      setOutline('');
      setRubric('');
      setTeacherReq('');
      setStudentReq('');
      setState('신규접수');
      setRisk('medium');
      setParserId('');
      setQa1Id('');
      setQaFinalId('');
      setDueAt('');
    }
    setTouched(false);
  }, [open, isEditing, initial]);

  const subjectErr = touched && !subject.trim() ? '과목은 필수입니다' : null;
  const titleErr = touched && !title.trim() ? '제목은 필수입니다' : null;

  const createMut = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.assignments.create>[0]) =>
      api.assignments.create(payload),
    successMessage: '과제를 추가했습니다',
    errorMessage: '과제 추가에 실패했습니다',
    invalidates: [
      ['assignments.list'],
      ['home.stats'],
      ['board.list'],
      ['board.summary'],
    ],
    onSuccess: (res) => {
      if (res?.ok && typeof res.id === 'number' && onCreated) {
        onCreated(res.id);
      }
      onClose();
    },
  });

  const updateMut = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.assignments.update>[0]) =>
      api.assignments.update(payload),
    successMessage: '과제 정보를 수정했습니다',
    errorMessage: '과제 수정에 실패했습니다',
    invalidates: [
      ['assignments.list'],
      ['assignments.reviews', initial?.id],
      ['home.stats'],
      ['board.list'],
    ],
    onSuccess: () => onClose(),
  });

  function numOrUndef(v: number | ''): number | undefined {
    return v === '' ? undefined : v;
  }

  function submit() {
    setTouched(true);
    if (!subject.trim() || !title.trim()) return;

    const dueIso = dueAt.trim() ? new Date(`${dueAt}T23:59:59`).toISOString() : null;

    if (isEditing && initial) {
      updateMut.mutate({
        id: initial.id,
        actorId: currentUserId,
        subject: subject.trim(),
        title: title.trim(),
        publisher: publisher.trim() || null,
        studentId: studentId === '' ? null : studentId,
        studentCode: studentCode.trim() || null,
        scope: scope.trim() || null,
        lengthReq: lengthReq.trim() || null,
        outline: outline.trim() || null,
        rubric: rubric.trim() || null,
        teacherReq: teacherReq.trim() || null,
        studentReq: studentReq.trim() || null,
        state,
        risk,
        parserId: parserId === '' ? null : parserId,
        qa1Id: qa1Id === '' ? null : qa1Id,
        qaFinalId: qaFinalId === '' ? null : qaFinalId,
        dueAt: dueIso,
      });
    } else {
      createMut.mutate({
        actorId: currentUserId,
        subject: subject.trim(),
        title: title.trim(),
        studentId: studentId === '' ? null : studentId,
        studentCode: studentCode.trim() || null,
        publisher: publisher.trim() || null,
        scope: scope.trim() || null,
        lengthReq: lengthReq.trim() || null,
        outline: outline.trim() || null,
        rubric: rubric.trim() || null,
        teacherReq: teacherReq.trim() || null,
        studentReq: studentReq.trim() || null,
        state,
        risk,
        parserId: numOrUndef(parserId) ?? null,
        qa1Id: numOrUndef(qa1Id) ?? null,
        qaFinalId: numOrUndef(qaFinalId) ?? null,
        dueAt: dueIso,
      });
    }
  }

  const saving = createMut.isPending || updateMut.isPending;
  const users = usersQuery.data ?? [];
  const students = studentsQuery.data ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEditing ? '과제 수정' : '새 과제 추가'}
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
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="과목" required error={subjectErr}>
          {(slot) => (
            <TextInput
              {...slot}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="예: 국어"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="출판사">
          {(slot) => (
            <TextInput
              {...slot}
              value={publisher}
              onChange={(e) => setPublisher(e.target.value)}
              placeholder="예: 천재교육"
              maxLength={80}
            />
          )}
        </FormField>
        <FormField label="수행평가명" required error={titleErr} className="md:col-span-2">
          {(slot) => (
            <TextInput
              {...slot}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 1학기 중간 수행평가 - 독후감"
              maxLength={200}
            />
          )}
        </FormField>
        <FormField label="학생 (DB)">
          {(slot) => (
            <SelectInput
              {...slot}
              value={studentId === '' ? '' : studentId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') {
                  setStudentId('');
                } else {
                  const id = Number(v);
                  setStudentId(id);
                  const s = students.find((x) => x.id === id);
                  if (s) setStudentCode(s.student_code);
                }
              }}
            >
              <option value="">직접 코드 입력</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.student_code}
                  {s.grade ? ` · ${s.grade}` : ''}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
        <FormField label="학생 코드 (수동)">
          {(slot) => (
            <TextInput
              {...slot}
              value={studentCode}
              onChange={(e) => setStudentCode(e.target.value)}
              placeholder="예: M-2510091530-ABCD"
              maxLength={60}
            />
          )}
        </FormField>
        <FormField label="수행 범위" className="md:col-span-2">
          {(slot) => (
            <TextInput
              {...slot}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="예: 1단원 ~ 3단원"
              maxLength={200}
            />
          )}
        </FormField>
        <FormField label="분량 요구">
          {(slot) => (
            <TextInput
              {...slot}
              value={lengthReq}
              onChange={(e) => setLengthReq(e.target.value)}
              placeholder="예: A4 2매 / 1500자"
              maxLength={80}
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
        <FormField label="개요" className="md:col-span-2">
          {(slot) => (
            <Textarea
              {...slot}
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              rows={2}
              placeholder="과제 개요 / 주제"
            />
          )}
        </FormField>
        <FormField label="평가 기준" className="md:col-span-2">
          {(slot) => (
            <Textarea
              {...slot}
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              rows={2}
              placeholder="루브릭 / 채점 기준"
            />
          )}
        </FormField>
        <FormField label="교사 요구">
          {(slot) => (
            <Textarea
              {...slot}
              value={teacherReq}
              onChange={(e) => setTeacherReq(e.target.value)}
              rows={2}
              placeholder="예: 근거 3가지 이상"
            />
          )}
        </FormField>
        <FormField label="학생 요구">
          {(slot) => (
            <Textarea
              {...slot}
              value={studentReq}
              onChange={(e) => setStudentReq(e.target.value)}
              rows={2}
              placeholder="학생이 요청한 사항"
            />
          )}
        </FormField>
        <FormField label="상태">
          {(slot) => (
            <SelectInput
              {...slot}
              value={state}
              onChange={(e) => setState(e.target.value as AssignmentState)}
            >
              {ASSIGNMENT_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
        <FormField label="위험도">
          {(slot) => (
            <SelectInput
              {...slot}
              value={risk}
              onChange={(e) => setRisk(e.target.value as Risk)}
            >
              <option value="low">낮음</option>
              <option value="medium">보통</option>
              <option value="high">높음</option>
            </SelectInput>
          )}
        </FormField>
        <FormField label="파싱 담당">
          {(slot) => (
            <SelectInput
              {...slot}
              value={parserId === '' ? '' : parserId}
              onChange={(e) =>
                setParserId(e.target.value === '' ? '' : Number(e.target.value))
              }
            >
              <option value="">미배정</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
        <FormField label="1차 QA">
          {(slot) => (
            <SelectInput
              {...slot}
              value={qa1Id === '' ? '' : qa1Id}
              onChange={(e) =>
                setQa1Id(e.target.value === '' ? '' : Number(e.target.value))
              }
            >
              <option value="">미배정</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
        <FormField label="최종 QA" className="md:col-span-2">
          {(slot) => (
            <SelectInput
              {...slot}
              value={qaFinalId === '' ? '' : qaFinalId}
              onChange={(e) =>
                setQaFinalId(e.target.value === '' ? '' : Number(e.target.value))
              }
            >
              <option value="">미배정</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
      </div>
    </Modal>
  );
}

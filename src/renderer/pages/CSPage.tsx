import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Headphones,
  Mail,
  MessageCircle,
  Phone,
  AlertTriangle,
  Plus,
  Check,
  Inbox,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { fmtDateTime, relative } from '@/lib/date';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import { firstError, maxLength, required } from '@/lib/validators';

type Priority = 'low' | 'normal' | 'high' | 'urgent';
type Status = 'open' | 'in_progress' | 'waiting' | 'resolved' | 'closed';
type Channel = 'phone' | 'email' | 'kakao' | 'other';

interface TicketRow {
  id: number;
  code: string;
  channel: Channel;
  student_code: string | null;
  inquirer: string | null;
  subject: string;
  body: string | null;
  priority: Priority;
  status: Status;
  assignee_id: number | null;
  assignee_name: string | null;
  opened_at: string;
  resolved_at: string | null;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  phone: '전화',
  email: '이메일',
  kakao: '카카오',
  other: '기타',
};
const PRIO_LABEL: Record<Priority, string> = {
  urgent: '긴급',
  high: '높음',
  normal: '보통',
  low: '낮음',
};
const STATUS_LABEL: Record<Status, string> = {
  open: '접수',
  in_progress: '처리중',
  waiting: '대기',
  resolved: '해결',
  closed: '종료',
};

const SUBJECT_MAX = 120;
const BODY_MAX = 2000;
const INQUIRER_MAX = 40;
const STUDENT_CODE_MAX = 20;

function prioChip(p: Priority): string {
  if (p === 'urgent') return 'bg-rose-500/15 text-rose-300 border border-rose-500/30';
  if (p === 'high') return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
  if (p === 'normal') return 'bg-bg-soft text-fg-muted border border-border';
  return 'bg-bg-soft text-fg-subtle border border-border';
}
function statusChip(s: Status): string {
  if (s === 'open') return 'bg-blue-500/15 text-blue-300 border border-blue-500/30';
  if (s === 'in_progress') return 'bg-violet-500/15 text-violet-300 border border-violet-500/30';
  if (s === 'waiting') return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
  if (s === 'resolved') return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
  return 'bg-bg-soft text-fg-subtle border border-border';
}
function channelIcon(c: Channel) {
  if (c === 'phone') return <Phone size={14} />;
  if (c === 'email') return <Mail size={14} />;
  if (c === 'kakao') return <MessageCircle size={14} />;
  return <Headphones size={14} />;
}

export function CSPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;

  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);

  const listQuery = useQuery({
    queryKey: ['cs.list', statusFilter],
    queryFn: async () => {
      const rows = await api!.cs.list(statusFilter ? { status: statusFilter } : undefined);
      return rows as unknown as TicketRow[];
    },
    enabled: live,
  });

  const statsQuery = useQuery({
    queryKey: ['cs.stats'],
    queryFn: () => api!.cs.stats(),
    enabled: live,
  });

  const selected = useMemo(
    () => listQuery.data?.find((t) => t.id === selectedId) ?? null,
    [listQuery.data, selectedId],
  );

  const updateMut = useMutationWithToast({
    mutationFn: (payload: { status?: Status; priority?: Priority }) =>
      api!.cs.update({ id: selectedId!, actorId: user!.id, ...payload }),
    successMessage: '티켓이 업데이트되었습니다',
    errorMessage: '티켓 업데이트에 실패했습니다',
    invalidates: [['cs.list'], ['cs.stats']],
  });

  const stats = statsQuery.data ?? { open: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0 };
  const rows = listQuery.data ?? [];

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-fg">
            <Headphones size={20} className="text-accent" />
            CS 관리
          </h1>
          <p className="mt-1 text-sm text-fg-muted">학부모/학생 문의 티켓 관리 — 채널·우선순위·상태별 추적</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>
          <Plus size={14} className="mr-1" />
          새 티켓
        </button>
      </header>

      <div className="grid grid-cols-5 gap-3">
        {(['open', 'in_progress', 'waiting', 'resolved', 'closed'] as Status[]).map((s) => {
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(active ? '' : s)}
              aria-pressed={active}
              className={cn(
                'card flex flex-col items-start gap-1 transition hover:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                active && 'border-accent',
              )}
            >
              <span className="text-xs text-fg-subtle">{STATUS_LABEL[s]}</span>
              <span className="text-2xl font-semibold text-fg">{stats[s] ?? 0}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        <section className="col-span-7 card flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-fg">티켓 목록</h2>
            {statusFilter && (
              <button
                onClick={() => setStatusFilter('')}
                className="text-xs text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                필터 초기화
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1 -mx-3 px-3">
            {listQuery.isLoading ? (
              <LoadingPanel label="티켓을 불러오는 중…" />
            ) : listQuery.isError ? (
              <EmptyState
                tone="error"
                icon={AlertTriangle}
                title="티켓을 불러오지 못했습니다"
                hint="네트워크 상태를 확인하거나 잠시 후 다시 시도해 주세요."
                action={
                  <button className="btn-outline" onClick={() => listQuery.refetch()}>
                    다시 시도
                  </button>
                }
              />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title={statusFilter ? '조건에 맞는 티켓이 없습니다' : '아직 접수된 티켓이 없습니다'}
                hint={statusFilter ? '필터를 초기화해 전체 목록을 확인해 보세요.' : '우측 상단 "새 티켓" 버튼으로 처음 티켓을 등록해 보세요.'}
                action={
                  statusFilter ? (
                    <button className="btn-outline" onClick={() => setStatusFilter('')}>
                      필터 초기화
                    </button>
                  ) : (
                    <button className="btn-primary" onClick={() => setShowNew(true)}>
                      <Plus size={14} className="mr-1" />
                      새 티켓
                    </button>
                  )
                }
              />
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-fg-subtle sticky top-0 bg-bg-soft">
                  <tr className="text-left">
                    <th className="py-2 pr-2">코드</th>
                    <th className="py-2 pr-2">채널</th>
                    <th className="py-2 pr-2">제목</th>
                    <th className="py-2 pr-2">우선순위</th>
                    <th className="py-2 pr-2">상태</th>
                    <th className="py-2 pr-2">담당</th>
                    <th className="py-2 pr-2">접수</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedId(t.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-pressed={selectedId === t.id}
                      className={cn(
                        'cursor-pointer border-t border-border hover:bg-bg-soft/50 focus:outline-none focus-visible:bg-bg-soft',
                        selectedId === t.id && 'bg-bg-soft',
                      )}
                    >
                      <td className="py-2 pr-2 font-mono text-xs text-fg-muted">{t.code}</td>
                      <td className="py-2 pr-2">
                        <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                          {channelIcon(t.channel)}
                          {CHANNEL_LABEL[t.channel]}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-fg">{t.subject}</td>
                      <td className="py-2 pr-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-xs', prioChip(t.priority))}>
                          {PRIO_LABEL[t.priority]}
                        </span>
                      </td>
                      <td className="py-2 pr-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-xs', statusChip(t.status))}>
                          {STATUS_LABEL[t.status]}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-xs text-fg-muted">{t.assignee_name ?? '-'}</td>
                      <td className="py-2 pr-2 text-xs text-fg-subtle">{relative(t.opened_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <aside className="col-span-5 card flex flex-col min-h-0 overflow-y-auto">
          {selected ? (
            <div className="flex flex-col gap-3 text-sm">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-fg-muted">{selected.code}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', prioChip(selected.priority))}>
                    {PRIO_LABEL[selected.priority]}
                  </span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', statusChip(selected.status))}>
                    {STATUS_LABEL[selected.status]}
                  </span>
                </div>
                <h3 className="mt-2 text-base font-semibold text-fg">{selected.subject}</h3>
                <p className="mt-1 text-xs text-fg-muted">
                  {CHANNEL_LABEL[selected.channel]} · {selected.inquirer ?? '이름 없음'}
                  {selected.student_code && ` · 학생 ${selected.student_code}`}
                </p>
              </div>
              {selected.body && (
                <div className="rounded border border-border bg-bg-soft/50 p-3 whitespace-pre-wrap text-fg">
                  {selected.body}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border border-border bg-bg-soft p-2">
                  <div className="text-fg-subtle">접수 시각</div>
                  <div className="mt-0.5 text-fg">{fmtDateTime(selected.opened_at)}</div>
                </div>
                <div className="rounded border border-border bg-bg-soft p-2">
                  <div className="text-fg-subtle">해결 시각</div>
                  <div className="mt-0.5 text-fg">
                    {selected.resolved_at ? fmtDateTime(selected.resolved_at) : '-'}
                  </div>
                </div>
              </div>

              <FormField label="상태 변경" hint="선택 즉시 저장됩니다">
                {(slot) => (
                  <SelectInput
                    {...slot}
                    value={selected.status}
                    onChange={(e) => updateMut.mutate({ status: e.target.value as Status })}
                    disabled={updateMut.isPending}
                  >
                    {(['open', 'in_progress', 'waiting', 'resolved', 'closed'] as Status[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </FormField>
              <FormField label="우선순위" hint="선택 즉시 저장됩니다">
                {(slot) => (
                  <SelectInput
                    {...slot}
                    value={selected.priority}
                    onChange={(e) => updateMut.mutate({ priority: e.target.value as Priority })}
                    disabled={updateMut.isPending}
                  >
                    {(['urgent', 'high', 'normal', 'low'] as Priority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIO_LABEL[p]}
                      </option>
                    ))}
                  </SelectInput>
                )}
              </FormField>
            </div>
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title="좌측 목록에서 티켓을 선택하세요"
              hint="선택한 티켓의 상세 정보와 상태 변경 옵션을 여기서 확인할 수 있습니다."
              className="flex-1 border-0 bg-transparent"
            />
          )}
        </aside>
      </div>

      <NewTicketModal
        open={showNew}
        onClose={() => setShowNew(false)}
      />
    </div>
  );
}

function NewTicketModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useSession();
  const api = getApi();
  const [channel, setChannel] = useState<Channel>('phone');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [inquirer, setInquirer] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [touched, setTouched] = useState<{ subject?: boolean; body?: boolean; inquirer?: boolean; studentCode?: boolean }>({});

  const subjectRules = firstError<string>([required('제목을 입력해 주세요'), maxLength(SUBJECT_MAX)]);
  const bodyRules = firstError<string>([maxLength(BODY_MAX)]);
  const inquirerRules = firstError<string>([maxLength(INQUIRER_MAX)]);
  const studentCodeRules = firstError<string>([maxLength(STUDENT_CODE_MAX)]);

  const subjectErr = subjectRules(subject);
  const bodyErr = bodyRules(body);
  const inquirerErr = inquirerRules(inquirer);
  const studentCodeErr = studentCodeRules(studentCode);

  const showSubjectErr = touched.subject ? subjectErr : null;
  const showBodyErr = touched.body ? bodyErr : null;
  const showInquirerErr = touched.inquirer ? inquirerErr : null;
  const showStudentCodeErr = touched.studentCode ? studentCodeErr : null;

  const resetForm = () => {
    setChannel('phone');
    setSubject('');
    setBody('');
    setPriority('normal');
    setInquirer('');
    setStudentCode('');
    setTouched({});
  };

  const createMut = useMutationWithToast({
    mutationFn: () =>
      api!.cs.create({
        actorId: user!.id,
        channel,
        subject: subject.trim(),
        body: body.trim() || undefined,
        priority,
        inquirer: inquirer.trim() || undefined,
        studentCode: studentCode.trim() || undefined,
      }),
    successMessage: 'CS 티켓이 생성되었습니다',
    errorMessage: 'CS 티켓 생성에 실패했습니다',
    invalidates: [['cs.list'], ['cs.stats']],
    onSuccess: (res) => {
      if (res.ok) {
        resetForm();
        onClose();
      }
    },
  });

  const invalid = !!(subjectErr || bodyErr || inquirerErr || studentCodeErr);

  const handleSubmit = () => {
    setTouched({ subject: true, body: true, inquirer: true, studentCode: true });
    if (invalid) return;
    createMut.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (createMut.isPending) return;
        resetForm();
        onClose();
      }}
      title="새 CS 티켓"
      size="md"
      closeOnEsc={!createMut.isPending}
      closeOnBackdrop={!createMut.isPending}
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              if (createMut.isPending) return;
              resetForm();
              onClose();
            }}
            disabled={createMut.isPending}
          >
            취소
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={createMut.isPending}
          >
            <Check size={14} className="mr-1" />
            생성
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="채널" required>
            {(slot) => (
              <SelectInput
                {...slot}
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
              >
                {(['phone', 'email', 'kakao', 'other'] as Channel[]).map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>
          <FormField label="우선순위" required>
            {(slot) => (
              <SelectInput
                {...slot}
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {(['urgent', 'high', 'normal', 'low'] as Priority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIO_LABEL[p]}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>
          <FormField
            label="문의자"
            error={showInquirerErr}
            hint="예: 김학부모"
            count={inquirer.length}
            max={INQUIRER_MAX}
          >
            {(slot) => (
              <TextInput
                {...slot}
                value={inquirer}
                onChange={(e) => setInquirer(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, inquirer: true }))}
                placeholder="예: 김학부모"
                maxLength={INQUIRER_MAX + 20}
              />
            )}
          </FormField>
          <FormField
            label="학생 코드"
            error={showStudentCodeErr}
            hint="예: S-0012"
            count={studentCode.length}
            max={STUDENT_CODE_MAX}
          >
            {(slot) => (
              <TextInput
                {...slot}
                value={studentCode}
                onChange={(e) => setStudentCode(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, studentCode: true }))}
                placeholder="예: S-0012"
                maxLength={STUDENT_CODE_MAX + 10}
              />
            )}
          </FormField>
        </div>
        <FormField
          label="제목"
          required
          error={showSubjectErr}
          count={subject.length}
          max={SUBJECT_MAX}
        >
          {(slot) => (
            <TextInput
              {...slot}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, subject: true }))}
              placeholder="문의 제목"
              maxLength={SUBJECT_MAX + 20}
            />
          )}
        </FormField>
        <FormField
          label="내용"
          error={showBodyErr}
          hint="문의 내용 상세 — 최대 2,000자"
          count={body.length}
          max={BODY_MAX}
        >
          {(slot) => (
            <Textarea
              {...slot}
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, body: true }))}
              placeholder="문의 내용 상세"
              maxLength={BODY_MAX + 200}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

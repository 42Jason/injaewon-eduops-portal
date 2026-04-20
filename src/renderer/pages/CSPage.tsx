import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Headphones,
  Mail,
  MessageCircle,
  Phone,
  AlertTriangle,
  Plus,
  Check,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { fmtDateTime, relative } from '@/lib/date';

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
  const qc = useQueryClient();

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

  const updateMut = useMutation({
    mutationFn: (payload: { status?: Status; priority?: Priority }) =>
      api!.cs.update({ id: selectedId!, actorId: user!.id, ...payload }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cs.list'] });
      qc.invalidateQueries({ queryKey: ['cs.stats'] });
    },
  });

  const stats = statsQuery.data ?? { open: 0, in_progress: 0, waiting: 0, resolved: 0, closed: 0 };

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
        {(['open', 'in_progress', 'waiting', 'resolved', 'closed'] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={cn(
              'card flex flex-col items-start gap-1 transition hover:border-accent',
              statusFilter === s && 'border-accent',
            )}
          >
            <span className="text-xs text-fg-subtle">{STATUS_LABEL[s]}</span>
            <span className="text-2xl font-semibold text-fg">{stats[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-4 flex-1 min-h-0">
        <section className="col-span-7 card flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-fg">티켓 목록</h2>
            {statusFilter && (
              <button
                onClick={() => setStatusFilter('')}
                className="text-xs text-fg-muted hover:text-fg"
              >
                필터 초기화
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1 -mx-3 px-3">
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
                {listQuery.data?.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={cn(
                      'cursor-pointer border-t border-border hover:bg-bg-soft/50',
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
                {!listQuery.data?.length && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-fg-subtle">
                      티켓이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
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

              <div>
                <label className="text-xs text-fg-subtle">상태 변경</label>
                <select
                  className="input mt-1"
                  value={selected.status}
                  onChange={(e) => updateMut.mutate({ status: e.target.value as Status })}
                  disabled={updateMut.isPending}
                >
                  {(['open', 'in_progress', 'waiting', 'resolved', 'closed'] as Status[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-fg-subtle">우선순위</label>
                <select
                  className="input mt-1"
                  value={selected.priority}
                  onChange={(e) => updateMut.mutate({ priority: e.target.value as Priority })}
                  disabled={updateMut.isPending}
                >
                  {(['urgent', 'high', 'normal', 'low'] as Priority[]).map((p) => (
                    <option key={p} value={p}>
                      {PRIO_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-fg-subtle text-sm">
              <AlertTriangle size={24} className="mb-2" />
              좌측 목록에서 티켓을 선택하세요
            </div>
          )}
        </aside>
      </div>

      {showNew && (
        <NewTicketModal onClose={() => setShowNew(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['cs.list'] })} />
      )}
    </div>
  );
}

function NewTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { user } = useSession();
  const api = getApi();
  const [channel, setChannel] = useState<Channel>('phone');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [inquirer, setInquirer] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      api!.cs.create({
        actorId: user!.id,
        channel,
        subject,
        body: body || undefined,
        priority,
        inquirer: inquirer || undefined,
        studentCode: studentCode || undefined,
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        setErr(res.error ?? '생성 실패');
        return;
      }
      onCreated();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="card w-[540px] max-w-[90vw] flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-fg">새 CS 티켓</h3>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-fg-subtle">
            채널
            <select
              className="input mt-1"
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
            >
              {(['phone', 'email', 'kakao', 'other'] as Channel[]).map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-fg-subtle">
            우선순위
            <select
              className="input mt-1"
              value={priority}
              onChange={(e) => setPriority(e.target.value as Priority)}
            >
              {(['urgent', 'high', 'normal', 'low'] as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {PRIO_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-fg-subtle">
            문의자
            <input
              className="input mt-1"
              value={inquirer}
              onChange={(e) => setInquirer(e.target.value)}
              placeholder="예: 김학부모"
            />
          </label>
          <label className="text-xs text-fg-subtle">
            학생 코드
            <input
              className="input mt-1"
              value={studentCode}
              onChange={(e) => setStudentCode(e.target.value)}
              placeholder="예: S-0012"
            />
          </label>
        </div>
        <label className="text-xs text-fg-subtle">
          제목
          <input
            className="input mt-1"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="문의 제목"
          />
        </label>
        <label className="text-xs text-fg-subtle">
          내용
          <textarea
            className="input mt-1"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="문의 내용 상세"
          />
        </label>

        {err && <p className="text-xs text-danger">{err}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <button className="btn-ghost" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              if (!subject.trim()) {
                setErr('제목을 입력하세요');
                return;
              }
              setErr(null);
              createMut.mutate();
            }}
            disabled={createMut.isPending}
          >
            <Check size={14} className="mr-1" />
            생성
          </button>
        </div>
      </div>
    </div>
  );
}

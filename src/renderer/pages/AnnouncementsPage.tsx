import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Megaphone, Plus, Pin, Archive, Save, User as UserIcon,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  FormField,
  SelectInput,
  Textarea,
  TextInput,
} from '@/components/ui/FormField';
import { firstError, maxLength, required } from '@/lib/validators';
import { renderMarkdown } from '@/lib/markdown';
import { fmtDateTime, relative } from '@/lib/date';
import { cn } from '@/lib/cn';

interface NoticeRow {
  id: number;
  title: string;
  body_md?: string;
  audience?: string | null;
  pinned?: number;
  author_name?: string | null;
  created_at: string;
  updated_at?: string;
  archived_at?: string | null;
}

const AUDIENCES = [
  { value: 'ALL', label: '전체' },
  { value: 'LEADERSHIP', label: '경영진' },
  { value: 'OPS', label: '운영팀' },
  { value: 'QA', label: 'QA팀' },
  { value: 'PARSERS', label: '파싱팀' },
  { value: 'CS', label: 'CS팀' },
];

export function AnnouncementsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();
  const confirm = useConfirm();

  const canPublish = !!user?.perms.isLeadership || user?.role === 'HR_ADMIN';

  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<NoticeRow | null>(null);

  const listQuery = useQuery({
    queryKey: ['notices.list'],
    queryFn: () => api!.notices.list() as unknown as Promise<NoticeRow[]>,
    enabled: live,
  });

  const rows = listQuery.data ?? [];
  const pinned = rows.filter((r) => r.pinned);
  const normal = rows.filter((r) => !r.pinned);

  const archiveMut = useMutationWithToast({
    mutationFn: (id: number) => {
      if (!api || !user) return Promise.resolve({ ok: false });
      return api.noticesAdmin.archive({ id, actorId: user.id });
    },
    successMessage: '공지가 보관되었습니다',
    errorMessage: '보관에 실패했습니다',
    invalidates: [['notices.list']],
    onSuccess: () => setSelected(null),
  });

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 공지사항을 확인할 수 있습니다.
        </div>
      </div>
    );
  }

  async function onArchive() {
    if (!selected) return;
    const ok = await confirm({
      title: '이 공지를 보관하시겠습니까?',
      description: selected.title,
      confirmLabel: '보관',
      tone: 'warn',
    });
    if (ok) archiveMut.mutate(selected.id);
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <Megaphone size={20} /> 공지사항
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            사내 공지 · 중요 안내. 상단 고정은 핀 아이콘으로 표시됩니다.
          </p>
        </div>
        {canPublish && (
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Plus size={14} /> 새 공지
          </button>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-5 space-y-2">
          {listQuery.isLoading && <LoadingPanel label="공지 불러오는 중…" />}
          {listQuery.isError && (
            <EmptyState
              tone="error"
              title="공지를 불러오지 못했습니다"
              hint={
                listQuery.error instanceof Error
                  ? listQuery.error.message
                  : '네트워크 상태를 확인하고 다시 시도해 주세요.'
              }
              action={
                <button
                  type="button"
                  onClick={() => listQuery.refetch()}
                  className="btn-outline text-xs"
                >
                  다시 시도
                </button>
              }
            />
          )}
          {!listQuery.isLoading && !listQuery.isError && pinned.length > 0 && (
            <div>
              <div className="text-xs text-fg-subtle mb-1 flex items-center gap-1">
                <Pin size={11} /> 고정
              </div>
              <div className="space-y-1.5">
                {pinned.map((r) => (
                  <NoticeListItem
                    key={r.id}
                    r={r}
                    active={selected?.id === r.id}
                    onClick={() => setSelected(r)}
                  />
                ))}
              </div>
            </div>
          )}
          {!listQuery.isLoading && !listQuery.isError && (
            <div>
              <div className="text-xs text-fg-subtle mb-1">최신</div>
              <div className="space-y-1.5">
                {normal.length === 0 && pinned.length === 0 ? (
                  <EmptyState
                    title="게시된 공지가 없습니다"
                    hint={
                      canPublish
                        ? '상단의 "새 공지" 버튼으로 첫 공지를 등록해 보세요.'
                        : '공지가 등록되면 이곳에 표시됩니다.'
                    }
                  />
                ) : normal.length === 0 ? (
                  <div className="card text-sm text-fg-subtle">최신 공지가 없습니다.</div>
                ) : (
                  normal.map((r) => (
                    <NoticeListItem
                      key={r.id}
                      r={r}
                      active={selected?.id === r.id}
                      onClick={() => setSelected(r)}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-7">
          {!selected && !listQuery.isLoading && !listQuery.isError && rows.length > 0 && (
            <div className="card text-sm text-fg-muted">좌측에서 공지를 선택하세요.</div>
          )}
          {selected && (
            <div className="card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs text-fg-subtle">
                    {selected.pinned ? (
                      <span className="flex items-center gap-1 text-amber-300">
                        <Pin size={11} /> 고정
                      </span>
                    ) : null}
                    <span>{audienceLabel(selected.audience)}</span>
                    <span>·</span>
                    <span>{relative(selected.created_at)}</span>
                  </div>
                  <h2 className="text-xl font-semibold mt-1">{selected.title}</h2>
                  <div className="text-xs text-fg-subtle mt-1 flex items-center gap-1">
                    <UserIcon size={11} /> {selected.author_name ?? '-'} · {fmtDateTime(selected.created_at)}
                  </div>
                </div>
                {canPublish && (
                  <button
                    type="button"
                    onClick={onArchive}
                    disabled={archiveMut.isPending}
                    className="btn-outline text-xs flex items-center gap-1"
                    aria-label="이 공지 보관"
                  >
                    <Archive size={12} /> {archiveMut.isPending ? '보관 중…' : '보관'}
                  </button>
                )}
              </div>
              <div>{renderMarkdown(selected.body_md ?? '')}</div>
            </div>
          )}
        </div>
      </div>

      <NewNoticeModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={() => {
          setNewOpen(false);
          qc.invalidateQueries({ queryKey: ['notices.list'] });
        }}
      />
    </div>
  );
}

function audienceLabel(val?: string | null): string {
  if (!val) return '전체';
  const m = AUDIENCES.find((a) => a.value === val);
  return m?.label ?? val;
}

function NoticeListItem({
  r,
  active,
  onClick,
}: {
  r: NoticeRow;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left card py-2 px-3 hover:border-fg-subtle transition',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active && 'ring-1 ring-accent border-accent/60',
      )}
      aria-pressed={active}
    >
      <div className="flex items-center gap-1.5">
        {r.pinned ? <Pin size={11} className="text-amber-300" /> : null}
        <span className="text-sm text-fg line-clamp-1 flex-1">{r.title}</span>
        <span className="text-[10px] text-fg-subtle">{relative(r.created_at)}</span>
      </div>
      <div className="text-[11px] text-fg-subtle mt-0.5">
        {audienceLabel(r.audience)} · {r.author_name ?? '-'}
      </div>
    </button>
  );
}

const TITLE_MAX = 120;
const BODY_MAX = 5000;

const titleRules = firstError<string>([
  required('제목을 입력해 주세요'),
  maxLength(TITLE_MAX, `최대 ${TITLE_MAX}자까지 입력할 수 있습니다`),
]);
const bodyRules = firstError<string>([
  required('내용을 입력해 주세요'),
  maxLength(BODY_MAX, `최대 ${BODY_MAX}자까지 입력할 수 있습니다`),
]);

function NewNoticeModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user } = useSession();
  const api = getApi();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('ALL');
  const [pinned, setPinned] = useState(false);
  const [touched, setTouched] = useState<{ title?: boolean; body?: boolean }>({});

  const titleErr = titleRules(title);
  const bodyErr = bodyRules(body);
  const showTitleErr = touched.title ? titleErr : null;
  const showBodyErr = touched.body ? bodyErr : null;

  const mut = useMutationWithToast({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      const res = await api.noticesAdmin.create({
        authorId: user.id,
        title: title.trim(),
        bodyMd: body,
        audience,
        pinned,
      });
      return res;
    },
    successMessage: '공지가 게시되었습니다',
    errorMessage: '공지 게시에 실패했습니다',
    invalidates: [['notices.list']],
    onSuccess: () => {
      // Reset local state then notify parent.
      setTitle('');
      setBody('');
      setAudience('ALL');
      setPinned(false);
      setTouched({});
      onCreated();
    },
  });

  function handleSubmit() {
    setTouched({ title: true, body: true });
    if (titleErr || bodyErr) return;
    mut.mutate();
  }

  function handleClose() {
    if (mut.isPending) return;
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="새 공지"
      size="lg"
      closeOnBackdrop={!mut.isPending}
      closeOnEsc={!mut.isPending}
      footer={
        <>
          <button
            type="button"
            onClick={handleClose}
            disabled={mut.isPending}
            className="btn-ghost text-sm"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={mut.isPending || !!titleErr || !!bodyErr}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Save size={13} /> {mut.isPending ? '게시 중…' : '게시'}
          </button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="space-y-3"
      >
        <FormField
          label="제목"
          required
          error={showTitleErr}
          hint="동료들이 알림 목록에서 한눈에 알아볼 수 있도록 간결하게."
          count={title.length}
          max={TITLE_MAX}
        >
          {(slot) => (
            <TextInput
              {...slot}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              placeholder="공지 제목"
              maxLength={TITLE_MAX}
              autoFocus
            />
          )}
        </FormField>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="대상">
            {(slot) => (
              <SelectInput
                {...slot}
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              >
                {AUDIENCES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>
          <label className="flex items-end gap-2 pb-5 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <Pin size={12} /> 상단 고정
          </label>
        </div>

        <FormField
          label="내용 (Markdown)"
          required
          error={showBodyErr}
          count={body.length}
          max={BODY_MAX}
        >
          {(slot) => (
            <Textarea
              {...slot}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, body: true }))}
              rows={10}
              placeholder="내용을 입력하세요. Markdown 문법을 사용할 수 있습니다."
              className="font-mono"
            />
          )}
        </FormField>

        {/* Hidden submit button so Enter inside the form submits. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

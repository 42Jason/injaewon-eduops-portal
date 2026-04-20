import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Megaphone, Plus, Pin, Archive, X, Save, User as UserIcon,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
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

  const canPublish = !!user?.perms.isLeadership || user?.role === 'HR_ADMIN';

  const [newOpen, setNewOpen] = useState(false);
  const [selected, setSelected] = useState<NoticeRow | null>(null);

  const listQuery = useQuery({
    queryKey: ['notices.list'],
    queryFn: () => api!.notices.list() as Promise<NoticeRow[]>,
    enabled: live,
  });

  const rows = listQuery.data ?? [];
  const pinned = rows.filter((r) => r.pinned);
  const normal = rows.filter((r) => !r.pinned);

  const archiveMut = useMutation({
    mutationFn: (id: number) => {
      if (!api || !user) return Promise.resolve({ ok: false });
      return api.noticesAdmin.archive({ id, actorId: user.id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notices.list'] });
      setSelected(null);
    },
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
          {pinned.length > 0 && (
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
          <div>
            <div className="text-xs text-fg-subtle mb-1">최신</div>
            <div className="space-y-1.5">
              {normal.length === 0 && (
                <div className="card text-sm text-fg-subtle">공지가 없습니다.</div>
              )}
              {normal.map((r) => (
                <NoticeListItem
                  key={r.id}
                  r={r}
                  active={selected?.id === r.id}
                  onClick={() => setSelected(r)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-7">
          {!selected && (
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
                    onClick={() => {
                      if (confirm('이 공지를 보관하시겠습니까?')) {
                        archiveMut.mutate(selected.id);
                      }
                    }}
                    className="btn-outline text-xs flex items-center gap-1"
                  >
                    <Archive size={12} /> 보관
                  </button>
                )}
              </div>
              <div>{renderMarkdown(selected.body_md ?? '')}</div>
            </div>
          )}
        </div>
      </div>

      {newOpen && (
        <NewNoticeModal
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            setNewOpen(false);
            qc.invalidateQueries({ queryKey: ['notices.list'] });
          }}
        />
      )}
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
        active && 'ring-1 ring-accent border-accent/60',
      )}
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

function NewNoticeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user } = useSession();
  const api = getApi();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('ALL');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      if (!title.trim()) throw new Error('제목 필수');
      const res = await api.noticesAdmin.create({
        authorId: user.id,
        title: title.trim(),
        bodyMd: body,
        audience,
        pinned,
      });
      if (!res.ok) throw new Error(res.error ?? '생성 실패');
      return res;
    },
    onSuccess: onCreated,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg border border-border rounded-lg shadow-xl max-w-2xl w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">새 공지</h2>
          <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg">
            <X size={18} />
          </button>
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목"
          className="input text-sm w-full"
        />
        <div className="flex items-center gap-2">
          <select
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            className="input text-sm w-40"
          >
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <label className="text-sm text-fg-muted flex items-center gap-1.5">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <Pin size={12} /> 상단 고정
          </label>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={10}
          placeholder="내용 (Markdown)"
          className="input text-sm font-mono w-full"
        />
        {error && (
          <div className="text-xs text-rose-300 border border-rose-500/40 bg-rose-500/10 rounded px-2 py-1">
            {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost text-sm">
            취소
          </button>
          <button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Save size={13} /> 게시
          </button>
        </div>
      </div>
    </div>
  );
}

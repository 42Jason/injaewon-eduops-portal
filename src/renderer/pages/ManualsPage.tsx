import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, FileText, Plus, Edit3, Save, X, Trash2, Search, FolderOpen,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { renderMarkdown } from '@/lib/markdown';
import { fmtDateTime, relative } from '@/lib/date';
import { cn } from '@/lib/cn';

interface ManualRow {
  id: number;
  slug: string;
  title: string;
  category?: string | null;
  body_md?: string;
  parent_id?: number | null;
  version?: number;
  updated_at?: string;
  author_name?: string | null;
}

export function ManualsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();

  const canEdit = !!user?.perms.isLeadership;

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['manuals.list'],
    queryFn: () => api!.manuals.list() as Promise<ManualRow[]>,
    enabled: live,
  });

  const manuals = listQuery.data ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return manuals;
    const q = search.trim().toLowerCase();
    return manuals.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.slug.toLowerCase().includes(q) ||
        (m.category ?? '').toLowerCase().includes(q),
    );
  }, [manuals, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, ManualRow[]>();
    for (const p of filtered) {
      const cat = p.category ?? '기타';
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(p);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Default select first manual when list loads.
  useEffect(() => {
    if (!selectedSlug && manuals.length) {
      setSelectedSlug(manuals[0].slug);
    }
  }, [manuals, selectedSlug]);

  const detailQuery = useQuery({
    queryKey: ['manuals.get', selectedSlug],
    queryFn: () => api!.manuals.get(selectedSlug!) as Promise<ManualRow | null>,
    enabled: live && !!selectedSlug,
  });

  const manual = detailQuery.data ?? null;

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 매뉴얼을 확인할 수 있습니다.
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
            <BookOpen size={20} /> 매뉴얼 위키
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            사내 SOP · 체크리스트 · 온보딩 문서. {canEdit ? '경영진/운영 리더는 편집 가능합니다.' : '읽기 전용.'}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Plus size={14} /> 새 문서
          </button>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left tree */}
        <div className="col-span-12 lg:col-span-3 card p-0 overflow-hidden">
          <div className="p-2 border-b border-border bg-bg-soft/40">
            <div className="flex items-center gap-1.5">
              <Search size={13} className="text-fg-subtle" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="검색"
                className="input text-xs py-1 flex-1"
              />
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {grouped.length === 0 && (
              <div className="p-4 text-center text-xs text-fg-subtle">문서 없음</div>
            )}
            {grouped.map(([cat, pages]) => (
              <div key={cat}>
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-fg-subtle bg-bg-soft/30 flex items-center gap-1">
                  <FolderOpen size={11} /> {cat}
                </div>
                <div>
                  {pages.map((p) => {
                    const active = p.slug === selectedSlug;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setSelectedSlug(p.slug);
                          setEditing(false);
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition',
                          active
                            ? 'bg-accent/15 text-accent'
                            : 'text-fg-muted hover:bg-bg-soft/40',
                        )}
                      >
                        <FileText size={13} />
                        <span className="truncate">{p.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="col-span-12 lg:col-span-9">
          {!manual && (
            <div className="card text-sm text-fg-muted">좌측에서 문서를 선택하세요.</div>
          )}
          {manual && !editing && (
            <ManualViewer
              manual={manual}
              canEdit={canEdit}
              onEdit={() => setEditing(true)}
              onDelete={async () => {
                if (!confirm(`"${manual.title}" 을(를) 삭제하시겠습니까?`)) return;
                const res = await api!.manuals.delete({
                  id: manual.id,
                  actorId: user!.id,
                });
                if (res.ok) {
                  qc.invalidateQueries({ queryKey: ['manuals.list'] });
                  setSelectedSlug(null);
                }
              }}
            />
          )}
          {manual && editing && (
            <ManualEditor
              initial={manual}
              onCancel={() => setEditing(false)}
              onSaved={(slug) => {
                setEditing(false);
                setSelectedSlug(slug);
                qc.invalidateQueries({ queryKey: ['manuals.list'] });
                qc.invalidateQueries({ queryKey: ['manuals.get'] });
              }}
            />
          )}
        </div>
      </div>

      {newOpen && (
        <NewManualModal
          onClose={() => setNewOpen(false)}
          onCreated={(slug) => {
            setNewOpen(false);
            setSelectedSlug(slug);
            qc.invalidateQueries({ queryKey: ['manuals.list'] });
          }}
        />
      )}
    </div>
  );
}

function ManualViewer({
  manual,
  canEdit,
  onEdit,
  onDelete,
}: {
  manual: ManualRow;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-xs text-fg-subtle">
            <span className="font-mono">{manual.slug}</span>
            {manual.category && (
              <>
                <span>·</span>
                <span>{manual.category}</span>
              </>
            )}
            {manual.version != null && (
              <>
                <span>·</span>
                <span>v{manual.version}</span>
              </>
            )}
          </div>
          <h2 className="text-2xl font-semibold mt-1 text-fg">{manual.title}</h2>
          <div className="text-xs text-fg-subtle mt-1">
            {manual.author_name ?? '-'} 작성
            {manual.updated_at && ` · ${relative(manual.updated_at)} 수정 · ${fmtDateTime(manual.updated_at)}`}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="btn-outline text-sm flex items-center gap-1.5"
            >
              <Edit3 size={13} /> 편집
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="btn-outline text-sm border-rose-500/40 text-rose-300 flex items-center gap-1.5"
            >
              <Trash2 size={13} /> 삭제
            </button>
          </div>
        )}
      </div>

      <div className="prose-manual">
        {renderMarkdown(manual.body_md ?? '')}
      </div>
    </div>
  );
}

function ManualEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial: ManualRow;
  onCancel: () => void;
  onSaved: (slug: string) => void;
}) {
  const { user } = useSession();
  const api = getApi();
  const [title, setTitle] = useState(initial.title);
  const [category, setCategory] = useState(initial.category ?? '');
  const [body, setBody] = useState(initial.body_md ?? '');
  const [slug, setSlug] = useState(initial.slug);
  const [error, setError] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      if (!title.trim()) throw new Error('제목 필수');
      const res = await api.manuals.save({
        id: initial.id,
        slug: slug.trim() || initial.slug,
        title: title.trim(),
        bodyMd: body,
        category: category.trim() || undefined,
        authorId: user.id,
      });
      if (!res.ok) throw new Error(res.error ?? '저장 실패');
      return res;
    },
    onSuccess: () => onSaved(slug.trim() || initial.slug),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="card space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          className="input text-sm"
          placeholder="제목"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="input text-sm font-mono"
          placeholder="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
        />
        <input
          className="input text-sm"
          placeholder="카테고리"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={20}
          className="input text-xs font-mono leading-relaxed w-full"
          placeholder="# Markdown"
        />
        <div className="border border-border rounded p-3 overflow-y-auto max-h-[60vh] bg-bg-soft/30">
          {renderMarkdown(body || '*미리보기*')}
        </div>
      </div>
      {error && (
        <div className="text-xs text-rose-300 border border-rose-500/40 bg-rose-500/10 rounded px-2 py-1">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saveMut.isPending}
          onClick={() => saveMut.mutate()}
          className="btn-primary text-sm flex items-center gap-1.5"
        >
          <Save size={13} /> 저장
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost text-sm flex items-center gap-1.5">
          <X size={13} /> 취소
        </button>
      </div>
    </div>
  );
}

function NewManualModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const { user } = useSession();
  const api = getApi();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('# 새 문서\n\n내용을 작성하세요.');
  const [error, setError] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      if (!title.trim()) throw new Error('제목 필수');
      if (!slug.trim()) throw new Error('slug 필수');
      const res = await api.manuals.save({
        slug: slug.trim(),
        title: title.trim(),
        bodyMd: body,
        category: category.trim() || undefined,
        authorId: user.id,
      });
      if (!res.ok) throw new Error(res.error ?? '생성 실패');
      return res;
    },
    onSuccess: () => onCreated(slug.trim()),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg border border-border rounded-lg shadow-xl max-w-2xl w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">새 매뉴얼 문서</h2>
          <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg">
            <X size={18} />
          </button>
        </div>
        <input
          className="input text-sm w-full"
          placeholder="제목"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            className="input text-sm font-mono"
            placeholder="slug (예: qa-checklist)"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
          />
          <input
            className="input text-sm"
            placeholder="카테고리"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
          className="input text-xs font-mono leading-relaxed w-full"
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
            disabled={saveMut.isPending}
            onClick={() => saveMut.mutate()}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Save size={13} /> 생성
          </button>
        </div>
      </div>
    </div>
  );
}

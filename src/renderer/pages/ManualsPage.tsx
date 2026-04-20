import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, FileText, Plus, Edit3, Save, X, Trash2, Search, FolderOpen,
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
  TextInput,
  Textarea,
} from '@/components/ui/FormField';
import { firstError, maxLength, pattern, required } from '@/lib/validators';
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

const TITLE_MAX = 120;
const CATEGORY_MAX = 40;
const BODY_MAX = 50000;
const SLUG_RE = /^[a-z0-9][a-z0-9\-]{1,60}$/;

const titleRules = firstError<string>([
  required('제목을 입력해 주세요'),
  maxLength(TITLE_MAX),
]);
const slugRules = firstError<string>([
  required('slug를 입력해 주세요'),
  pattern(SLUG_RE, 'slug는 영문 소문자/숫자/하이픈만 허용됩니다'),
]);
const categoryRules = firstError<string>([maxLength(CATEGORY_MAX)]);
const bodyRules = firstError<string>([maxLength(BODY_MAX)]);

export function ManualsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const confirm = useConfirm();

  const canEdit = !!user?.perms.isLeadership;

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['manuals.list'],
    queryFn: () => api!.manuals.list() as unknown as Promise<ManualRow[]>,
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

  const deleteMut = useMutationWithToast<
    { ok: boolean; error?: string },
    Error,
    number
  >({
    mutationFn: (id) => api!.manuals.delete({ id, actorId: user!.id }),
    successMessage: '문서가 삭제되었습니다',
    errorMessage: '삭제에 실패했습니다',
    invalidates: [['manuals.list']],
    onSuccess: (res) => {
      if (res.ok) setSelectedSlug(null);
    },
  });

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 매뉴얼을 확인할 수 있습니다.
        </div>
      </div>
    );
  }

  async function handleDelete() {
    if (!manual) return;
    const ok = await confirm({
      title: '이 문서를 삭제할까요?',
      description: manual.title,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (ok) deleteMut.mutate(manual.id);
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
            <label className="flex items-center gap-1.5">
              <Search size={13} className="text-fg-subtle" aria-hidden="true" />
              <span className="sr-only">매뉴얼 검색</span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="검색"
                className="input text-xs py-1 flex-1"
                aria-label="매뉴얼 검색"
              />
            </label>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {listQuery.isLoading ? (
              <LoadingPanel label="불러오는 중…" className="py-6" />
            ) : listQuery.isError ? (
              <EmptyState
                tone="error"
                title="불러오지 못했습니다"
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
            ) : grouped.length === 0 ? (
              <EmptyState
                title="문서 없음"
                hint={search ? '검색 조건에 맞는 문서가 없습니다.' : '첫 문서를 작성해 보세요.'}
              />
            ) : (
              grouped.map(([cat, pages]) => (
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
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            active
                              ? 'bg-accent/15 text-accent'
                              : 'text-fg-muted hover:bg-bg-soft/40',
                          )}
                          aria-pressed={active}
                        >
                          <FileText size={13} />
                          <span className="truncate">{p.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="col-span-12 lg:col-span-9">
          {detailQuery.isLoading && selectedSlug ? (
            <LoadingPanel label="문서 불러오는 중…" />
          ) : detailQuery.isError ? (
            <EmptyState
              tone="error"
              title="문서를 불러오지 못했습니다"
              action={
                <button
                  type="button"
                  onClick={() => detailQuery.refetch()}
                  className="btn-outline text-xs"
                >
                  다시 시도
                </button>
              }
            />
          ) : !manual ? (
            <EmptyState
              title="문서를 선택하세요"
              hint="좌측 목록에서 읽을 문서를 선택하거나 새 문서를 작성해 보세요."
            />
          ) : !editing ? (
            <ManualViewer
              manual={manual}
              canEdit={canEdit}
              deleting={deleteMut.isPending}
              onEdit={() => setEditing(true)}
              onDelete={handleDelete}
            />
          ) : (
            <ManualEditor
              initial={manual}
              onCancel={() => setEditing(false)}
              onSaved={(slug) => {
                setEditing(false);
                setSelectedSlug(slug);
              }}
            />
          )}
        </div>
      </div>

      <NewManualModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(slug) => {
          setNewOpen(false);
          setSelectedSlug(slug);
        }}
      />
    </div>
  );
}

function ManualViewer({
  manual,
  canEdit,
  deleting,
  onEdit,
  onDelete,
}: {
  manual: ManualRow;
  canEdit: boolean;
  deleting: boolean;
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
              aria-label="이 문서 편집"
            >
              <Edit3 size={13} /> 편집
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="btn-outline text-sm border-rose-500/40 text-rose-300 flex items-center gap-1.5 disabled:opacity-50"
              aria-label="이 문서 삭제"
            >
              <Trash2 size={13} /> {deleting ? '삭제 중…' : '삭제'}
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
  const [touched, setTouched] = useState<{ title?: boolean; slug?: boolean; category?: boolean; body?: boolean }>({});

  const titleErr = titleRules(title);
  const slugErr = slugRules(slug);
  const categoryErr = categoryRules(category);
  const bodyErr = bodyRules(body);
  const anyErr = titleErr || slugErr || categoryErr || bodyErr;

  const saveMut = useMutationWithToast<
    { ok: boolean; error?: string },
    Error,
    void
  >({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      const res = await api.manuals.save({
        id: initial.id,
        slug: slug.trim() || initial.slug,
        title: title.trim(),
        bodyMd: body,
        category: category.trim() || undefined,
        authorId: user.id,
      });
      return res;
    },
    successMessage: '문서가 저장되었습니다',
    errorMessage: '저장에 실패했습니다',
    invalidates: [['manuals.list'], ['manuals.get']],
    onSuccess: (res) => {
      if (res.ok) onSaved(slug.trim() || initial.slug);
    },
  });

  function handleSave() {
    setTouched({ title: true, slug: true, category: true, body: true });
    if (anyErr) return;
    saveMut.mutate();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="card space-y-3"
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <FormField
          label="제목"
          required
          error={touched.title ? titleErr : null}
          count={title.length}
          max={TITLE_MAX}
        >
          {(slot) => (
            <TextInput
              {...slot}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              placeholder="제목"
              maxLength={TITLE_MAX}
            />
          )}
        </FormField>
        <FormField label="slug" required error={touched.slug ? slugErr : null}>
          {(slot) => (
            <TextInput
              {...slot}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, slug: true }))}
              placeholder="slug"
              className="font-mono"
            />
          )}
        </FormField>
        <FormField
          label="카테고리"
          error={touched.category ? categoryErr : null}
          count={category.length}
          max={CATEGORY_MAX}
        >
          {(slot) => (
            <TextInput
              {...slot}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, category: true }))}
              placeholder="카테고리"
              maxLength={CATEGORY_MAX}
            />
          )}
        </FormField>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
        <FormField
          label="본문 (Markdown)"
          error={touched.body ? bodyErr : null}
          count={body.length}
          max={BODY_MAX}
        >
          {(slot) => (
            <Textarea
              {...slot}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, body: true }))}
              rows={20}
              className="text-xs font-mono leading-relaxed"
              placeholder="# Markdown"
            />
          )}
        </FormField>
        <div>
          <div className="text-[11px] font-medium text-fg-muted mb-1">미리보기</div>
          <div className="border border-border rounded p-3 overflow-y-auto max-h-[60vh] bg-bg-soft/30">
            {renderMarkdown(body || '*미리보기*')}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saveMut.isPending || !!anyErr}
          className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
        >
          <Save size={13} /> {saveMut.isPending ? '저장 중…' : '저장'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saveMut.isPending}
          className="btn-ghost text-sm flex items-center gap-1.5"
        >
          <X size={13} /> 취소
        </button>
      </div>
    </form>
  );
}

function NewManualModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (slug: string) => void;
}) {
  const { user } = useSession();
  const api = getApi();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('# 새 문서\n\n내용을 작성하세요.');
  const [touched, setTouched] = useState<{ title?: boolean; slug?: boolean; category?: boolean; body?: boolean }>({});

  const titleErr = titleRules(title);
  const slugErr = slugRules(slug);
  const categoryErr = categoryRules(category);
  const bodyErr = bodyRules(body);
  const anyErr = titleErr || slugErr || categoryErr || bodyErr;

  const saveMut = useMutationWithToast<
    { ok: boolean; error?: string },
    Error,
    void
  >({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      const res = await api.manuals.save({
        slug: slug.trim(),
        title: title.trim(),
        bodyMd: body,
        category: category.trim() || undefined,
        authorId: user.id,
      });
      return res;
    },
    successMessage: '문서가 생성되었습니다',
    errorMessage: '생성에 실패했습니다',
    invalidates: [['manuals.list']],
    onSuccess: (res) => {
      if (!res.ok) return;
      const created = slug.trim();
      setTitle('');
      setSlug('');
      setCategory('');
      setBody('# 새 문서\n\n내용을 작성하세요.');
      setTouched({});
      onCreated(created);
    },
  });

  function handleSubmit() {
    setTouched({ title: true, slug: true, category: true, body: true });
    if (anyErr) return;
    saveMut.mutate();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saveMut.isPending) onClose();
      }}
      title="새 매뉴얼 문서"
      size="lg"
      closeOnEsc={!saveMut.isPending}
      closeOnBackdrop={!saveMut.isPending}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={saveMut.isPending}
            className="btn-ghost text-sm"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saveMut.isPending || !!anyErr}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Save size={13} /> {saveMut.isPending ? '생성 중…' : '생성'}
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
          error={touched.title ? titleErr : null}
          count={title.length}
          max={TITLE_MAX}
        >
          {(slot) => (
            <TextInput
              {...slot}
              placeholder="제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              maxLength={TITLE_MAX}
              autoFocus
            />
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-2">
          <FormField
            label="slug"
            required
            hint="영문 소문자 + 숫자 + 하이픈"
            error={touched.slug ? slugErr : null}
          >
            {(slot) => (
              <TextInput
                {...slot}
                className="font-mono"
                placeholder="예: qa-checklist"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                onBlur={() => setTouched((t) => ({ ...t, slug: true }))}
              />
            )}
          </FormField>
          <FormField
            label="카테고리"
            error={touched.category ? categoryErr : null}
            count={category.length}
            max={CATEGORY_MAX}
          >
            {(slot) => (
              <TextInput
                {...slot}
                placeholder="카테고리"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, category: true }))}
                maxLength={CATEGORY_MAX}
              />
            )}
          </FormField>
        </div>
        <FormField
          label="본문 (Markdown)"
          error={touched.body ? bodyErr : null}
          count={body.length}
          max={BODY_MAX}
        >
          {(slot) => (
            <Textarea
              {...slot}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, body: true }))}
              rows={12}
              className="text-xs font-mono leading-relaxed"
            />
          )}
        </FormField>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

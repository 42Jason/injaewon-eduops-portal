import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  FileText,
  FolderOpen,
  FolderX,
  Plus,
  Save,
  Search,
  Tag,
  User as UserIcon,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { fmtDate, relative } from '@/lib/date';
import { cn } from '@/lib/cn';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput } from '@/components/ui/FormField';
import { firstError, maxLength, numberRange, required } from '@/lib/validators';

interface DocumentRow {
  id: number;
  name: string;
  folder?: string | null;
  tags?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  uploader_name?: string | null;
  created_at: string;
}

const DEFAULT_FOLDERS = ['일반', '사내규정', '교육자료', '계약서', '회계'];
const NAME_MAX = 200;
const TAGS_MAX = 200;
const MIME_MAX = 80;

export function DocumentsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;

  const [folder, setFolder] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['documents.list', folder],
    queryFn: () =>
      api!.documents.list(folder === 'ALL' ? undefined : folder) as unknown as Promise<DocumentRow[]>,
    enabled: live,
  });

  const rows = listQuery.data ?? [];

  const folders = useMemo(() => {
    const set = new Set<string>(DEFAULT_FOLDERS);
    for (const r of rows) if (r.folder) set.add(r.folder);
    return ['ALL', ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) =>
      [r.name, r.tags ?? '', r.folder ?? '', r.uploader_name ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 자료실을 확인할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <FolderOpen size={20} /> 자료실
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            공용 문서 레퍼런스. 이 버전은 메타데이터만 관리합니다 (실제 파일은 공유 드라이브에 저장).
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="btn-primary text-sm flex items-center gap-1.5"
        >
          <Plus size={14} /> 자료 등록
        </button>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Folder sidebar */}
        <div className="col-span-12 lg:col-span-3 card p-0 overflow-hidden h-fit">
          <div className="px-3 py-2 border-b border-border bg-bg-soft/40 text-sm font-medium">
            폴더
          </div>
          <div className="divide-y divide-border" role="radiogroup" aria-label="폴더 선택">
            {folders.map((f) => {
              const active = folder === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFolder(f)}
                  role="radio"
                  aria-checked={active}
                  className={cn(
                    'w-full text-left px-3 py-2 text-sm transition flex items-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    active
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-muted hover:bg-bg-soft/40',
                  )}
                >
                  <FolderOpen size={13} />
                  {f === 'ALL' ? '전체' : f}
                </button>
              );
            })}
          </div>
        </div>

        {/* List */}
        <div className="col-span-12 lg:col-span-9">
          <div className="card p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-bg-soft/40 flex items-center gap-2">
              <Search size={13} className="text-fg-subtle" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="이름 / 태그 / 업로더 검색"
                aria-label="자료 검색"
                className="input text-xs py-1 flex-1"
              />
              <span className="text-xs text-fg-subtle" aria-live="polite">{filtered.length}건</span>
            </div>
            <div className="overflow-x-auto">
              {listQuery.isLoading ? (
                <LoadingPanel label="자료 목록을 불러오는 중…" className="py-10" />
              ) : listQuery.isError ? (
                <EmptyState
                  tone="error"
                  icon={AlertTriangle}
                  title="자료 목록을 불러오지 못했습니다"
                  hint="네트워크 상태를 확인하거나 잠시 후 다시 시도해 주세요."
                  action={
                    <button className="btn-outline" onClick={() => listQuery.refetch()}>
                      다시 시도
                    </button>
                  }
                  className="border-0"
                />
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={search.trim() ? Search : FolderX}
                  title={
                    search.trim()
                      ? '검색어와 일치하는 자료가 없습니다'
                      : folder === 'ALL'
                        ? '아직 등록된 자료가 없습니다'
                        : `"${folder}" 폴더에 자료가 없습니다`
                  }
                  hint={search.trim() ? '다른 검색어를 시도하거나 검색을 지워 보세요.' : '우측 상단 "자료 등록" 버튼으로 처음 자료를 추가해 보세요.'}
                  action={
                    search.trim() ? (
                      <button className="btn-outline" onClick={() => setSearch('')}>
                        검색 지우기
                      </button>
                    ) : folder !== 'ALL' ? (
                      <button className="btn-outline" onClick={() => setFolder('ALL')}>
                        전체 보기
                      </button>
                    ) : (
                      <button className="btn-primary" onClick={() => setNewOpen(true)}>
                        <Plus size={14} className="mr-1" />
                        자료 등록
                      </button>
                    )
                  }
                  className="border-0"
                />
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-bg-soft/30 text-xs text-fg-subtle">
                    <tr>
                      <th className="text-left px-3 py-2 font-normal">이름</th>
                      <th className="text-left px-3 py-2 font-normal">폴더</th>
                      <th className="text-left px-3 py-2 font-normal">태그</th>
                      <th className="text-right px-3 py-2 font-normal">크기</th>
                      <th className="text-left px-3 py-2 font-normal">업로더</th>
                      <th className="text-left px-3 py-2 font-normal">등록</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((r) => (
                      <tr key={r.id} className="hover:bg-bg-soft/30">
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-1.5 text-fg">
                            <FileText size={13} className="text-fg-subtle" /> {r.name}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-fg-muted">
                          <span className="text-xs border border-border rounded px-1.5 py-0.5 bg-bg-soft/50">
                            {r.folder ?? '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-fg-subtle">
                          {r.tags ? (
                            <span className="flex items-center gap-1">
                              <Tag size={10} /> {r.tags}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-xs text-fg-subtle">
                          {formatSize(r.size_bytes)}
                        </td>
                        <td className="px-3 py-2 text-xs text-fg-muted">
                          <span className="flex items-center gap-1">
                            <UserIcon size={10} /> {r.uploader_name ?? '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-fg-subtle">
                          <div>{relative(r.created_at)}</div>
                          <div className="text-[10px]">{fmtDate(r.created_at)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      <NewDocumentModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
      />
    </div>
  );
}

function formatSize(bytes?: number | null): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function NewDocumentModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useSession();
  const api = getApi();
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(DEFAULT_FOLDERS[0]);
  const [tags, setTags] = useState('');
  const [mime, setMime] = useState('');
  const [size, setSize] = useState<number | ''>('');
  const [touched, setTouched] = useState<{ name?: boolean; tags?: boolean; mime?: boolean; size?: boolean }>({});

  const nameRules = firstError<string>([required('파일명을 입력해 주세요'), maxLength(NAME_MAX)]);
  const tagsRules = firstError<string>([maxLength(TAGS_MAX)]);
  const mimeRules = firstError<string>([maxLength(MIME_MAX)]);
  const sizeRules = firstError<number | null | undefined>([numberRange(0, 10 * 1024 * 1024 * 1024, '크기는 0 ~ 10GB 사이여야 합니다')]);

  const nameErr = nameRules(name);
  const tagsErr = tagsRules(tags);
  const mimeErr = mimeRules(mime);
  const sizeErr = sizeRules(size === '' ? null : Number(size));

  const showNameErr = touched.name ? nameErr : null;
  const showTagsErr = touched.tags ? tagsErr : null;
  const showMimeErr = touched.mime ? mimeErr : null;
  const showSizeErr = touched.size ? sizeErr : null;

  const invalid = !!(nameErr || tagsErr || mimeErr || sizeErr);

  const resetForm = () => {
    setName('');
    setFolder(DEFAULT_FOLDERS[0]);
    setTags('');
    setMime('');
    setSize('');
    setTouched({});
  };

  const createMut = useMutationWithToast({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      return api.documents.create({
        name: name.trim(),
        folder: folder || undefined,
        tags: tags.trim() || undefined,
        mimeType: mime.trim() || undefined,
        sizeBytes: size === '' ? undefined : Number(size),
        uploaderId: user.id,
      });
    },
    successMessage: `"${name.trim()}" 자료가 등록되었습니다`,
    errorMessage: '자료 등록에 실패했습니다',
    invalidates: [['documents.list']],
    onSuccess: (res) => {
      if (res.ok) {
        resetForm();
        onClose();
      }
    },
  });

  const handleSubmit = () => {
    setTouched({ name: true, tags: true, mime: true, size: true });
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
      title="자료 등록"
      size="md"
      closeOnEsc={!createMut.isPending}
      closeOnBackdrop={!createMut.isPending}
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              if (createMut.isPending) return;
              resetForm();
              onClose();
            }}
            className="btn-ghost text-sm"
            disabled={createMut.isPending}
          >
            취소
          </button>
          <button
            type="button"
            disabled={createMut.isPending}
            onClick={handleSubmit}
            className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save size={13} /> {createMut.isPending ? '등록 중…' : '등록'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField
          label="파일명"
          required
          error={showNameErr}
          hint="예: 2026-운영매뉴얼.pdf"
          count={name.length}
          max={NAME_MAX}
        >
          {(slot) => (
            <TextInput
              {...slot}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, name: true }))}
              placeholder="예: 2026-운영매뉴얼.pdf"
              maxLength={NAME_MAX + 20}
            />
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="폴더">
            {(slot) => (
              <SelectInput
                {...slot}
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              >
                {DEFAULT_FOLDERS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>
          <FormField
            label="MIME"
            hint="선택 · 예: application/pdf"
            error={showMimeErr}
            count={mime.length}
            max={MIME_MAX}
          >
            {(slot) => (
              <TextInput
                {...slot}
                type="text"
                value={mime}
                onChange={(e) => setMime(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, mime: true }))}
                placeholder="application/pdf"
                maxLength={MIME_MAX + 20}
              />
            )}
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="태그"
            hint="쉼표로 구분"
            error={showTagsErr}
            count={tags.length}
            max={TAGS_MAX}
          >
            {(slot) => (
              <TextInput
                {...slot}
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, tags: true }))}
                placeholder="예: 2026, 규정, 운영"
                maxLength={TAGS_MAX + 20}
              />
            )}
          </FormField>
          <FormField
            label="크기 (bytes)"
            hint="선택"
            error={showSizeErr}
          >
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                min={0}
                step={1}
                value={size}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setSize('');
                  else setSize(Math.max(0, Number(v)));
                }}
                onBlur={() => setTouched((t) => ({ ...t, size: true }))}
                placeholder="예: 102400"
              />
            )}
          </FormField>
        </div>
        <div className="text-[11px] text-fg-subtle">
          * 이 버전은 파일 자체를 저장하지 않고 메타데이터만 기록합니다.
        </div>
      </div>
    </Modal>
  );
}

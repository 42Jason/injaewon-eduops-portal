import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderOpen, FileText, Plus, Search, User as UserIcon, Tag, X, Save,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { fmtDate, relative } from '@/lib/date';
import { cn } from '@/lib/cn';

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

export function DocumentsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();

  const [folder, setFolder] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['documents.list', folder],
    queryFn: () =>
      api!.documents.list(folder === 'ALL' ? undefined : folder) as Promise<DocumentRow[]>,
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
          <div className="divide-y divide-border">
            {folders.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFolder(f)}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm transition flex items-center gap-2',
                  folder === f
                    ? 'bg-accent/10 text-accent'
                    : 'text-fg-muted hover:bg-bg-soft/40',
                )}
              >
                <FolderOpen size={13} />
                {f === 'ALL' ? '전체' : f}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="col-span-12 lg:col-span-9">
          <div className="card p-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-bg-soft/40 flex items-center gap-2">
              <Search size={13} className="text-fg-subtle" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="이름 / 태그 / 업로더 검색"
                className="input text-xs py-1 flex-1"
              />
              <span className="text-xs text-fg-subtle">{filtered.length}건</span>
            </div>
            <div className="overflow-x-auto">
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
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-fg-subtle">
                        등록된 자료가 없습니다.
                      </td>
                    </tr>
                  )}
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
            </div>
          </div>
        </div>
      </div>

      {newOpen && (
        <NewDocumentModal
          onClose={() => setNewOpen(false)}
          onCreated={() => {
            setNewOpen(false);
            qc.invalidateQueries({ queryKey: ['documents.list'] });
          }}
        />
      )}
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
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { user } = useSession();
  const api = getApi();
  const [name, setName] = useState('');
  const [folder, setFolder] = useState(DEFAULT_FOLDERS[0]);
  const [tags, setTags] = useState('');
  const [mime, setMime] = useState('');
  const [size, setSize] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      if (!name.trim()) throw new Error('파일명 필수');
      const res = await api.documents.create({
        name: name.trim(),
        folder: folder || undefined,
        tags: tags.trim() || undefined,
        mimeType: mime.trim() || undefined,
        sizeBytes: size === '' ? undefined : Number(size),
        uploaderId: user.id,
      });
      if (!res.ok) throw new Error(res.error ?? '등록 실패');
      return res;
    },
    onSuccess: onCreated,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg border border-border rounded-lg shadow-xl max-w-md w-full p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">자료 등록</h2>
          <button type="button" onClick={onClose} className="text-fg-subtle hover:text-fg">
            <X size={18} />
          </button>
        </div>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="파일명 (예: 2026-운영매뉴얼.pdf)"
          className="input text-sm w-full"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            className="input text-sm"
          >
            {DEFAULT_FOLDERS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={mime}
            onChange={(e) => setMime(e.target.value)}
            placeholder="MIME (선택)"
            className="input text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="태그 (쉼표 구분)"
            className="input text-sm"
          />
          <input
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="크기(bytes, 선택)"
            className="input text-sm"
          />
        </div>
        {error && (
          <div className="text-xs text-rose-300 border border-rose-500/40 bg-rose-500/10 rounded px-2 py-1">
            {error}
          </div>
        )}
        <div className="text-[11px] text-fg-subtle">
          * 이 버전은 파일 자체를 저장하지 않고 메타데이터만 기록합니다.
        </div>
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
            <Save size={13} /> 등록
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getApi } from '@/hooks/useApi';
import { useSession } from '@/stores/session';
import { useToast } from '@/stores/toast';

interface AssignmentSearchRow {
  id: number;
  code?: string | null;
  title?: string | null;
  subject?: string | null;
  state?: string | null;
}

interface StudentSearchRow {
  id: number;
  student_code?: string | null;
  name?: string | null;
  school?: string | null;
  grade?: string | null;
  name_masked?: number | boolean | null;
}

interface ManualSearchRow {
  id: number;
  slug?: string | null;
  title?: string | null;
  category?: string | null;
}

interface NoticeSearchRow {
  id: number;
  title?: string | null;
  audience?: string | null;
  author_name?: string | null;
}

interface DocumentSearchRow {
  id: number;
  name?: string | null;
  folder?: string | null;
  tags?: string | null;
}

interface SearchResult {
  key: string;
  type: string;
  title: string;
  subtitle: string;
  badge?: string | null;
  to: string;
}

type SearchableApi = ReturnType<typeof getApi> & {
  students?: { list(filter?: { limit?: number; search?: string }): Promise<Array<Record<string, unknown>>> };
  manuals?: { list(): Promise<Array<Record<string, unknown>>> };
  notices?: { list(): Promise<Array<Record<string, unknown>>> };
  documents?: { list(folder?: string): Promise<Array<Record<string, unknown>>> };
};

function includesQuery(values: Array<string | null | undefined>, query: string): boolean {
  return values.join(' ').toLowerCase().includes(query);
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function GlobalSearch() {
  const { user } = useSession();
  const api = getApi() as SearchableApi;
  const live = !!api && !!user;
  const navigate = useNavigate();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const searchBoxRef = useRef<HTMLFormElement>(null);

  const canSearchStudents = !user?.perms.isParsingAssistantOnly;

  const assignmentsQuery = useQuery({
    queryKey: ['topbar.assignments'],
    queryFn: () =>
      api!.assignments.list() as unknown as Promise<AssignmentSearchRow[]>,
    enabled: live && open,
    staleTime: 30_000,
  });

  const studentsQuery = useQuery({
    queryKey: ['topbar.students', user?.id, user?.role],
    queryFn: async () => {
      if (!api?.students) return [];
      return (await api.students.list({ limit: 500 })) as unknown as StudentSearchRow[];
    },
    enabled: live && open && canSearchStudents,
    staleTime: 30_000,
  });

  const manualsQuery = useQuery({
    queryKey: ['topbar.manuals'],
    queryFn: async () => {
      if (!api?.manuals) return [];
      return (await api.manuals.list()) as unknown as ManualSearchRow[];
    },
    enabled: live && open,
    staleTime: 60_000,
  });

  const noticesQuery = useQuery({
    queryKey: ['topbar.notices'],
    queryFn: async () => {
      if (!api?.notices) return [];
      return (await api.notices.list()) as unknown as NoticeSearchRow[];
    },
    enabled: live && open,
    staleTime: 60_000,
  });

  const documentsQuery = useQuery({
    queryKey: ['topbar.documents'],
    queryFn: async () => {
      if (!api?.documents) return [];
      return (await api.documents.list()) as unknown as DocumentSearchRow[];
    },
    enabled: live && open,
    staleTime: 60_000,
  });

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const out: SearchResult[] = [];

    for (const row of assignmentsQuery.data ?? []) {
      if (!includesQuery([row.code, row.title, row.subject, row.state], q)) continue;
      out.push({
        key: `assignment:${row.id}`,
        type: '과제',
        title: readString(row.title) || readString(row.code) || '제목 없음',
        subtitle: [row.code, row.subject].filter(Boolean).join(' · '),
        badge: row.state ?? null,
        to: '/assignments',
      });
    }

    for (const row of studentsQuery.data ?? []) {
      if (!includesQuery([row.name, row.student_code, row.school, row.grade], q)) continue;
      out.push({
        key: `student:${row.id}`,
        type: '학생',
        title: readString(row.name) || readString(row.student_code) || '이름 없음',
        subtitle: [row.student_code, row.school, row.grade].filter(Boolean).join(' · '),
        badge: row.name_masked ? '마스킹' : null,
        to: '/students/archive',
      });
    }

    for (const row of noticesQuery.data ?? []) {
      if (!includesQuery([row.title, row.audience, row.author_name], q)) continue;
      out.push({
        key: `notice:${row.id}`,
        type: '공지',
        title: readString(row.title) || '제목 없음',
        subtitle: [row.audience, row.author_name].filter(Boolean).join(' · '),
        to: '/announcements',
      });
    }

    for (const row of manualsQuery.data ?? []) {
      if (!includesQuery([row.title, row.slug, row.category], q)) continue;
      out.push({
        key: `manual:${row.id}`,
        type: '가이드',
        title: readString(row.title) || readString(row.slug) || '제목 없음',
        subtitle: [row.category, row.slug].filter(Boolean).join(' · '),
        to: '/manuals',
      });
    }

    for (const row of documentsQuery.data ?? []) {
      if (!includesQuery([row.name, row.folder, row.tags], q)) continue;
      out.push({
        key: `document:${row.id}`,
        type: '문서',
        title: readString(row.name) || '파일명 없음',
        subtitle: [row.folder, row.tags].filter(Boolean).join(' · '),
        to: '/documents',
      });
    }

    return out.slice(0, 10);
  }, [
    assignmentsQuery.data,
    documentsQuery.data,
    manualsQuery.data,
    noticesQuery.data,
    query,
    studentsQuery.data,
  ]);

  const loading =
    assignmentsQuery.isLoading ||
    studentsQuery.isLoading ||
    manualsQuery.isLoading ||
    noticesQuery.isLoading ||
    documentsQuery.isLoading;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!searchBoxRef.current) return;
      if (!searchBoxRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, []);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    if (results.length > 0) {
      navigate(results[0].to);
    } else {
      toast.info(`"${trimmed}" 검색 결과가 없습니다.`);
    }
    setOpen(false);
  }

  return (
    <form
      onSubmit={submitSearch}
      className="flex items-center gap-2 max-w-md flex-1 relative"
      ref={searchBoxRef}
    >
      <div className="relative w-full">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
        />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="검색 (과제, 학생, 공지, 문서)"
          className="input pl-8 pr-8 h-9"
          aria-label="전역 검색"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg"
            aria-label="검색어 지우기"
          >
            <X size={12} />
          </button>
        )}
        {open && query.trim() && (
          <div className="absolute top-full left-0 right-0 mt-1 z-40 rounded-lg border border-border bg-bg-card shadow-lg overflow-hidden">
            {loading && (
              <div className="px-3 py-3 text-xs text-fg-subtle">검색 중...</div>
            )}
            {!loading && results.length === 0 && (
              <div className="px-3 py-3 text-xs text-fg-subtle">
                일치하는 결과가 없습니다.
              </div>
            )}
            {results.map((item) => (
              <button
                key={item.key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  navigate(item.to);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-bg-soft"
              >
                <span className="rounded border border-border bg-bg-soft px-1.5 py-0.5 text-[10px] text-fg-muted shrink-0">
                  {item.type}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-fg">{item.title}</span>
                  {item.subtitle && (
                    <span className="block truncate text-[11px] text-fg-subtle">
                      {item.subtitle}
                    </span>
                  )}
                </span>
                {item.badge && (
                  <span className="chip bg-accent-soft text-accent-strong">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}

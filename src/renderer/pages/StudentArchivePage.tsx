import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, ClipboardList, FileText, FolderOpen, Plus, RefreshCw, Search, User2 } from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/cn';
import { groupStudents, matchesStudentGroup } from './student-archive/model';
import type { StudentGroupRow, StudentListRow, Tab } from './student-archive/model';
import { StudentDetailPanel } from './student-archive/detail';
import { StudentEditModal } from './student-archive/student-form';
import { useMemoAutoSelect, useMemoDebounce } from './student-archive/hooks';

export function StudentArchivePage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [creating, setCreating] = useState(false);

  // debounce search
  useMemoDebounce(search, setDebounced, 200);

  const studentsQuery = useQuery({
    queryKey: ['students.list', user?.id, user?.role],
    queryFn: () =>
      api!.students.list({ limit: 2000 }) as unknown as Promise<StudentListRow[]>,
    enabled: live,
  });

  const allStudents = useMemo<StudentListRow[]>(
    () => studentsQuery.data ?? [],
    [studentsQuery.data],
  );
  const allStudentGroups = useMemo<StudentGroupRow[]>(
    () => groupStudents(allStudents),
    [allStudents],
  );
  const studentGroups = useMemo<StudentGroupRow[]>(
    () => allStudentGroups.filter((group) => matchesStudentGroup(group, debounced)),
    [allStudentGroups, debounced],
  );
  const visibleSourceRowCount = studentGroups.reduce((sum, group) => sum + group.duplicate_count, 0);
  const hasMaskedSourceNames = allStudents.some((row) => row.name_masked || row.name.includes('*'));
  const selectedGroup = useMemo(() => {
    if (!studentGroups.length) return null;
    return (
      studentGroups.find((group) => selectedId !== null && group.student_ids.includes(selectedId)) ??
      studentGroups[0]
    );
  }, [studentGroups, selectedId]);

  // Auto-select the first student group if the list is non-empty and nothing picked.
  useMemoAutoSelect(studentGroups, selectedId, setSelectedId);

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 학생 정보 보관함을 사용할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-64px)] min-h-0 flex-col space-y-4 overflow-hidden p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <Archive size={20} /> 학생 정보 보관함
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            학생별로 그동안의 파싱 결과와 수행평가/보고서 주제, 파일을 한 곳에 모아 둡니다.
          </p>
        </div>
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            className="btn-primary text-xs flex items-center gap-1"
            onClick={() => setCreating(true)}
          >
            <Plus size={12} /> 학생 추가
          </button>
          <button
            type="button"
            className="btn-outline text-xs flex items-center gap-1"
            onClick={() => studentsQuery.refetch()}
          >
            <RefreshCw size={12} /> 새로고침
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-4 overflow-hidden">
        {/* Left pane — student list */}
        <aside className="card flex min-h-0 flex-col overflow-hidden p-0">
          <div className="border-b border-border p-3">
            <label className="relative block">
              <Search
                size={14}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle"
              />
              <input
                type="search"
                placeholder="이름·코드·학교로 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input text-xs py-1.5 pl-7 w-full"
                aria-label="학생 검색"
              />
            </label>
            <div className="mt-2 text-[11px] text-fg-subtle">
              학생 {studentGroups.length}명
              {visibleSourceRowCount !== studentGroups.length && (
                <> · 원본 행 {visibleSourceRowCount}건</>
              )}
            </div>
            {hasMaskedSourceNames && (
              <div className="mt-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] leading-relaxed text-amber-200">
                원본 이름이 마스킹 상태입니다. 실명 원본 동기화가 필요합니다.
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {studentsQuery.isLoading ? (
              <LoadingPanel label="학생 목록을 불러오는 중…" />
            ) : studentGroups.length === 0 ? (
              <EmptyState
                icon={User2}
                title="조건에 맞는 학생이 없습니다"
                hint={debounced ? '검색어를 바꾸거나 비워보세요.' : '학생 정보가 아직 등록되지 않았습니다.'}
              />
            ) : (
              <ul className="divide-y divide-border">
                {studentGroups.map((s) => {
                  const active = selectedId !== null && s.student_ids.includes(selectedId);
                  return (
                    <li key={s.group_key}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(s.id);
                          setTab('overview');
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2.5 hover:bg-bg-soft/60 transition-colors',
                          active && 'bg-bg-soft',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-fg truncate">
                            {s.name}
                          </span>
                          <span className="text-[11px] tabular-nums text-fg-subtle">
                            {s.identity_label ?? s.student_codes[0] ?? s.student_code}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-subtle">
                          {s.grades.length > 0 && <span>{s.grades.join(' · ')}</span>}
                          {s.school && (
                            <span className="truncate max-w-[120px]">{s.school}</span>
                          )}
                          {s.duplicate_count > 1 && (
                            <span className="rounded border border-border bg-bg-soft px-1 py-0.5 text-[10px]">
                              원본 {s.duplicate_count}건
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-fg-subtle">
                          <span className="inline-flex items-center gap-0.5">
                            <ClipboardList size={10} /> {s.assignment_count}
                          </span>
                          <span className="inline-flex items-center gap-0.5">
                            <FileText size={10} /> {s.topic_count}
                          </span>
                          <span className="inline-flex items-center gap-0.5">
                            <FolderOpen size={10} /> {s.file_count}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Right pane — student detail */}
        <main className="min-h-0 overflow-y-auto pr-1">
          {selectedId === null || selectedGroup === null ? (
            <EmptyState
              icon={User2}
              title="왼쪽에서 학생을 선택하세요"
              hint="학생별 파싱 이력, 보고서 주제, 파일을 여기서 확인할 수 있습니다."
            />
          ) : (
            <StudentDetailPanel
              studentId={selectedId}
              studentIds={selectedGroup.student_ids}
              groupRows={selectedGroup.rows}
              tab={tab}
              setTab={setTab}
              currentUserId={user!.id}
              currentUserRole={user!.role}
              onDeleted={() => setSelectedId(null)}
            />
          )}
        </main>
      </div>

      <StudentEditModal
        open={creating}
        mode="create"
        initial={null}
        currentUserId={user!.id}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setSelectedId(id);
          setTab('overview');
        }}
      />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  Archive,
  Search,
  User2,
  School,
  FileText,
  FilePlus2,
  Trash2,
  Plus,
  Edit3,
  FolderOpen,
  ClipboardList,
  Sparkles,
  RefreshCw,
  FileSearch,
  X,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { firstError, required } from '@/lib/validators';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { cn } from '@/lib/cn';

// -----------------------------------------------------------------------------
// Types mirroring the shape returned by students:* IPC handlers.
// -----------------------------------------------------------------------------

interface StudentListRow {
  id: number;
  student_code: string;
  name: string;
  grade?: string | null;
  school?: string | null;
  guardian?: string | null;
  memo?: string | null;
  created_at: string;
  assignment_count: number;
  topic_count: number;
  file_count: number;
}

interface StudentDetail {
  id: number;
  student_code: string;
  name: string;
  grade?: string | null;
  school?: string | null;
  guardian?: string | null;
  memo?: string | null;
  monthly_fee?: number;
  billing_day?: number;
  billing_active?: number;
  created_at: string;
}

interface AssignmentRow {
  id: number;
  code: string;
  title: string;
  subject: string;
  publisher?: string | null;
  scope?: string | null;
  length_req?: string | null;
  state: string;
  risk: 'low' | 'medium' | 'high';
  due_at?: string | null;
  received_at?: string | null;
  completed_at?: string | null;
  parser_id?: number | null;
  qa1_id?: number | null;
  qa_final_id?: number | null;
  parser_name?: string | null;
  qa1_name?: string | null;
  qa_final_name?: string | null;
  parsing_count: number;
}

interface ParsingRow {
  id: number;
  assignment_id: number;
  version: number;
  ai_summary?: string | null;
  confidence?: number | null;
  parsed_at: string;
  parsed_by?: number | null;
  parser_name?: string | null;
  assignment_code: string;
  assignment_title: string;
  assignment_subject: string;
}

interface ParsingDetail extends ParsingRow {
  content_json: string;
  assignment_publisher?: string | null;
}

type TopicStatus = 'planned' | 'in_progress' | 'submitted' | 'graded' | 'archived' | 'cancelled';

interface TopicRow {
  id: number;
  student_id: number;
  title: string;
  subject?: string | null;
  topic?: string | null;
  status: TopicStatus;
  assignment_id?: number | null;
  assignment_code?: string | null;
  due_at?: string | null;
  submitted_at?: string | null;
  score?: string | null;
  memo?: string | null;
  created_by?: number | null;
  created_by_name?: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
}

type ArchiveCategory = 'report' | 'draft' | 'reference' | 'feedback' | 'other';

interface ArchiveFileRow {
  id: number;
  student_id: number;
  topic_id?: number | null;
  category: ArchiveCategory;
  original_name: string;
  stored_path: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  description?: string | null;
  uploaded_at: string;
  uploaded_by?: number | null;
  uploader_name?: string | null;
  topic_title?: string | null;
  source_assignment_id?: number | null;
  auto_generated?: number;
  source_assignment_code?: string | null;
  source_assignment_title?: string | null;
  source_assignment_state?: string | null;
}

// -----------------------------------------------------------------------------
// Display helpers
// -----------------------------------------------------------------------------

const TOPIC_STATUS: Record<TopicStatus, { label: string; tone: string }> = {
  planned:     { label: '계획',   tone: 'bg-bg-soft text-fg-subtle border-border' },
  in_progress: { label: '진행중', tone: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  submitted:   { label: '제출',   tone: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
  graded:      { label: '채점완료', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  archived:    { label: '보관',   tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  cancelled:   { label: '취소',   tone: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

const CATEGORY_LABEL: Record<ArchiveCategory, string> = {
  report: '최종 보고서',
  draft: '초안',
  reference: '참고 자료',
  feedback: '피드백',
  other: '기타',
};

const CATEGORY_TONE: Record<ArchiveCategory, string> = {
  report: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  draft: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  reference: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  feedback: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  other: 'bg-bg-soft text-fg-subtle border-border',
};

function fmtFileSize(n?: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtConfidence(c?: number | null): string {
  if (c === null || c === undefined || Number.isNaN(c)) return '-';
  return `${Math.round(c * 100)}%`;
}

// -----------------------------------------------------------------------------
// Main page
// -----------------------------------------------------------------------------

type Tab = 'overview' | 'parsing' | 'topics' | 'files';

export function StudentArchivePage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  // debounce search
  useMemoDebounce(search, setDebounced, 200);

  const studentsQuery = useQuery({
    queryKey: ['students.list', debounced],
    queryFn: () =>
      api!.students.list({ q: debounced || undefined }) as unknown as Promise<StudentListRow[]>,
    enabled: live,
  });

  const students = useMemo<StudentListRow[]>(
    () => studentsQuery.data ?? [],
    [studentsQuery.data],
  );

  // Auto-select the first student if the list is non-empty and nothing picked.
  useMemoAutoSelect(students, selectedId, setSelectedId);

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
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <Archive size={20} /> 학생 정보 보관함
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            학생별로 그동안의 파싱 결과와 수행평가/보고서 주제, 파일을 한 곳에 모아 둡니다.
          </p>
        </div>
        <button
          type="button"
          className="btn-outline text-xs flex items-center gap-1"
          onClick={() => studentsQuery.refetch()}
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-4">
        {/* Left pane — student list */}
        <aside className="card p-0 overflow-hidden flex flex-col min-h-[70vh]">
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
              총 {students.length}명
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {studentsQuery.isLoading ? (
              <LoadingPanel label="학생 목록을 불러오는 중…" />
            ) : students.length === 0 ? (
              <EmptyState
                icon={User2}
                title="조건에 맞는 학생이 없습니다"
                hint={debounced ? '검색어를 바꾸거나 비워보세요.' : '학생 정보가 아직 등록되지 않았습니다.'}
              />
            ) : (
              <ul className="divide-y divide-border">
                {students.map((s) => {
                  const active = s.id === selectedId;
                  return (
                    <li key={s.id}>
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
                            {s.student_code}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-subtle">
                          {s.grade && <span>{s.grade}</span>}
                          {s.school && (
                            <span className="truncate max-w-[120px]">{s.school}</span>
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
        <main className="min-h-[70vh]">
          {selectedId === null ? (
            <EmptyState
              icon={User2}
              title="왼쪽에서 학생을 선택하세요"
              hint="학생별 파싱 이력, 보고서 주제, 파일을 여기서 확인할 수 있습니다."
            />
          ) : (
            <StudentDetailPanel
              studentId={selectedId}
              tab={tab}
              setTab={setTab}
              currentUserId={user!.id}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Detail pane (tabs)
// -----------------------------------------------------------------------------

function StudentDetailPanel({
  studentId,
  tab,
  setTab,
  currentUserId,
}: {
  studentId: number;
  tab: Tab;
  setTab: (t: Tab) => void;
  currentUserId: number;
}) {
  const api = getApi()!;

  const studentQuery = useQuery({
    queryKey: ['students.get', studentId],
    queryFn: () => api.students.get(studentId) as unknown as Promise<StudentDetail | null>,
  });

  if (studentQuery.isLoading) {
    return <LoadingPanel label="학생 정보를 불러오는 중…" />;
  }

  const student = studentQuery.data;
  if (!student) {
    return (
      <EmptyState
        icon={User2}
        tone="error"
        title="학생 정보를 찾을 수 없습니다"
        hint="해당 학생이 삭제되었거나 접근 권한이 없습니다."
      />
    );
  }

  return (
    <div className="space-y-3">
      <StudentHeader student={student} />
      <nav className="card p-1 flex items-center gap-1 text-xs">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
          기본 정보
        </TabButton>
        <TabButton active={tab === 'parsing'} onClick={() => setTab('parsing')}>
          파싱 이력
        </TabButton>
        <TabButton active={tab === 'topics'} onClick={() => setTab('topics')}>
          보고서 주제
        </TabButton>
        <TabButton active={tab === 'files'} onClick={() => setTab('files')}>
          보고서 파일
        </TabButton>
      </nav>

      {tab === 'overview' && <OverviewTab studentId={studentId} student={student} />}
      {tab === 'parsing' && <ParsingTab studentId={studentId} />}
      {tab === 'topics' && (
        <TopicsTab studentId={studentId} currentUserId={currentUserId} />
      )}
      {tab === 'files' && (
        <FilesTab studentId={studentId} currentUserId={currentUserId} />
      )}
    </div>
  );
}

function StudentHeader({ student }: { student: StudentDetail }) {
  return (
    <header className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xl font-semibold text-fg">
            {student.name}
            <span className="rounded border border-border bg-bg-soft px-2 py-0.5 text-[11px] font-normal text-fg-muted tabular-nums">
              {student.student_code}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
            {student.grade && (
              <span className="inline-flex items-center gap-1">
                <Sparkles size={11} /> {student.grade}
              </span>
            )}
            {student.school && (
              <span className="inline-flex items-center gap-1">
                <School size={11} /> {student.school}
              </span>
            )}
            {student.guardian && (
              <span className="inline-flex items-center gap-1">
                <User2 size={11} /> 보호자 {student.guardian}
              </span>
            )}
          </div>
        </div>
        <div className="text-[11px] text-fg-subtle">
          등록: {fmtDate(student.created_at)}
        </div>
      </div>
      {student.memo && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-fg-muted whitespace-pre-line">
          {student.memo}
        </p>
      )}
    </header>
  );
}

function TabButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded transition-colors',
        active ? 'bg-accent text-bg font-medium' : 'text-fg-muted hover:bg-bg-soft hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Tab: Overview — summary of counts + quick-peek lists
// -----------------------------------------------------------------------------

function OverviewTab({
  studentId,
  student,
}: {
  studentId: number;
  student: StudentDetail;
}) {
  const api = getApi()!;
  const historyQuery = useQuery({
    queryKey: ['students.history', studentId],
    queryFn: () =>
      api.students.history(studentId) as unknown as Promise<{
        assignments: AssignmentRow[];
        parsings: ParsingRow[];
      }>,
  });
  const topicsQuery = useQuery({
    queryKey: ['students.topics', studentId],
    queryFn: () =>
      api.students.listReportTopics(studentId) as unknown as Promise<TopicRow[]>,
  });
  const filesQuery = useQuery({
    queryKey: ['students.files', studentId, null],
    queryFn: () =>
      api.students.listArchiveFiles({ studentId }) as unknown as Promise<ArchiveFileRow[]>,
  });

  const assignments = historyQuery.data?.assignments ?? [];
  const parsings = historyQuery.data?.parsings ?? [];
  const topics = topicsQuery.data ?? [];
  const files = filesQuery.data ?? [];

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="등록 과제" value={`${assignments.length}건`} icon={ClipboardList} />
        <StatCard label="파싱 결과" value={`${parsings.length}건`} icon={FileSearch} />
        <StatCard label="보고서 주제" value={`${topics.length}건`} icon={FileText} />
        <StatCard label="업로드 파일" value={`${files.length}건`} icon={FolderOpen} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-fg mb-2 flex items-center gap-1.5">
            <ClipboardList size={14} /> 최근 과제
          </h3>
          {assignments.length === 0 ? (
            <p className="text-xs text-fg-subtle">아직 등록된 과제가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-border text-xs">
              {assignments.slice(0, 5).map((a) => (
                <li key={a.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-fg">{a.title}</div>
                    <div className="text-[11px] text-fg-subtle">
                      {a.code} · {a.subject}
                      {a.publisher ? ` · ${a.publisher}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 rounded border border-border bg-bg-soft px-1.5 py-0.5 text-[10px] text-fg-muted">
                    {a.state}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-fg mb-2 flex items-center gap-1.5">
            <FileText size={14} /> 최근 보고서 주제
          </h3>
          {topics.length === 0 ? (
            <p className="text-xs text-fg-subtle">아직 보고서 주제가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-border text-xs">
              {topics.slice(0, 5).map((t) => (
                <li key={t.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-fg">{t.title}</div>
                    <div className="text-[11px] text-fg-subtle">
                      {t.subject ?? '—'}
                      {t.due_at ? ` · 마감 ${fmtDate(t.due_at)}` : ''}
                    </div>
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {student.memo === null && (
        <p className="text-[11px] text-fg-subtle">
          * 학생의 기본 정보는 <b>학원비 수납</b> 페이지에서 수정합니다.
        </p>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
        <Icon size={12} /> {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-fg tabular-nums">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: TopicStatus }) {
  const cfg = TOPIC_STATUS[status];
  return (
    <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[10px]', cfg.tone)}>
      {cfg.label}
    </span>
  );
}

// -----------------------------------------------------------------------------
// Tab: Parsing history (read-only)
// -----------------------------------------------------------------------------

function ParsingTab({ studentId }: { studentId: number }) {
  const api = getApi()!;
  const [parsingDetailId, setParsingDetailId] = useState<number | null>(null);

  const historyQuery = useQuery({
    queryKey: ['students.history', studentId],
    queryFn: () =>
      api.students.history(studentId) as unknown as Promise<{
        assignments: AssignmentRow[];
        parsings: ParsingRow[];
      }>,
  });

  const assignments = historyQuery.data?.assignments ?? [];
  const parsings = historyQuery.data?.parsings ?? [];

  return (
    <section className="space-y-3">
      <div className="card p-0 overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <h3 className="text-sm font-semibold text-fg flex items-center gap-1.5">
            <FileSearch size={14} /> 파싱 결과
          </h3>
          <span className="text-[11px] text-fg-subtle">
            노션에서 넘어온 안내문 원본이 구조화된 결과로 저장됩니다.
          </span>
        </header>
        {historyQuery.isLoading ? (
          <LoadingPanel label="파싱 이력을 불러오는 중…" />
        ) : parsings.length === 0 ? (
          <EmptyState
            icon={FileSearch}
            title="파싱 결과가 아직 없습니다"
            hint="안내문 파싱 센터에서 파싱을 진행하면 이곳에 쌓입니다."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-bg-soft/50 text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">과제</th>
                  <th className="px-3 py-2 text-left font-medium">과목</th>
                  <th className="px-3 py-2 text-left font-medium">v</th>
                  <th className="px-3 py-2 text-left font-medium">신뢰도</th>
                  <th className="px-3 py-2 text-left font-medium">파서</th>
                  <th className="px-3 py-2 text-left font-medium">요약</th>
                  <th className="px-3 py-2 text-left font-medium">파싱일</th>
                  <th className="px-3 py-2 text-right font-medium">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {parsings.map((p) => (
                  <tr key={p.id} className="hover:bg-bg-soft/40">
                    <td className="px-3 py-2">
                      <div className="font-medium text-fg">{p.assignment_title}</div>
                      <div className="text-[10px] text-fg-subtle tabular-nums">
                        {p.assignment_code}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{p.assignment_subject}</td>
                    <td className="px-3 py-2 tabular-nums">v{p.version}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtConfidence(p.confidence)}</td>
                    <td className="px-3 py-2 text-fg-muted">{p.parser_name ?? '—'}</td>
                    <td className="px-3 py-2 max-w-[260px]">
                      <span className="line-clamp-2 text-fg-muted">
                        {p.ai_summary ?? '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-fg-subtle">
                      {fmtDateTime(p.parsed_at)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        onClick={() => setParsingDetailId(p.id)}
                      >
                        보기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
          <h3 className="text-sm font-semibold text-fg flex items-center gap-1.5">
            <ClipboardList size={14} /> 과제 이력
          </h3>
          <span className="text-[11px] text-fg-subtle">
            학생에 연결된 과제와 현재 상태, 파서·QA 담당자를 한눈에 봅니다.
          </span>
        </header>
        {historyQuery.isLoading ? (
          <LoadingPanel label="과제 이력을 불러오는 중…" />
        ) : assignments.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="과제 이력이 없습니다"
            hint="과제가 생성되면 이곳에 자동으로 누적됩니다."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-bg-soft/50 text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">코드</th>
                  <th className="px-3 py-2 text-left font-medium">제목</th>
                  <th className="px-3 py-2 text-left font-medium">과목</th>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">리스크</th>
                  <th className="px-3 py-2 text-left font-medium">파서</th>
                  <th className="px-3 py-2 text-left font-medium">최종QA</th>
                  <th className="px-3 py-2 text-left font-medium">마감</th>
                  <th className="px-3 py-2 text-left font-medium">완료</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {assignments.map((a) => (
                  <tr key={a.id} className="hover:bg-bg-soft/40">
                    <td className="px-3 py-2 tabular-nums text-fg-subtle">{a.code}</td>
                    <td className="px-3 py-2 font-medium text-fg max-w-[260px] truncate">
                      {a.title}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{a.subject}</td>
                    <td className="px-3 py-2">
                      <span className="rounded border border-border bg-bg-soft px-1.5 py-0.5 text-[10px] text-fg-muted">
                        {a.state}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <RiskBadge risk={a.risk} />
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{a.parser_name ?? '—'}</td>
                    <td className="px-3 py-2 text-fg-muted">{a.qa_final_name ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-fg-subtle">
                      {a.due_at ? fmtDate(a.due_at) : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-fg-subtle">
                      {a.completed_at ? fmtDate(a.completed_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ParsingDetailModal
        parsingId={parsingDetailId}
        onClose={() => setParsingDetailId(null)}
      />
    </section>
  );
}

function RiskBadge({ risk }: { risk: 'low' | 'medium' | 'high' }) {
  const tone =
    risk === 'high'
      ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
      : risk === 'medium'
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] uppercase', tone)}>
      {risk}
    </span>
  );
}

function ParsingDetailModal({
  parsingId,
  onClose,
}: {
  parsingId: number | null;
  onClose: () => void;
}) {
  const api = getApi()!;
  const detailQuery = useQuery({
    queryKey: ['students.parsingDetail', parsingId],
    queryFn: () =>
      api.students.getParsingDetail(parsingId!) as unknown as Promise<ParsingDetail | null>,
    enabled: parsingId !== null,
  });

  const open = parsingId !== null;
  const d = detailQuery.data;

  const pretty = useMemo(() => {
    if (!d?.content_json) return '';
    try {
      return JSON.stringify(JSON.parse(d.content_json), null, 2);
    } catch {
      return d.content_json;
    }
  }, [d]);

  return (
    <Modal open={open} onClose={onClose} title="파싱 결과 상세" size="xl">
      {detailQuery.isLoading ? (
        <LoadingPanel label="상세 정보를 불러오는 중…" />
      ) : !d ? (
        <p className="text-sm text-fg-muted">상세 정보를 찾을 수 없습니다.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <Info label="과제">
              {d.assignment_title}{' '}
              <span className="text-fg-subtle tabular-nums">({d.assignment_code})</span>
            </Info>
            <Info label="과목">
              {d.assignment_subject}
              {d.assignment_publisher ? ` · ${d.assignment_publisher}` : ''}
            </Info>
            <Info label="버전">v{d.version}</Info>
            <Info label="신뢰도">{fmtConfidence(d.confidence)}</Info>
            <Info label="파서">{d.parser_name ?? '—'}</Info>
            <Info label="파싱일">{fmtDateTime(d.parsed_at)}</Info>
          </div>
          {d.ai_summary && (
            <div>
              <h4 className="text-xs font-medium text-fg-muted mb-1">AI 요약</h4>
              <p className="rounded border border-border bg-bg-soft/50 p-3 text-xs text-fg whitespace-pre-line">
                {d.ai_summary}
              </p>
            </div>
          )}
          <div>
            <h4 className="text-xs font-medium text-fg-muted mb-1">원본 데이터 (JSON)</h4>
            <pre className="rounded border border-border bg-bg-soft/50 p-3 text-[11px] text-fg whitespace-pre-wrap break-all max-h-[360px] overflow-auto">
              {pretty || '—'}
            </pre>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-fg-subtle">{label}</div>
      <div className="text-sm text-fg">{children}</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Tab: Topics — CRUD
// -----------------------------------------------------------------------------

function TopicsTab({
  studentId,
  currentUserId,
}: {
  studentId: number;
  currentUserId: number;
}) {
  const api = getApi()!;
  const confirm = useConfirm();
  const [editing, setEditing] = useState<TopicRow | 'new' | null>(null);

  const topicsQuery = useQuery({
    queryKey: ['students.topics', studentId],
    queryFn: () =>
      api.students.listReportTopics(studentId) as unknown as Promise<TopicRow[]>,
  });

  const topics = topicsQuery.data ?? [];

  const deleteMutation = useMutationWithToast({
    mutationFn: (id: number) => api.students.deleteReportTopic({ id, actorId: currentUserId }),
    successMessage: '주제를 삭제했습니다',
    errorMessage: '주제 삭제에 실패했습니다',
    invalidates: [
      ['students.topics', studentId],
      ['students.list'],
    ],
  });

  async function handleDelete(t: TopicRow) {
    const ok = await confirm({
      title: '보고서 주제 삭제',
      description: `"${t.title}" 주제를 정말 삭제할까요? 연결된 파일은 주제 연결만 해제되고 파일 자체는 남습니다.`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (ok) deleteMutation.mutate(t.id);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg flex items-center gap-1.5">
          <FileText size={14} /> 수행평가 / 보고서 주제
        </h3>
        <button
          type="button"
          className="btn-primary text-xs flex items-center gap-1"
          onClick={() => setEditing('new')}
        >
          <Plus size={12} /> 새 주제 추가
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        {topicsQuery.isLoading ? (
          <LoadingPanel label="보고서 주제를 불러오는 중…" />
        ) : topics.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="등록된 보고서 주제가 없습니다"
            hint="오른쪽 상단의 '새 주제 추가' 버튼으로 등록하세요."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-bg-soft/50 text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">제목</th>
                  <th className="px-3 py-2 text-left font-medium">과목</th>
                  <th className="px-3 py-2 text-left font-medium">주제</th>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">마감</th>
                  <th className="px-3 py-2 text-left font-medium">제출</th>
                  <th className="px-3 py-2 text-left font-medium">점수</th>
                  <th className="px-3 py-2 text-left font-medium">파일</th>
                  <th className="px-3 py-2 text-right font-medium">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topics.map((t) => (
                  <tr key={t.id} className="hover:bg-bg-soft/40">
                    <td className="px-3 py-2">
                      <div className="font-medium text-fg">{t.title}</div>
                      {t.assignment_code && (
                        <div className="text-[10px] text-fg-subtle tabular-nums">
                          연결: {t.assignment_code}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{t.subject ?? '—'}</td>
                    <td className="px-3 py-2 text-fg-muted max-w-[240px] truncate">
                      {t.topic ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-fg-subtle">
                      {t.due_at ? fmtDate(t.due_at) : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-fg-subtle">
                      {t.submitted_at ? fmtDate(t.submitted_at) : '—'}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{t.score ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-fg-subtle">{t.file_count}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="btn-ghost text-xs flex items-center gap-1"
                          onClick={() => setEditing(t)}
                        >
                          <Edit3 size={12} /> 수정
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs text-rose-300 flex items-center gap-1"
                          onClick={() => handleDelete(t)}
                        >
                          <Trash2 size={12} /> 삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TopicModal
        studentId={studentId}
        currentUserId={currentUserId}
        initial={editing}
        onClose={() => setEditing(null)}
      />
    </section>
  );
}

// -----------------------------------------------------------------------------
// Topic modal (create / edit)
// -----------------------------------------------------------------------------

function TopicModal({
  studentId,
  currentUserId,
  initial,
  onClose,
}: {
  studentId: number;
  currentUserId: number;
  initial: TopicRow | 'new' | null;
  onClose: () => void;
}) {
  const api = getApi()!;
  const open = initial !== null;
  const editing = initial && initial !== 'new' ? initial : null;

  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [status, setStatus] = useState<TopicStatus>('planned');
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [dueAt, setDueAt] = useState('');
  const [submittedAt, setSubmittedAt] = useState('');
  const [score, setScore] = useState('');
  const [memo, setMemo] = useState('');
  const [touched, setTouched] = useState(false);

  // reset when the modal opens or the edited row changes
  useMemoResetModal(open, editing, {
    setTitle,
    setSubject,
    setTopic,
    setStatus,
    setAssignmentId,
    setDueAt,
    setSubmittedAt,
    setScore,
    setMemo,
    setTouched,
  });

  const assignmentsForStudent = useQuery({
    queryKey: ['students.history', studentId],
    queryFn: () =>
      api.students.history(studentId) as unknown as Promise<{
        assignments: AssignmentRow[];
        parsings: ParsingRow[];
      }>,
    enabled: open,
  });

  const assignments = assignmentsForStudent.data?.assignments ?? [];

  const titleErr =
    touched && firstError<string>([required('제목은 필수입니다')])(title);

  const save = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.students.upsertReportTopic>[0]) =>
      api.students.upsertReportTopic(payload),
    successMessage: editing ? '주제를 수정했습니다' : '주제를 추가했습니다',
    errorMessage: '주제 저장에 실패했습니다',
    invalidates: [
      ['students.topics', studentId],
      ['students.list'],
    ],
    onSuccess: () => onClose(),
  });

  function submit() {
    setTouched(true);
    if (titleErr) return;
    save.mutate({
      id: editing?.id,
      studentId,
      title: title.trim(),
      subject: subject.trim() || null,
      topic: topic.trim() || null,
      status,
      assignmentId: assignmentId ?? null,
      dueAt: dueAt || null,
      submittedAt: submittedAt || null,
      score: score.trim() || null,
      memo: memo.trim() || null,
      actorId: currentUserId,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? '보고서 주제 수정' : '새 보고서 주제'}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={submit}
            disabled={save.isPending}
          >
            {save.isPending ? '저장 중…' : '저장'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="제목" required error={titleErr || null} className="md:col-span-2">
          {(slot) => (
            <TextInput
              {...slot}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 2025-2 화학 수행평가 - 이온결합"
              maxLength={120}
            />
          )}
        </FormField>
        <FormField label="과목">
          {(slot) => (
            <TextInput
              {...slot}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="화학 / 국어 / 영어 …"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="상태">
          {(slot) => (
            <SelectInput
              {...slot}
              value={status}
              onChange={(e) => setStatus(e.target.value as TopicStatus)}
            >
              {(Object.keys(TOPIC_STATUS) as TopicStatus[]).map((s) => (
                <option key={s} value={s}>
                  {TOPIC_STATUS[s].label}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
        <FormField label="세부 주제" className="md:col-span-2">
          {(slot) => (
            <Textarea
              {...slot}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="구체적인 연구 주제, 범위, 참고한 단원 등"
              rows={2}
              maxLength={500}
            />
          )}
        </FormField>
        <FormField label="연결된 과제">
          {(slot) => (
            <SelectInput
              {...slot}
              value={assignmentId === null ? '' : String(assignmentId)}
              onChange={(e) =>
                setAssignmentId(e.target.value === '' ? null : Number(e.target.value))
              }
            >
              <option value="">(선택 안 함)</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.title}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
        <FormField label="점수 / 등급">
          {(slot) => (
            <TextInput
              {...slot}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              placeholder="A+, 95/100, 상위 10% …"
              maxLength={40}
            />
          )}
        </FormField>
        <FormField label="마감일">
          {(slot) => (
            <TextInput
              {...slot}
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="제출일">
          {(slot) => (
            <TextInput
              {...slot}
              type="date"
              value={submittedAt}
              onChange={(e) => setSubmittedAt(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="메모" className="md:col-span-2">
          {(slot) => (
            <Textarea
              {...slot}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="교사 피드백, 주의사항, 다음 학기 계획 등"
              rows={3}
              maxLength={1000}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Tab: Files — metadata-only archive (bytes not stored yet)
// -----------------------------------------------------------------------------

function FilesTab({
  studentId,
  currentUserId,
}: {
  studentId: number;
  currentUserId: number;
}) {
  const api = getApi()!;
  const confirm = useConfirm();
  const [filterTopicId, setFilterTopicId] = useState<number | 'ALL'>('ALL');
  const [uploading, setUploading] = useState(false);

  const topicsQuery = useQuery({
    queryKey: ['students.topics', studentId],
    queryFn: () =>
      api.students.listReportTopics(studentId) as unknown as Promise<TopicRow[]>,
  });
  const topics = topicsQuery.data ?? [];

  const filesQuery = useQuery({
    queryKey: ['students.files', studentId, filterTopicId],
    queryFn: () =>
      api.students.listArchiveFiles({
        studentId,
        topicId: filterTopicId === 'ALL' ? null : filterTopicId,
      }) as unknown as Promise<ArchiveFileRow[]>,
  });
  const files = filesQuery.data ?? [];

  const deleteMutation = useMutationWithToast({
    mutationFn: (id: number) =>
      api.students.deleteArchiveFile({ id, actorId: currentUserId }),
    successMessage: '파일 기록을 삭제했습니다',
    errorMessage: '삭제에 실패했습니다',
    invalidates: [
      ['students.files', studentId],
      ['students.list'],
      ['students.topics', studentId],
    ],
  });

  async function handleDelete(f: ArchiveFileRow) {
    const ok = await confirm({
      title: '파일 기록 삭제',
      description: `"${f.original_name}" 파일 기록을 정말 삭제할까요? (파일 원본은 별도 저장소를 참조합니다)`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (ok) deleteMutation.mutate(f.id);
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-fg flex items-center gap-1.5">
            <FolderOpen size={14} /> 보관된 파일
          </h3>
          <select
            value={filterTopicId === 'ALL' ? 'ALL' : String(filterTopicId)}
            onChange={(e) =>
              setFilterTopicId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
            }
            className="input text-xs py-1 w-48"
            aria-label="주제 필터"
          >
            <option value="ALL">모든 주제</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-primary text-xs flex items-center gap-1"
          onClick={() => setUploading(true)}
        >
          <FilePlus2 size={12} /> 파일 등록
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        {filesQuery.isLoading ? (
          <LoadingPanel label="파일 목록을 불러오는 중…" />
        ) : files.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title="등록된 파일이 없습니다"
            hint="'파일 등록' 버튼으로 보고서 파일과 메타데이터를 추가하세요."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-bg-soft/50 text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">파일명</th>
                  <th className="px-3 py-2 text-left font-medium">분류</th>
                  <th className="px-3 py-2 text-left font-medium">연결 주제</th>
                  <th className="px-3 py-2 text-left font-medium">설명</th>
                  <th className="px-3 py-2 text-left font-medium">크기</th>
                  <th className="px-3 py-2 text-left font-medium">업로드</th>
                  <th className="px-3 py-2 text-right font-medium">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {files.map((f) => {
                  const isAuto = Boolean(f.auto_generated);
                  return (
                    <tr key={f.id} className="hover:bg-bg-soft/40">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <div className="font-medium text-fg truncate max-w-[220px]">
                            {f.original_name}
                          </div>
                          {isAuto && (
                            <span
                              title="최종 승인된 과제에서 자동 보관된 항목입니다. 과제 상태가 승인완료에서 벗어나면 자동 삭제됩니다."
                              className="rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300"
                            >
                              자동
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-fg-subtle">
                          {isAuto
                            ? f.source_assignment_code
                              ? `과제 ${f.source_assignment_code}`
                              : '승인된 과제에서 자동 보관'
                            : f.mime_type ?? '—'}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'rounded border px-1.5 py-0.5 text-[10px]',
                            CATEGORY_TONE[f.category],
                          )}
                        >
                          {CATEGORY_LABEL[f.category]}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-fg-muted max-w-[200px] truncate">
                        {f.topic_title ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-fg-muted max-w-[220px] truncate">
                        {f.description ?? '—'}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-fg-subtle">
                        {fmtFileSize(f.size_bytes)}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-fg-subtle">
                        <div>{fmtDateTime(f.uploaded_at)}</div>
                        {f.uploader_name && (
                          <div className="text-[10px] text-fg-subtle">
                            by {f.uploader_name}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isAuto ? (
                          <span
                            className="text-[10px] text-fg-subtle italic"
                            title="자동 보관된 항목은 과제 상태 변경으로만 제거됩니다."
                          >
                            자동 관리
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn-ghost text-xs text-rose-300 inline-flex items-center gap-1"
                            onClick={() => handleDelete(f)}
                          >
                            <Trash2 size={12} /> 삭제
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <FileUploadModal
        studentId={studentId}
        currentUserId={currentUserId}
        topics={topics}
        defaultTopicId={filterTopicId === 'ALL' ? null : filterTopicId}
        open={uploading}
        onClose={() => setUploading(false)}
      />
    </section>
  );
}

// -----------------------------------------------------------------------------
// File upload modal — metadata form
// -----------------------------------------------------------------------------

function FileUploadModal({
  studentId,
  currentUserId,
  topics,
  defaultTopicId,
  open,
  onClose,
}: {
  studentId: number;
  currentUserId: number;
  topics: TopicRow[];
  defaultTopicId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const api = getApi()!;
  const [file, setFile] = useState<File | null>(null);
  const [originalName, setOriginalName] = useState('');
  const [category, setCategory] = useState<ArchiveCategory>('report');
  const [topicId, setTopicId] = useState<number | null>(defaultTopicId ?? null);
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);

  useMemoResetFileModal(open, defaultTopicId, {
    setFile,
    setOriginalName,
    setCategory,
    setTopicId,
    setDescription,
    setTouched,
  });

  const nameErr =
    touched &&
    firstError<string>([required('파일명은 필수입니다')])(originalName);

  const upload = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.students.addArchiveFile>[0]) =>
      api.students.addArchiveFile(payload),
    successMessage: '파일을 등록했습니다',
    errorMessage: '파일 등록에 실패했습니다',
    invalidates: [
      ['students.files', studentId],
      ['students.list'],
      ['students.topics', studentId],
    ],
    onSuccess: () => onClose(),
  });

  function submit() {
    setTouched(true);
    if (nameErr) return;
    const name = originalName.trim() || file?.name || '';
    if (!name) return;
    upload.mutate({
      studentId,
      topicId,
      category,
      originalName: name,
      storedPath: `local://${name}`,
      mimeType: file?.type || undefined,
      sizeBytes: file?.size,
      description: description.trim() || null,
      uploaderId: currentUserId,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="보고서 파일 등록"
      size="md"
      footer={
        <>
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={submit}
            disabled={upload.isPending}
          >
            {upload.isPending ? '등록 중…' : '등록'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <FormField label="파일 선택" hint="파일 원본은 자료실에 별도 저장됩니다. 여기서는 메타데이터만 기록합니다.">
          {(slot) => (
            <div className="flex items-center gap-2">
              <label
                htmlFor={slot.id}
                className="btn-outline text-xs inline-flex items-center gap-1 cursor-pointer"
              >
                <FilePlus2 size={12} /> 파일 찾기
              </label>
              <input
                id={slot.id}
                type="file"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f) setOriginalName(f.name);
                }}
              />
              {file ? (
                <span className="text-xs text-fg-muted truncate max-w-[240px]">
                  {file.name}{' '}
                  <span className="text-fg-subtle">({fmtFileSize(file.size)})</span>
                </span>
              ) : (
                <span className="text-[11px] text-fg-subtle">선택된 파일 없음</span>
              )}
              {file && (
                <button
                  type="button"
                  className="text-fg-subtle hover:text-fg"
                  onClick={() => {
                    setFile(null);
                  }}
                  aria-label="파일 선택 취소"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          )}
        </FormField>
        <FormField label="파일명" required error={nameErr || null}>
          {(slot) => (
            <TextInput
              {...slot}
              value={originalName}
              onChange={(e) => setOriginalName(e.target.value)}
              placeholder="예: 화학수행_이온결합_최종.docx"
              maxLength={200}
            />
          )}
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="분류">
            {(slot) => (
              <SelectInput
                {...slot}
                value={category}
                onChange={(e) => setCategory(e.target.value as ArchiveCategory)}
              >
                {(Object.keys(CATEGORY_LABEL) as ArchiveCategory[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>
          <FormField label="연결 주제">
            {(slot) => (
              <SelectInput
                {...slot}
                value={topicId === null ? '' : String(topicId)}
                onChange={(e) =>
                  setTopicId(e.target.value === '' ? null : Number(e.target.value))
                }
              >
                <option value="">(선택 안 함)</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </SelectInput>
            )}
          </FormField>
        </div>
        <FormField label="설명" hint="파일에 대한 짧은 메모. 검색/정리에 사용됩니다.">
          {(slot) => (
            <Textarea
              {...slot}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="예: 교사 피드백 반영한 최종본"
              rows={2}
              maxLength={500}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Tiny hook helpers — kept in-file to avoid over-abstraction.
// -----------------------------------------------------------------------------

function useMemoDebounce(value: string, set: (s: string) => void, delay: number) {
  useEffect(() => {
    const id = setTimeout(() => set(value), delay);
    return () => clearTimeout(id);
  }, [value, delay, set]);
}

function useMemoAutoSelect(
  rows: StudentListRow[],
  selected: number | null,
  setSelected: (id: number | null) => void,
) {
  useEffect(() => {
    if (selected !== null) {
      if (!rows.some((r) => r.id === selected)) {
        setSelected(rows[0]?.id ?? null);
      }
      return;
    }
    if (rows.length > 0) setSelected(rows[0].id);
  }, [rows, selected, setSelected]);
}

function useMemoResetModal(
  open: boolean,
  editing: TopicRow | null,
  setters: {
    setTitle: (s: string) => void;
    setSubject: (s: string) => void;
    setTopic: (s: string) => void;
    setStatus: (s: TopicStatus) => void;
    setAssignmentId: (s: number | null) => void;
    setDueAt: (s: string) => void;
    setSubmittedAt: (s: string) => void;
    setScore: (s: string) => void;
    setMemo: (s: string) => void;
    setTouched: (v: boolean) => void;
  },
) {
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setters.setTitle(editing.title ?? '');
      setters.setSubject(editing.subject ?? '');
      setters.setTopic(editing.topic ?? '');
      setters.setStatus(editing.status);
      setters.setAssignmentId(editing.assignment_id ?? null);
      setters.setDueAt(editing.due_at ? editing.due_at.slice(0, 10) : '');
      setters.setSubmittedAt(editing.submitted_at ? editing.submitted_at.slice(0, 10) : '');
      setters.setScore(editing.score ?? '');
      setters.setMemo(editing.memo ?? '');
    } else {
      setters.setTitle('');
      setters.setSubject('');
      setters.setTopic('');
      setters.setStatus('planned');
      setters.setAssignmentId(null);
      setters.setDueAt('');
      setters.setSubmittedAt('');
      setters.setScore('');
      setters.setMemo('');
    }
    setters.setTouched(false);
  }, [open, editing, setters]);
}

function useMemoResetFileModal(
  open: boolean,
  defaultTopicId: number | null,
  setters: {
    setFile: (f: File | null) => void;
    setOriginalName: (s: string) => void;
    setCategory: (c: ArchiveCategory) => void;
    setTopicId: (id: number | null) => void;
    setDescription: (s: string) => void;
    setTouched: (v: boolean) => void;
  },
) {
  useEffect(() => {
    if (!open) return;
    setters.setFile(null);
    setters.setOriginalName('');
    setters.setCategory('report');
    setters.setTopicId(defaultTopicId);
    setters.setDescription('');
    setters.setTouched(false);
  }, [open, defaultTopicId, setters]);
}

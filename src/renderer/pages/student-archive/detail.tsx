import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import {
  ClipboardList,
  Edit3,
  FileSearch,
  FilePlus2,
  FileText,
  FolderOpen,
  Globe,
  GraduationCap,
  Hash,
  MessageSquare,
  Phone,
  Plus,
  School,
  Sparkles,
  StickyNote,
  Trash2,
  User2,
} from 'lucide-react';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { cn } from '@/lib/cn';
import { TOPIC_STATUS, studentIdsKey, uniqText, uniqueById, sortIsoDesc } from './model';
import type {
  ArchiveCategory,
  ArchiveFileRow,
  AssignmentRow,
  CounselingLogRow,
  GradeRow,
  ParsingDetail,
  ParsingJsonDraft,
  ParsingRow,
  StudentDetail,
  StudentGroupRow,
  StudentListRow,
  Tab,
  TopicRow,
  TopicStatus,
} from './model';

import { ParsingTab } from './parsing';
import { TopicsTab } from './topics';
import { FilesTab } from './files';
import { StudentEditModal } from './student-form';
import { GradesTab } from './grades';
import { CounselingTab } from './counseling';

// -----------------------------------------------------------------------------
// Detail pane (tabs)
// -----------------------------------------------------------------------------

export function StudentDetailPanel({
  studentId,
  studentIds,
  groupRows,
  tab,
  setTab,
  currentUserId,
  currentUserRole,
  onDeleted,
}: {
  studentId: number;
  studentIds: number[];
  groupRows: StudentListRow[];
  tab: Tab;
  setTab: (t: Tab) => void;
  currentUserId: number;
  currentUserRole: string;
  onDeleted?: () => void;
}) {
  const api = getApi()!;
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);

  const studentQuery = useQuery({
    queryKey: ['students.get', currentUserId, currentUserRole, studentId],
    queryFn: () => api.students.get(studentId) as unknown as Promise<StudentDetail | null>,
  });

  const deleteMutation = useMutationWithToast({
    mutationFn: (id: number) =>
      api.students.softDelete({ id, actorId: currentUserId }),
    successMessage: '학생을 삭제했습니다',
    errorMessage: '학생 삭제에 실패했습니다',
    invalidates: [
      ['students.list'],
      ['students.get'],
    ],
    onSuccess: () => {
      if (onDeleted) onDeleted();
    },
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

  async function handleDelete(s: StudentDetail) {
    const ok = await confirm({
      title: '학생 삭제',
      description: `"${s.name}" 학생을 삭제할까요? 학생 데이터(과제·파싱·주제·파일·내신·상담)는 그대로 보존되며 목록에서만 숨겨집니다.`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (ok) deleteMutation.mutate(s.id);
  }

  return (
    <div className="space-y-3">
      <StudentHeader
        student={student}
        groupRows={groupRows}
        onEdit={() => setEditing(true)}
        onDelete={() => handleDelete(student)}
      />
      <nav className="card p-1 flex items-center gap-1 text-xs flex-wrap">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>
          기본 정보
        </TabButton>
        <TabButton active={tab === 'grades'} onClick={() => setTab('grades')}>
          내신 성적
        </TabButton>
        <TabButton active={tab === 'counseling'} onClick={() => setTab('counseling')}>
          상담 이력
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

      {tab === 'overview' && (
        <OverviewTab studentId={studentId} student={student} groupRows={groupRows} />
      )}
      {tab === 'grades' && (
        <GradesTab studentId={studentId} studentIds={studentIds} currentUserId={currentUserId} />
      )}
      {tab === 'counseling' && (
        <CounselingTab studentId={studentId} studentIds={studentIds} currentUserId={currentUserId} />
      )}
      {tab === 'parsing' && <ParsingTab studentId={studentId} studentIds={studentIds} />}
      {tab === 'topics' && (
        <TopicsTab studentId={studentId} studentIds={studentIds} currentUserId={currentUserId} />
      )}
      {tab === 'files' && (
        <FilesTab studentId={studentId} studentIds={studentIds} currentUserId={currentUserId} />
      )}

      <StudentEditModal
        open={editing}
        mode="edit"
        initial={student}
        currentUserId={currentUserId}
        onClose={() => setEditing(false)}
      />
    </div>
  );
}

function StudentHeader({
  student,
  groupRows,
  onEdit,
  onDelete,
}: {
  student: StudentDetail;
  groupRows: StudentListRow[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const fromNotion = Boolean(student.notion_page_id);
  const groupCodes = uniqText(groupRows.map((row) => row.student_code));
  const groupGrades = uniqText(groupRows.map((row) => row.grade));
  return (
    <header className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xl font-semibold text-fg">
            {student.name}
            <span className="rounded border border-border bg-bg-soft px-2 py-0.5 text-[11px] font-normal text-fg-muted tabular-nums">
              {student.student_code}
            </span>
            {groupRows.length > 1 && (
              <span className="rounded border border-sky-500/30 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-normal text-sky-300">
                동일 학생 {groupRows.length}건 묶음
              </span>
            )}
            {fromNotion && (
              <span
                className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-normal text-indigo-300"
                title={
                  student.notion_synced_at
                    ? `노션 동기화: ${fmtDateTime(student.notion_synced_at)}`
                    : '노션에서 동기화된 학생입니다.'
                }
              >
                <Globe size={10} /> 노션
                {student.notion_source ? ` · ${student.notion_source}` : ''}
              </span>
            )}
            {student.deleted_at && (
              <span className="rounded border border-rose-500/30 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-normal text-rose-300">
                삭제됨
              </span>
            )}
          </div>
          {groupRows.length > 1 && (
            <div className="mt-1 text-[11px] text-fg-subtle">
              코드 {groupCodes.join(' · ')} · 학년 {groupGrades.join(' · ') || '-'}
            </div>
          )}
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
            {student.school_no && (
              <span className="inline-flex items-center gap-1">
                <Hash size={11} /> 학번 {student.school_no}
              </span>
            )}
            {student.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone size={11} /> 학생 {student.phone}
              </span>
            )}
            {student.guardian && (
              <span className="inline-flex items-center gap-1">
                <User2 size={11} /> 보호자 {student.guardian}
              </span>
            )}
            {student.guardian_phone && (
              <span className="inline-flex items-center gap-1">
                <Phone size={11} /> 보호자 {student.guardian_phone}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              className="btn-outline text-xs inline-flex items-center gap-1"
              onClick={onEdit}
            >
              <Edit3 size={12} /> 수정
            </button>
            <button
              type="button"
              className="btn-outline text-xs text-rose-300 inline-flex items-center gap-1"
              onClick={onDelete}
              disabled={Boolean(student.deleted_at)}
              title={student.deleted_at ? '이미 삭제된 학생입니다.' : undefined}
            >
              <Trash2 size={12} /> 삭제
            </button>
          </div>
          <div className="text-[11px] text-fg-subtle">
            등록: {fmtDate(student.created_at)}
          </div>
        </div>
      </div>
      {(student.grade_memo || student.memo) && (
        <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs text-fg-muted">
          {student.grade_memo && (
            <p className="flex gap-2">
              <StickyNote size={12} className="mt-0.5 shrink-0 text-amber-300" />
              <span className="whitespace-pre-line">
                <span className="text-[10px] text-fg-subtle mr-1">[내신]</span>
                {student.grade_memo}
              </span>
            </p>
          )}
          {student.memo && (
            <p className="flex gap-2">
              <StickyNote size={12} className="mt-0.5 shrink-0" />
              <span className="whitespace-pre-line">{student.memo}</span>
            </p>
          )}
        </div>
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
  groupRows,
}: {
  studentId: number;
  student: StudentDetail;
  groupRows: StudentListRow[];
}) {
  const api = getApi()!;
  const studentIds = groupRows.length > 0 ? groupRows.map((row) => row.id) : [studentId];
  const groupKey = studentIdsKey(studentIds);
  const historyQuery = useQuery({
    queryKey: ['students.history.grouped', groupKey],
    queryFn: async () => {
      const histories = await Promise.all(
        studentIds.map((id) =>
          api.students.history(id) as unknown as Promise<{
            assignments: AssignmentRow[];
            parsings: ParsingRow[];
          }>,
        ),
      );
      return {
        assignments: uniqueById(histories.flatMap((item) => item.assignments)),
        parsings: sortIsoDesc(
          uniqueById(histories.flatMap((item) => item.parsings)),
          (row) => row.parsed_at,
        ),
      };
    },
  });
  const topicsQuery = useQuery({
    queryKey: ['students.topics.grouped', groupKey],
    queryFn: async () =>
      sortIsoDesc(
        uniqueById(
          (await Promise.all(
            studentIds.map((id) =>
              api.students.listReportTopics(id) as unknown as Promise<TopicRow[]>,
            ),
          )).flat(),
        ),
        (row) => row.updated_at,
      ),
  });
  const filesQuery = useQuery({
    queryKey: ['students.files.grouped', groupKey, null],
    queryFn: async () =>
      sortIsoDesc(
        uniqueById(
          (await Promise.all(
            studentIds.map((id) =>
              api.students.listArchiveFiles({ studentId: id }) as unknown as Promise<ArchiveFileRow[]>,
            ),
          )).flat(),
        ),
        (row) => row.uploaded_at,
      ),
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

export function StatusBadge({ status }: { status: TopicStatus }) {
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

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, FileDown, FileSearch, FileText, Sparkles, X } from 'lucide-react';
import { getApi } from '@/hooks/useApi';
import { useSession } from '@/stores/session';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { fmtDate, fmtDateTime } from '@/lib/date';
import { cn } from '@/lib/cn';
import {
  appendParsingMemo,
  archiveCategoryForParsingFile,
  buildParsingJsonDraft,
  buildParsingTopicBody,
  fmtConfidence,
  fmtFileSize,
  jsonFiles,
  labeledLines,
  parseJsonRecord,
  sortIsoDesc,
  studentIdsKey,
  uniqText,
  uniqueById,
} from './model';
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

function downloadJsonFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, '_') || 'parsing-result.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}


export function ParsingTab({ studentId, studentIds }: { studentId: number; studentIds: number[] }) {
  const api = getApi()!;
  const [parsingDetailId, setParsingDetailId] = useState<number | null>(null);
  const groupKey = studentIdsKey(studentIds.length > 0 ? studentIds : [studentId]);

  const historyQuery = useQuery({
    queryKey: ['students.history.grouped', groupKey],
    queryFn: async () => {
      const histories = await Promise.all(
        (studentIds.length > 0 ? studentIds : [studentId]).map((id) =>
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
  const { user } = useSession();
  const currentUserId = user?.id ?? 0;
  const currentUserRole = user?.role ?? '';
  const detailQuery = useQuery({
    queryKey: ['students.parsingDetail', parsingId],
    queryFn: () =>
      api.students.getParsingDetail(parsingId!) as unknown as Promise<ParsingDetail | null>,
    enabled: parsingId !== null,
  });

  const open = parsingId !== null;
  const d = detailQuery.data;
  const draft = useMemo(() => buildParsingJsonDraft(d), [d]);
  const targetStudentId = d?.student_id ?? null;
  const canApply = Boolean(d && targetStudentId && currentUserId);

  const studentQuery = useQuery({
    queryKey: ['students.get', currentUserId, currentUserRole, targetStudentId],
    queryFn: () => api.students.get(targetStudentId!) as unknown as Promise<StudentDetail | null>,
    enabled: Boolean(targetStudentId),
  });

  const updateStudentMutation = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.students.update>[0]) => api.students.update(payload),
    successMessage: '학생 기본 정보를 반영했습니다',
    errorMessage: '학생 기본 정보 반영에 실패했습니다',
    invalidates: targetStudentId
      ? [['students.get'], ['students.list']]
      : [['students.list']],
  });

  const addTopicMutation = useMutationWithToast({
    mutationFn: (payload: Parameters<typeof api.students.upsertReportTopic>[0]) =>
      api.students.upsertReportTopic(payload),
    successMessage: '보고서 주제를 생성했습니다',
    errorMessage: '보고서 주제 생성에 실패했습니다',
    invalidates: targetStudentId
      ? [['students.topics', targetStudentId], ['students.list']]
      : [['students.list']],
  });

  type ArchiveFilePayload = Parameters<typeof api.students.addArchiveFile>[0];
  const addFileMutation = useMutationWithToast({
    mutationFn: async (payloads: ArchiveFilePayload[]) => {
      const results = [];
      for (const payload of payloads) {
        const result = await api.students.addArchiveFile(payload);
        if (!result.ok) throw new Error(result.error ?? 'add_failed');
        results.push(result);
      }
      return results;
    },
    successMessage: '보고서 파일 기록을 추가했습니다',
    errorMessage: '보고서 파일 기록 추가에 실패했습니다',
    invalidates: targetStudentId
      ? [['students.files', targetStudentId], ['students.list']]
      : [['students.list']],
  });

  const pretty = useMemo(() => {
    if (!d?.content_json) return '';
    try {
      return JSON.stringify(JSON.parse(d.content_json), null, 2);
    } catch {
      return d.content_json;
    }
  }, [d]);

  const jsonFileName = useMemo(() => {
    if (!d) return 'parsing-result.json';
    const base = `${d.assignment_code || 'assignment'}-parsing-${d.id}`;
    return `${base.replace(/[\\/:*?"<>|]+/g, '_')}.json`;
  }, [d]);

  function applyStudentInfo() {
    if (!d || !targetStudentId || !currentUserId) return;
    const existing = studentQuery.data;
    updateStudentMutation.mutate({
      id: targetStudentId,
      phone: existing?.phone ? undefined : draft.studentPhone || undefined,
      guardianPhone: existing?.guardian_phone ? undefined : draft.guardianPhone || undefined,
      memo: appendParsingMemo(existing?.memo, d, draft),
      actorId: currentUserId,
    });
  }

  function addReportTopic() {
    if (!d || !targetStudentId || !currentUserId) return;
    addTopicMutation.mutate({
      studentId: targetStudentId,
      title: draft.assignmentTitle || d.assignment_title,
      subject: draft.subject || d.assignment_subject || null,
      topic: buildParsingTopicBody(draft) || null,
      status: 'planned',
      assignmentId: d.assignment_id,
      dueAt: d.assignment_due_at ?? null,
      submittedAt: null,
      score: null,
      memo:
        labeledLines([
          ['원본 파일', draft.sourceFile],
          ['원본 행', draft.sourceRow],
          ['파싱 결과', `#${d.id}`],
          ['과제 코드', d.assignment_code],
        ]) || null,
      actorId: currentUserId,
    });
  }

  function addJsonFileRecord() {
    if (!d || !targetStudentId || !currentUserId) return;
    const notionFiles: ArchiveFilePayload[] = draft.files.map((file) => ({
      studentId: targetStudentId,
      topicId: null,
      category: archiveCategoryForParsingFile(file),
      originalName: file.name,
      storedPath: file.url,
      mimeType: undefined,
      sizeBytes: undefined,
      description:
        labeledLines([
          ['Notion 파일', file.kind || 'attachment'],
          ['만료', file.expires || ''],
          ['보고서 주제', draft.assignmentTitle || d.assignment_title],
          ['과목', draft.subject || d.assignment_subject],
        ]) || null,
      uploaderId: currentUserId,
    }));
    const fallbackJson: ArchiveFilePayload = {
      studentId: targetStudentId,
      topicId: null,
      category: 'reference',
      originalName: jsonFileName,
      storedPath: `local://parsing-results/${d.id}.json`,
      mimeType: 'application/json',
      sizeBytes: new TextEncoder().encode(d.content_json ?? '').length,
      description:
        labeledLines([
          ['원본 파일', draft.sourceFile],
          ['원본 행', draft.sourceRow],
          ['보고서 주제', draft.assignmentTitle || d.assignment_title],
          ['과목', draft.subject || d.assignment_subject],
        ]) || '파싱 결과 원본 JSON',
      uploaderId: currentUserId,
    };
    addFileMutation.mutate(notionFiles.length > 0 ? notionFiles : [fallbackJson]);
  }

  return (
    <Modal open={open} onClose={onClose} title="파싱 결과 상세" size="xl">
      {detailQuery.isLoading ? (
        <LoadingPanel label="상세 정보를 불러오는 중..." />
      ) : !d ? (
        <p className="text-sm text-fg-muted">상세 정보를 찾을 수 없습니다.</p>
      ) : (
        <div className="space-y-3 text-sm max-h-[78vh] overflow-y-auto pr-1">
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
            <Info label="파서">{d.parser_name ?? '-'}</Info>
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
          <div className="rounded border border-border bg-bg-soft/40 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-semibold text-fg">원본 JSON 반영</h4>
                <p className="mt-0.5 text-[11px] text-fg-subtle">
                  학생 연락처, 학부모 연락처, 진로, 보고서 주제, Notion 파일 링크를 원본 데이터에서 읽어옵니다.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={applyStudentInfo}
                  disabled={!canApply || updateStudentMutation.isPending}
                >
                  기본 정보 반영
                </button>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={addReportTopic}
                  disabled={!canApply || addTopicMutation.isPending}
                >
                  보고서 주제 생성
                </button>
                <button
                  type="button"
                  className="btn-outline text-xs"
                  onClick={addJsonFileRecord}
                  disabled={!canApply || addFileMutation.isPending}
                >
                  보고서 파일 기록
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Info label="학생 코드">{draft.studentCode || '-'}</Info>
              <Info label="학생 연락처">{draft.studentPhone || '-'}</Info>
              <Info label="학부모 연락처">{draft.guardianPhone || '-'}</Info>
              <Info label="진로">{draft.career || '-'}</Info>
              <Info label="과목">{draft.subject || '-'}</Info>
              <Info label="출판사">{draft.publisher || '-'}</Info>
              <Info label="보고서 주제">{draft.assignmentTitle || '-'}</Info>
              <Info label="원본 파일">{draft.sourceFile || '-'}</Info>
              <Info label="원본 행">{draft.sourceRow || '-'}</Info>
            </div>
            {draft.files.length > 0 && (
              <div className="mt-3 border-t border-border pt-3">
                <h5 className="mb-2 text-xs font-semibold text-fg">Notion 파일</h5>
                <ul className="space-y-1 text-xs">
                  {draft.files.map((file, index) => (
                    <li
                      key={`${file.url}-${index}`}
                      className="flex items-center justify-between gap-2 rounded border border-border bg-bg px-2 py-1.5"
                    >
                      <span className="min-w-0 truncate text-fg-muted">
                        {file.name} {file.kind ? `· ${file.kind}` : ''}
                      </span>
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-accent hover:underline"
                      >
                        다운로드
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <h4 className="text-xs font-medium text-fg-muted">원본 데이터 (JSON)</h4>
              <button
                type="button"
                className="btn-outline text-xs inline-flex items-center gap-1"
                onClick={() => downloadJsonFile(jsonFileName, pretty || d.content_json || '')}
              >
                <FileDown size={12} /> JSON 다운로드
              </button>
            </div>
            <pre className="rounded border border-border bg-bg-soft/50 p-3 text-[11px] text-fg whitespace-pre-wrap break-all max-h-[360px] overflow-auto">
              {pretty || '-'}
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

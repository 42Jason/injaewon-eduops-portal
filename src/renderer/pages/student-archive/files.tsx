import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, FolderOpen, Plus, Trash2, X } from 'lucide-react';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { firstError, required } from '@/lib/validators';
import { fmtDateTime } from '@/lib/date';
import { cn } from '@/lib/cn';
import { CATEGORY_LABEL, CATEGORY_TONE, fmtFileSize, isExternalUrl, sortIsoDesc, studentIdsKey, uniqueById } from './model';
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

import { useMemoResetFileModal } from './hooks';

export function FilesTab({
  studentId,
  studentIds,
  currentUserId,
}: {
  studentId: number;
  studentIds?: number[];
  currentUserId: number;
}) {
  const api = getApi()!;
  const confirm = useConfirm();
  const [filterTopicId, setFilterTopicId] = useState<number | 'ALL'>('ALL');
  const [uploading, setUploading] = useState(false);

  const ids = studentIds && studentIds.length > 0 ? studentIds : [studentId];
  const groupKey = studentIdsKey(ids);

  const topicsQuery = useQuery({
    queryKey: ['students.topics.grouped', groupKey],
    queryFn: async () =>
      sortIsoDesc(
        uniqueById(
          (await Promise.all(
            ids.map((id) => api.students.listReportTopics(id) as unknown as Promise<TopicRow[]>),
          )).flat(),
        ),
        (row) => row.updated_at,
      ),
  });
  const topics = topicsQuery.data ?? [];

  const filesQuery = useQuery({
    queryKey: ['students.files.grouped', groupKey, filterTopicId],
    queryFn: async () =>
      sortIsoDesc(
        uniqueById(
          (await Promise.all(
            ids.map((id) =>
              api.students.listArchiveFiles({
                studentId: id,
                topicId: filterTopicId === 'ALL' ? null : filterTopicId,
              }) as unknown as Promise<ArchiveFileRow[]>,
            ),
          )).flat(),
        ),
        (row) => row.uploaded_at,
      ),
  });
  const files = filesQuery.data ?? [];

  const deleteMutation = useMutationWithToast({
    mutationFn: (id: number) =>
      api.students.deleteArchiveFile({ id, actorId: currentUserId }),
    successMessage: '파일 기록을 삭제했습니다',
    errorMessage: '삭제에 실패했습니다',
    invalidates: [
      ['students.files', studentId],
      ['students.files.grouped'],
      ['students.list'],
      ['students.topics', studentId],
      ['students.topics.grouped'],
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
                          {isExternalUrl(f.stored_path) ? (
                            <a
                              href={f.stored_path}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-accent hover:underline truncate max-w-[220px]"
                            >
                              {f.original_name}
                            </a>
                          ) : (
                            <div className="font-medium text-fg truncate max-w-[220px]">
                              {f.original_name}
                            </div>
                          )}
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
                            : isExternalUrl(f.stored_path)
                            ? '다운로드 가능'
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
      ['students.files.grouped'],
      ['students.list'],
      ['students.topics', studentId],
      ['students.topics.grouped'],
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

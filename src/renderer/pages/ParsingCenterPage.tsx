import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileSpreadsheet, UploadCloud, CheckCircle2, AlertTriangle, X,
  Sparkles, RotateCcw, Download, Info, Inbox,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';
import { relative } from '@/lib/date';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useToast } from '@/stores/toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';

type Row = ParsingPreviewRow;

interface PreviewState {
  sheetName: string;
  filename: string;
  headerRow: number;
  warnings: string[];
  availableSheets: string[];
  rows: Row[];
}

type RowKey =
  | 'subject'
  | 'publisher'
  | 'studentCode'
  | 'assignmentTitle'
  | 'assignmentScope'
  | 'lengthRequirement'
  | 'outline'
  | 'rubric'
  | 'teacherRequirements'
  | 'studentRequests';

const FIELDS: Array<{ key: RowKey; label: string; short: string; min?: number }> = [
  { key: 'subject',             label: '과목',       short: '과목',   min: 80 },
  { key: 'publisher',           label: '출판사',     short: '출판사', min: 90 },
  { key: 'studentCode',         label: '학생',       short: '학생',   min: 80 },
  { key: 'assignmentTitle',     label: '수행평가명', short: '평가명', min: 160 },
  { key: 'assignmentScope',     label: '수행범위',   short: '범위',   min: 110 },
  { key: 'lengthRequirement',   label: '분량',       short: '분량',   min: 70 },
  { key: 'outline',             label: '개요',       short: '개요',   min: 150 },
  { key: 'rubric',              label: '평가기준',   short: '평가기준', min: 140 },
  { key: 'teacherRequirements', label: '교사요구',   short: '교사요구', min: 130 },
  { key: 'studentRequests',     label: '학생요구',   short: '학생요구', min: 120 },
];

export function ParsingCenterPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api;
  const toast = useToast();
  const confirm = useConfirm();

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [commitResult, setCommitResult] = useState<{
    created: number;
    skipped: number;
    codes: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const previewMut = useMutationWithToast({
    mutationFn: async (file: File) => {
      if (!api) throw new Error('이 기능은 Electron 실행 환경에서만 사용할 수 있습니다.');
      const buffer = await file.arrayBuffer();
      const res = await api.parsing.preview({ buffer, filename: file.name });
      if (!res.ok) throw new Error(res.error ?? '파싱 실패');
      return res;
    },
    successMessage: false,
    errorMessage: '엑셀 파싱에 실패했습니다',
    onSuccess: (res) => {
      setCommitResult(null);
      const rows = res.rows ?? [];
      setPreview({
        sheetName:       res.sheetName ?? '',
        filename:        res.filename ?? '',
        headerRow:       res.headerRow ?? 7,
        warnings:        res.warnings ?? [],
        availableSheets: res.availableSheets ?? [],
        rows,
      });
      const valid = rows.filter((r) => r.valid).length;
      toast.ok(`미리보기 ${rows.length}행 (유효 ${valid}) 준비 완료`);
    },
  });

  const commitMut = useMutationWithToast({
    mutationFn: async () => {
      if (!api || !preview || !user) throw new Error('로그인/실행 환경을 확인하세요.');
      const validRows = preview.rows.filter((r) => r.valid);
      if (validRows.length === 0) throw new Error('커밋 가능한 유효 행이 없습니다.');
      const res = await api.parsing.commit({
        rows: validRows as unknown as Array<Record<string, unknown>>,
        uploaderId: user.id,
        filename: preview.filename,
      });
      if (!res.ok) throw new Error(res.error ?? '저장 실패');
      return res;
    },
    successMessage: false,
    errorMessage: '저장에 실패했습니다',
    invalidates: [
      ['assignments.list'],
      ['home.stats'],
      ['parsing.recent'],
    ],
    onSuccess: (res) => {
      const created = res.created?.length ?? 0;
      const skipped = res.skipped?.length ?? 0;
      setCommitResult({
        created,
        skipped,
        codes:   res.created?.map((c) => c.code) ?? [],
      });
      toast.ok(
        skipped > 0
          ? `${created}건 과제 등록 · ${skipped}건 제외됨`
          : `${created}건 과제 등록 완료`,
      );
    },
  });

  const recentQuery = useQuery({
    queryKey: ['parsing.recent'],
    queryFn: () => api!.parsing.recent() as Promise<Array<Record<string, unknown>>>,
    enabled: live,
  });

  function onFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const f = files[0];
    if (!/\.xlsx?$/i.test(f.name)) {
      toast.err('엑셀 파일(.xlsx / .xls) 만 업로드할 수 있습니다.');
      return;
    }
    previewMut.mutate(f);
  }

  async function reset() {
    if (preview || commitResult) {
      const ok = await confirm({
        title: '미리보기를 초기화할까요?',
        description: '현재 표시된 파싱 결과가 사라집니다. 커밋되지 않은 행은 복구할 수 없습니다.',
        confirmLabel: '초기화',
        tone: 'warn',
      });
      if (!ok) return;
    }
    setPreview(null);
    setCommitResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const counts = useMemo(() => {
    if (!preview) return { total: 0, valid: 0, invalid: 0 };
    const valid = preview.rows.filter((r) => r.valid).length;
    return {
      total:   preview.rows.length,
      valid,
      invalid: preview.rows.length - valid,
    };
  }, [preview]);

  return (
    <div className="flex h-full min-h-[calc(100vh-7rem)] flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileSpreadsheet size={18} className="text-fg-subtle" />
          <h2 className="text-lg font-semibold text-fg">안내문 파싱 센터</h2>
          <span className="text-xs text-fg-subtle">
            Excel 업로드 → 10필드 자동 추출 → 과제 일괄 등록
          </span>
        </div>
        <div
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
            live
              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
              : 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
          )}
          role="status"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {live ? '실시간 DB' : 'Electron 실행 필요'}
        </div>
      </div>

      <div className="grid flex-1 grid-cols-12 gap-3 overflow-hidden">
        {/* LEFT — upload + instructions */}
        <div className="col-span-4 flex flex-col gap-3 overflow-y-auto">
          <div className="card">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              1. Excel 업로드
            </div>
            <label
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
                'focus-within:ring-2 focus-within:ring-accent/40',
                previewMut.isPending
                  ? 'border-accent/50 bg-accent/5 opacity-70 cursor-wait'
                  : 'border-border hover:border-accent/50 hover:bg-bg-soft/40',
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="sr-only"
                onChange={(e) => onFilesPicked(e.target.files)}
                disabled={!live || previewMut.isPending}
                aria-label="엑셀 파일 선택"
              />
              {previewMut.isPending ? (
                <Spinner size={28} className="mb-2 text-accent" label="파싱 중" />
              ) : (
                <UploadCloud size={28} className="mb-2 text-fg-subtle" aria-hidden="true" />
              )}
              <div className="text-sm font-medium text-fg">
                {previewMut.isPending ? '파싱 중…' : '클릭하여 파일 선택'}
              </div>
              <div className="mt-1 text-[11px] text-fg-subtle">
                .xlsx / .xls · 시트 &quot;예시 포함&quot; · 7행 헤더 · 8~17행 데이터
              </div>
            </label>

            {previewMut.isError && (
              <div
                className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"
                role="alert"
              >
                {(previewMut.error as Error)?.message ?? '업로드 실패'}
              </div>
            )}
          </div>

          <div className="card text-xs leading-relaxed text-fg-muted">
            <div className="mb-1 flex items-center gap-1 font-semibold text-fg-subtle">
              <Info size={11} aria-hidden="true" /> 파싱 규칙
            </div>
            <ul className="list-disc pl-4 space-y-1">
              <li>시트명이 <code className="font-mono text-fg">예시 포함</code> 이면 우선 사용됩니다. 없으면 첫 시트를 사용하고 경고를 표시합니다.</li>
              <li>7행(헤더)을 감지하지 못하면 1~12행 내에서 헤더 키워드(과목/수행평가명 등)를 탐색합니다.</li>
              <li>데이터는 <b>최대 10건</b> (8~17행) 까지 파싱됩니다.</li>
              <li>
                필수: <b>과목 · 학생코드 · 수행평가명</b> — 누락 시 유효하지 않은 행으로 표시되고
                커밋에서 제외됩니다.
              </li>
              <li>커밋 시 <code className="font-mono text-fg">파싱대기</code> 상태로 과제가 생성되고, 원본 10필드가 <code className="font-mono text-fg">parsing_results.content_json</code> 에 저장됩니다.</li>
            </ul>
          </div>

          {/* Recent */}
          <div className="card">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-fg-subtle">
              <span>최근 파싱 기록</span>
              {recentQuery.isFetching && (
                <span className="flex items-center gap-1 text-[10px] normal-case">
                  <Spinner size={10} /> 새로고침
                </span>
              )}
            </div>
            {!live ? (
              <div className="text-xs text-fg-subtle">Electron 실행 시 표시됩니다.</div>
            ) : recentQuery.isLoading ? (
              <LoadingPanel label="기록을 불러오는 중…" className="min-h-[80px]" />
            ) : recentQuery.isError ? (
              <EmptyState
                icon={AlertTriangle}
                tone="error"
                title="기록을 불러오지 못했습니다"
                action={
                  <button
                    type="button"
                    onClick={() => recentQuery.refetch()}
                    className="btn-outline text-xs flex items-center gap-1"
                  >
                    <RotateCcw size={10} /> 다시 시도
                  </button>
                }
              />
            ) : (recentQuery.data ?? []).length === 0 ? (
              <div className="text-xs text-fg-subtle py-3 text-center">아직 기록이 없습니다.</div>
            ) : (
              <ul className="space-y-2">
                {(recentQuery.data ?? []).slice(0, 8).map((r) => {
                  const row = r as Record<string, string | number | null>;
                  return (
                    <li key={String(row.id)} className="rounded-md border border-border bg-bg-soft/40 p-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-fg-subtle">{row.code}</span>
                        <span className="text-fg-subtle">·</span>
                        <span className="text-fg-muted">{String(row.subject ?? '')}</span>
                        <span className="ml-auto text-[10px] text-fg-subtle">
                          {relative(String(row.parsed_at ?? ''))}
                        </span>
                      </div>
                      <div className="line-clamp-1 mt-0.5 text-[11px] text-fg">
                        {String(row.title ?? '')}
                      </div>
                      <div className="mt-0.5 text-[10px] text-fg-subtle">
                        학생 {String(row.student_code ?? '')} · {String(row.parser_name ?? '-')}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* RIGHT — preview */}
        <div className="col-span-8 flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-soft/30">
          {previewMut.isPending && !preview ? (
            <LoadingPanel label="엑셀 파일을 분석하는 중…" className="flex-1" />
          ) : !preview ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                icon={Inbox}
                title="엑셀 파일을 업로드하면 미리보기가 표시됩니다"
                hint="왼쪽 업로드 박스에서 .xlsx / .xls 파일을 선택하세요."
                className="border-dashed"
              />
            </div>
          ) : (
            <>
              {/* Preview meta bar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
                <span className="font-semibold text-fg">{preview.filename}</span>
                <span className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px] text-fg-subtle">
                  시트: {preview.sheetName || '(없음)'}
                </span>
                <span className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px] text-fg-subtle">
                  헤더: {preview.headerRow}행
                </span>
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300 border border-emerald-500/30">
                  유효 {counts.valid}
                </span>
                {counts.invalid > 0 && (
                  <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300 border border-rose-500/30">
                    오류 {counts.invalid}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={reset}
                    disabled={commitMut.isPending}
                    className="btn-ghost h-7 text-[11px] disabled:opacity-50"
                    aria-label="미리보기 초기화"
                  >
                    <RotateCcw size={11} /> 초기화
                  </button>
                  <button
                    onClick={() => commitMut.mutate()}
                    disabled={!live || commitMut.isPending || counts.valid === 0}
                    aria-label={`유효한 ${counts.valid}건 과제 등록`}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                      'border-accent bg-accent/10 text-accent hover:bg-accent/20',
                    )}
                  >
                    {commitMut.isPending ? <Spinner size={11} /> : <Download size={11} />}
                    {commitMut.isPending ? '저장 중…' : `${counts.valid}건 과제 등록`}
                  </button>
                </div>
              </div>

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <div
                  className="border-b border-border bg-amber-500/5 px-4 py-2 text-[11px] text-amber-300"
                  role="alert"
                >
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Commit result banner */}
              {commitResult && (
                <div
                  className="border-b border-border bg-emerald-500/5 px-4 py-2 text-xs text-emerald-300"
                  role="status"
                >
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={12} aria-hidden="true" />
                    <span className="font-medium">
                      {commitResult.created}건 과제 등록 완료
                      {commitResult.skipped > 0 && ` · ${commitResult.skipped}건 제외`}
                    </span>
                  </div>
                  {commitResult.codes.length > 0 && (
                    <div className="mt-1 font-mono text-[10px] text-emerald-200/80">
                      {commitResult.codes.join(', ')}
                    </div>
                  )}
                </div>
              )}
              {commitMut.isError && (
                <div
                  className="border-b border-border bg-rose-500/5 px-4 py-2 text-xs text-rose-300"
                  role="alert"
                >
                  <X size={11} className="inline" aria-hidden="true" />{' '}
                  {(commitMut.error as Error)?.message ?? '저장에 실패했습니다'}
                </div>
              )}

              {/* Preview table */}
              <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-[11px]">
                  <thead className="sticky top-0 bg-bg-soft/80 backdrop-blur">
                    <tr className="text-fg-subtle">
                      <th scope="col" className="w-10 border-b border-border px-2 py-2 text-center font-medium">#</th>
                      {FIELDS.map((f) => (
                        <th
                          scope="col"
                          key={f.key}
                          className="border-b border-border px-2 py-2 text-left font-medium"
                          style={{ minWidth: f.min }}
                        >
                          {f.label}
                        </th>
                      ))}
                      <th scope="col" className="w-20 border-b border-border px-2 py-2 text-center font-medium">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.length === 0 ? (
                      <tr>
                        <td colSpan={FIELDS.length + 2} className="px-4 py-8 text-center text-fg-subtle">
                          파싱된 행이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      preview.rows.map((r) => (
                        <tr
                          key={r.rowNumber}
                          className={cn(
                            'align-top',
                            r.valid ? 'hover:bg-bg-soft/40' : 'bg-rose-500/5 hover:bg-rose-500/10',
                          )}
                        >
                          <td className="border-b border-border px-2 py-1.5 text-center font-mono text-fg-subtle">
                            {r.rowNumber}
                          </td>
                          {FIELDS.map((f) => (
                            <td key={f.key} className="border-b border-border px-2 py-1.5 text-fg">
                              <div className="line-clamp-2 whitespace-pre-wrap">
                                {String(r[f.key] ?? '') || <span className="text-fg-subtle">—</span>}
                              </div>
                            </td>
                          ))}
                          <td className="border-b border-border px-2 py-1.5 text-center">
                            {r.valid ? (
                              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300 border border-emerald-500/30">
                                <CheckCircle2 size={10} aria-hidden="true" /> 유효
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-0.5 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300 border border-rose-500/30"
                                title={r.errors.join(', ')}
                                aria-label={`오류: ${r.errors.join(', ')}`}
                              >
                                <AlertTriangle size={10} aria-hidden="true" /> 오류
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Footer tip */}
              <div className="border-t border-border px-4 py-2 text-[10px] text-fg-subtle flex items-center gap-1">
                <Sparkles size={10} aria-hidden="true" />
                커밋 후에는 과제 관리 화면의 &quot;파싱대기&quot; 필터에서 해당 과제들이 조회됩니다.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

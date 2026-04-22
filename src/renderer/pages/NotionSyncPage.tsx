import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  RefreshCw,
  KeyRound,
  Database,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Users,
  GraduationCap,
  ClipboardList,
  History,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField, TextInput } from '@/components/ui/FormField';
import { fmtDateTime } from '@/lib/date';
import { cn } from '@/lib/cn';

// -----------------------------------------------------------------------------
// Types mirroring window.api.notion shapes
// -----------------------------------------------------------------------------

interface NotionDbCfg {
  id: string;
  label?: string;
  contactField?: string;
  guardianField?: string;
}

interface AssignmentDbCfg {
  id: string;
  label?: string;
  subjectField?: string;
  titleField?: string;
  statusField?: string;
  parserField?: string;
  qa1Field?: string;
  qaFinalField?: string;
  dueField?: string;
}

interface SyncRun {
  id: number;
  kind: 'students' | 'staff' | 'probe' | 'assignments';
  started_at: string;
  finished_at: string | null;
  ok: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
  message: string | null;
  triggered_by: number | null;
}

const KIND_LABEL: Record<SyncRun['kind'], string> = {
  students: '학생',
  staff: '직원',
  probe: '연결 확인',
  assignments: '과제',
};

const KIND_TONE: Record<SyncRun['kind'], string> = {
  students: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  staff: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  probe: 'bg-bg-soft text-fg-subtle border-border',
  assignments: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export function NotionSyncPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 노션 동기화를 사용할 수 있습니다.
        </div>
      </div>
    );
  }

  return <NotionSyncPanel currentUserId={user!.id} />;
}

// -----------------------------------------------------------------------------
// Main panel — settings + actions + history
// -----------------------------------------------------------------------------

function NotionSyncPanel({ currentUserId }: { currentUserId: number }) {
  const api = getApi()!;

  const settingsQuery = useQuery({
    queryKey: ['notion.settings'],
    queryFn: () => api.notion.getSettings(),
  });

  const runsQuery = useQuery({
    queryKey: ['notion.runs'],
    queryFn: () => api.notion.listRuns({ limit: 30 }),
  });

  const settings = settingsQuery.data;
  const runs = runsQuery.data ?? [];
  const hasStudentDbs = (settings?.studentDatabases ?? []).some((db) => db.id?.trim());
  const hasAssignmentDbs = (settings?.assignmentDatabases ?? []).some((db) => db.id?.trim());

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <RefreshCw size={20} /> 노션 동기화
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            내부 Integration 토큰으로 워크스페이스 사용자, 학생 DB, 과제 요청 DB 를 EduOps 로 끌어옵니다.
            학생과 과제는 페이지 단위로 upsert 되며, 직원은 기존 계정에만 연결됩니다.
          </p>
        </div>
        <button
          type="button"
          className="btn-outline text-xs flex items-center gap-1"
          onClick={() => {
            settingsQuery.refetch();
            runsQuery.refetch();
          }}
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </header>

      {settingsQuery.isLoading || !settings ? (
        <LoadingPanel label="설정을 불러오는 중…" />
      ) : (
        <>
          <TokenCard
            tokenMasked={settings.tokenMasked}
            isConfigured={settings.isConfigured}
            currentUserId={currentUserId}
          />
          <DatabasesCard
            initial={settings.studentDatabases ?? []}
            currentUserId={currentUserId}
          />
          <AssignmentDatabasesCard
            initial={settings.assignmentDatabases ?? []}
            currentUserId={currentUserId}
          />
          <ActionsCard
            isConfigured={settings.isConfigured}
            hasStudentDbs={hasStudentDbs}
            hasAssignmentDbs={hasAssignmentDbs}
            currentUserId={currentUserId}
          />
        </>
      )}

      <HistoryCard runs={runs} loading={runsQuery.isLoading} />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Token card — input + save + probe
// -----------------------------------------------------------------------------

function TokenCard({
  tokenMasked,
  isConfigured,
  currentUserId,
}: {
  tokenMasked: string;
  isConfigured: boolean;
  currentUserId: number;
}) {
  const api = getApi()!;
  const [token, setToken] = useState('');
  const [probeResult, setProbeResult] = useState<
    { kind: 'ok'; name: string } | { kind: 'err'; message: string } | null
  >(null);

  const saveMutation = useMutationWithToast({
    mutationFn: (newToken: string) =>
      api.notion.saveSettings({ token: newToken, actorId: currentUserId }),
    successMessage: '노션 토큰을 저장했습니다',
    errorMessage: '토큰 저장에 실패했습니다',
    invalidates: [['notion.settings'], ['notion.runs']],
    onSuccess: () => setToken(''),
  });

  const probeMutation = useMutationWithToast({
    mutationFn: () => api.notion.probe({ actorId: currentUserId }),
    successMessage: false, // We render the outcome inline instead.
    errorMessage: false,
    invalidates: [['notion.runs']],
    onSuccess: (res) => {
      if (res.ok) {
        setProbeResult({ kind: 'ok', name: res.me.name ?? res.me.id });
      } else {
        setProbeResult({ kind: 'err', message: res.message });
      }
    },
    onError: (err) => {
      setProbeResult({
        kind: 'err',
        message: err instanceof Error ? err.message : String(err),
      });
    },
  });

  return (
    <section className="card p-4 space-y-3">
      <header className="flex items-center gap-2">
        <KeyRound size={14} className="text-fg-subtle" />
        <h2 className="text-sm font-semibold text-fg">Notion Integration 토큰</h2>
        {isConfigured ? (
          <span className="rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
            설정됨
          </span>
        ) : (
          <span className="rounded border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
            미설정
          </span>
        )}
      </header>
      <p className="text-[11px] text-fg-subtle">
        <code className="rounded bg-bg-soft px-1 py-0.5">secret_…</code> 형태의 Internal Integration 토큰을 붙여넣고 저장하세요.
        토큰은 로컬 SQLite 의 <code className="rounded bg-bg-soft px-1 py-0.5">admin_settings</code> 에만 저장되며, 화면에 다시 표시될 때는 앞뒤 4자만 노출됩니다.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
        <FormField label="새 토큰" hint={isConfigured ? `현재 저장된 토큰: ${tokenMasked}` : '처음 설정하는 경우에도 여기에 입력합니다.'}>
          {(slot) => (
            <TextInput
              {...slot}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </FormField>
        <div className="flex items-end">
          <button
            type="button"
            className="btn-primary text-xs flex items-center gap-1 whitespace-nowrap"
            disabled={!token.trim() || saveMutation.isPending}
            onClick={() => saveMutation.mutate(token.trim())}
          >
            {saveMutation.isPending ? '저장 중…' : '토큰 저장'}
          </button>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            className="btn-outline text-xs flex items-center gap-1 whitespace-nowrap"
            disabled={!isConfigured || probeMutation.isPending}
            onClick={() => probeMutation.mutate()}
          >
            <CheckCircle2 size={12} />
            {probeMutation.isPending ? '확인 중…' : '연결 테스트'}
          </button>
        </div>
      </div>
      {probeResult && (
        <div
          className={cn(
            'rounded border px-3 py-2 text-xs flex items-start gap-2',
            probeResult.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-200',
          )}
        >
          {probeResult.kind === 'ok' ? (
            <>
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <span>
                연결 성공 · 노션 계정 이름: <b>{probeResult.name}</b>
              </span>
            </>
          ) : (
            <>
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{probeResult.message}</span>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Databases card — editable DB list
// -----------------------------------------------------------------------------

function DatabasesCard({
  initial,
  currentUserId,
}: {
  initial: NotionDbCfg[];
  currentUserId: number;
}) {
  const api = getApi()!;
  const [rows, setRows] = useState<NotionDbCfg[]>(initial);
  const [touched, setTouched] = useState(false);

  // When the upstream value changes (after a save), sync local state — but
  // only if the user hasn't started editing.
  useEffect(() => {
    if (!touched) {
      setRows(initial);
    }
  }, [initial, touched]);

  const saveMutation = useMutationWithToast({
    mutationFn: (next: NotionDbCfg[]) =>
      api.notion.saveSettings({ studentDatabases: next, actorId: currentUserId }),
    successMessage: '학생 데이터베이스 목록을 저장했습니다',
    errorMessage: 'DB 목록 저장에 실패했습니다',
    invalidates: [['notion.settings']],
    onSuccess: () => setTouched(false),
  });

  function patch(index: number, key: keyof NotionDbCfg, value: string) {
    setTouched(true);
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    );
  }

  function addRow() {
    setTouched(true);
    setRows((prev) => [...prev, { id: '', label: '' }]);
  }

  function removeRow(index: number) {
    setTouched(true);
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function submit() {
    const cleaned = rows
      .map((r) => ({
        id: r.id.trim(),
        label: r.label?.trim() || undefined,
        contactField: r.contactField?.trim() || undefined,
        guardianField: r.guardianField?.trim() || undefined,
      }))
      .filter((r) => r.id);
    saveMutation.mutate(cleaned);
  }

  return (
    <section className="card p-4 space-y-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Database size={14} className="text-fg-subtle" />
          <h2 className="text-sm font-semibold text-fg">학생 데이터베이스 매핑</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost text-xs flex items-center gap-1"
            onClick={addRow}
          >
            <Plus size={12} /> 행 추가
          </button>
          <button
            type="button"
            className="btn-primary text-xs flex items-center gap-1"
            disabled={saveMutation.isPending || !touched}
            onClick={submit}
          >
            {saveMutation.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </header>
      <p className="text-[11px] text-fg-subtle">
        노션 데이터베이스의 URL 뒤쪽 32자 ID (예: <code className="rounded bg-bg-soft px-1 py-0.5">2f2e037ff1e980c0adf8e88524ec28af</code>) 를 입력하세요.
        같은 학생이 여러 DB 에 있어도 <b>페이지 ID</b> 기준으로 upsert 되므로 중복 등록되지 않습니다.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon={Database}
          title="등록된 데이터베이스가 없습니다"
          hint="'행 추가' 로 노션 DB 를 등록하세요."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-bg-soft/50 text-fg-muted">
              <tr>
                <th className="px-2 py-2 text-left font-medium w-[280px]">DB ID</th>
                <th className="px-2 py-2 text-left font-medium w-[120px]">라벨</th>
                <th className="px-2 py-2 text-left font-medium">학생 연락처 필드</th>
                <th className="px-2 py-2 text-left font-medium">학부모 연락처 필드</th>
                <th className="px-2 py-2 text-right font-medium w-[60px]">&nbsp;</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => (
                <tr key={i} className="align-top">
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full tabular-nums"
                      value={row.id}
                      onChange={(e) => patch(i, 'id', e.target.value)}
                      placeholder="32자 DB ID"
                      spellCheck={false}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.label ?? ''}
                      onChange={(e) => patch(i, 'label', e.target.value)}
                      placeholder="예: 컨설팅"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.contactField ?? ''}
                      onChange={(e) => patch(i, 'contactField', e.target.value)}
                      placeholder="예: 학생 연락처 (없으면 비워두기)"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.guardianField ?? ''}
                      onChange={(e) => patch(i, 'guardianField', e.target.value)}
                      placeholder="예: 학부모 연락처 / 연락처(모)"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      className="btn-ghost text-xs text-rose-300 inline-flex items-center gap-1"
                      onClick={() => removeRow(i)}
                      aria-label="행 삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Assignment databases card — existing assignment sync mapping
// -----------------------------------------------------------------------------

function AssignmentDatabasesCard({
  initial,
  currentUserId,
}: {
  initial: AssignmentDbCfg[];
  currentUserId: number;
}) {
  const api = getApi()!;
  const [rows, setRows] = useState<AssignmentDbCfg[]>(initial);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) {
      setRows(initial);
    }
  }, [initial, touched]);

  const saveMutation = useMutationWithToast({
    mutationFn: (next: AssignmentDbCfg[]) =>
      api.notion.saveSettings({
        assignmentDatabases: next,
        actorId: currentUserId,
      }),
    successMessage: '과제 데이터베이스 목록을 저장했습니다',
    errorMessage: '과제 DB 목록 저장에 실패했습니다',
    invalidates: [['notion.settings']],
    onSuccess: () => setTouched(false),
  });

  function patch(index: number, key: keyof AssignmentDbCfg, value: string) {
    setTouched(true);
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    );
  }

  function addRow() {
    setTouched(true);
    setRows((prev) => [
      ...prev,
      {
        id: '',
        label: '',
        subjectField: '과목명',
        titleField: '보고서 주제',
        statusField: '진행 상황',
        parserField: '작성자',
        qa1Field: '1차 검토자',
        qaFinalField: '2차 작성자',
        dueField: '마감시한 (zap)',
      },
    ]);
  }

  function removeRow(index: number) {
    setTouched(true);
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function submit() {
    const cleaned = rows
      .map((r) => ({
        id: r.id.trim(),
        label: r.label?.trim() || undefined,
        subjectField: r.subjectField?.trim() || undefined,
        titleField: r.titleField?.trim() || undefined,
        statusField: r.statusField?.trim() || undefined,
        parserField: r.parserField?.trim() || undefined,
        qa1Field: r.qa1Field?.trim() || undefined,
        qaFinalField: r.qaFinalField?.trim() || undefined,
        dueField: r.dueField?.trim() || undefined,
      }))
      .filter((r) => r.id);
    saveMutation.mutate(cleaned);
  }

  return (
    <section className="card p-4 space-y-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList size={14} className="text-fg-subtle" />
          <h2 className="text-sm font-semibold text-fg">과제 데이터베이스 매핑</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost text-xs flex items-center gap-1"
            onClick={addRow}
          >
            <Plus size={12} /> 행 추가
          </button>
          <button
            type="button"
            className="btn-primary text-xs flex items-center gap-1"
            disabled={saveMutation.isPending || !touched}
            onClick={submit}
          >
            {saveMutation.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </header>
      <p className="text-[11px] text-fg-subtle">
        이미 준비된 과제 동기화 설정입니다. 노션 과제 DB 의 필드명이 다르면 아래 이름만 맞춰 저장하세요.
        비워 둔 필드는 기본 후보 이름으로 자동 탐색합니다.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="등록된 과제 DB가 없습니다"
          hint="'행 추가' 로 과제 요청 DB 를 등록하세요."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-xs">
            <thead className="bg-bg-soft/50 text-fg-muted">
              <tr>
                <th className="px-2 py-2 text-left font-medium w-[240px]">DB ID</th>
                <th className="px-2 py-2 text-left font-medium w-[110px]">라벨</th>
                <th className="px-2 py-2 text-left font-medium">과목</th>
                <th className="px-2 py-2 text-left font-medium">제목</th>
                <th className="px-2 py-2 text-left font-medium">상태</th>
                <th className="px-2 py-2 text-left font-medium">작성자</th>
                <th className="px-2 py-2 text-left font-medium">1차</th>
                <th className="px-2 py-2 text-left font-medium">최종</th>
                <th className="px-2 py-2 text-left font-medium">마감</th>
                <th className="px-2 py-2 text-right font-medium w-[56px]">&nbsp;</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row, i) => (
                <tr key={i} className="align-top">
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full tabular-nums"
                      value={row.id}
                      onChange={(e) => patch(i, 'id', e.target.value)}
                      placeholder="32자 DB ID"
                      spellCheck={false}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.label ?? ''}
                      onChange={(e) => patch(i, 'label', e.target.value)}
                      placeholder="예: 과제"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.subjectField ?? ''}
                      onChange={(e) => patch(i, 'subjectField', e.target.value)}
                      placeholder="과목명"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.titleField ?? ''}
                      onChange={(e) => patch(i, 'titleField', e.target.value)}
                      placeholder="보고서 주제"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.statusField ?? ''}
                      onChange={(e) => patch(i, 'statusField', e.target.value)}
                      placeholder="진행 상황"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.parserField ?? ''}
                      onChange={(e) => patch(i, 'parserField', e.target.value)}
                      placeholder="작성자"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.qa1Field ?? ''}
                      onChange={(e) => patch(i, 'qa1Field', e.target.value)}
                      placeholder="1차 검토자"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.qaFinalField ?? ''}
                      onChange={(e) => patch(i, 'qaFinalField', e.target.value)}
                      placeholder="2차 작성자"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      className="input text-xs py-1 w-full"
                      value={row.dueField ?? ''}
                      onChange={(e) => patch(i, 'dueField', e.target.value)}
                      placeholder="마감시한"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      className="btn-ghost text-xs text-rose-300 inline-flex items-center gap-1"
                      onClick={() => removeRow(i)}
                      aria-label="행 삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// -----------------------------------------------------------------------------
// Actions card — sync buttons
// -----------------------------------------------------------------------------

function ActionsCard({
  isConfigured,
  hasStudentDbs,
  hasAssignmentDbs,
  currentUserId,
}: {
  isConfigured: boolean;
  hasStudentDbs: boolean;
  hasAssignmentDbs: boolean;
  currentUserId: number;
}) {
  const api = getApi()!;
  const [lastStudentMsg, setLastStudentMsg] = useState<string | null>(null);
  const [lastStaffMsg, setLastStaffMsg] = useState<string | null>(null);
  const [lastAssignmentMsg, setLastAssignmentMsg] = useState<string | null>(null);

  const studentsMutation = useMutationWithToast({
    mutationFn: () => api.notion.syncStudents({ actorId: currentUserId }),
    successMessage: false,
    errorMessage: '학생 동기화에 실패했습니다',
    invalidates: [['notion.runs'], ['students.list']],
    onSuccess: (res) => {
      setLastStudentMsg(
        res.ok
          ? `학생 동기화 완료 — 신규 ${res.inserted}, 갱신 ${res.updated}, 건너뜀 ${res.skipped}`
          : `학생 동기화 실패 — ${res.message ?? '원인 불명'}`,
      );
    },
    onError: (err) => {
      setLastStudentMsg(
        `학생 동기화 호출 실패 — ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  const staffMutation = useMutationWithToast({
    mutationFn: () => api.notion.syncStaff({ actorId: currentUserId }),
    successMessage: false,
    errorMessage: '직원 연결 동기화에 실패했습니다',
    invalidates: [['notion.runs']],
    onSuccess: (res) => {
      setLastStaffMsg(
        res.ok
          ? `직원 연결 완료 — 갱신 ${res.updated}명, 건너뜀 ${res.skipped}명`
          : `직원 연결 실패 — ${res.message ?? '원인 불명'}`,
      );
    },
    onError: (err) => {
      setLastStaffMsg(
        `직원 연결 호출 실패 — ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  const assignmentsMutation = useMutationWithToast({
    mutationFn: () => api.notion.syncAssignments({ actorId: currentUserId }),
    successMessage: false,
    errorMessage: '과제 동기화에 실패했습니다',
    invalidates: [['notion.runs'], ['assignments.list'], ['topbar.assignments']],
    onSuccess: (res) => {
      setLastAssignmentMsg(
        res.ok
          ? `과제 동기화 완료 — 신규 ${res.inserted}, 갱신 ${res.updated}, 건너뜀 ${res.skipped}`
          : `과제 동기화 실패 — ${res.message ?? '원인 불명'}`,
      );
    },
    onError: (err) => {
      setLastAssignmentMsg(
        `과제 동기화 호출 실패 — ${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  return (
    <section className="card p-4 space-y-3">
      <header className="flex items-center gap-2">
        <RefreshCw size={14} className="text-fg-subtle" />
        <h2 className="text-sm font-semibold text-fg">수동 동기화</h2>
      </header>
      <p className="text-[11px] text-fg-subtle">
        동기화는 사용자가 버튼을 누를 때만 실행됩니다. 결과는 아래 이력 표에 기록되며, 학생 목록은 즉시 반영됩니다.
      </p>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="rounded border border-border bg-bg-soft/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-fg">
              <GraduationCap size={14} /> 학생 동기화
            </div>
            <button
              type="button"
              className="btn-primary text-xs flex items-center gap-1"
              disabled={!isConfigured || !hasStudentDbs || studentsMutation.isPending}
              onClick={() => studentsMutation.mutate()}
            >
              {studentsMutation.isPending ? '동기화 중…' : '지금 실행'}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            등록된 모든 학생 DB 를 조회해 페이지 단위로 upsert 합니다. 코드가 없는 신규 학생에는 <code className="rounded bg-bg-soft px-1 py-0.5">N-…</code> 접두사의 자동 코드가 발급됩니다.
          </p>
          {lastStudentMsg && (
            <div className="mt-2 text-[11px] text-fg-muted">{lastStudentMsg}</div>
          )}
          {!hasStudentDbs && (
            <div className="mt-2 text-[11px] text-amber-300">학생 DB를 먼저 등록하세요.</div>
          )}
        </div>
        <div className="rounded border border-border bg-bg-soft/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-fg">
              <Users size={14} /> 직원 연결
            </div>
            <button
              type="button"
              className="btn-primary text-xs flex items-center gap-1"
              disabled={!isConfigured || staffMutation.isPending}
              onClick={() => staffMutation.mutate()}
            >
              {staffMutation.isPending ? '연결 중…' : '지금 실행'}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            노션 워크스페이스 멤버 중 이메일이 일치하는 기존 EduOps 계정에만 <code className="rounded bg-bg-soft px-1 py-0.5">notion_user_id</code> 를 연결합니다.
            새 계정은 자동 생성되지 않으므로 직원은 HR 이 먼저 등록해야 합니다.
          </p>
          {lastStaffMsg && (
            <div className="mt-2 text-[11px] text-fg-muted">{lastStaffMsg}</div>
          )}
        </div>
        <div className="rounded border border-border bg-bg-soft/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium text-fg">
              <ClipboardList size={14} /> 과제 동기화
            </div>
            <button
              type="button"
              className="btn-primary text-xs flex items-center gap-1"
              disabled={!isConfigured || !hasAssignmentDbs || assignmentsMutation.isPending}
              onClick={() => assignmentsMutation.mutate()}
            >
              {assignmentsMutation.isPending ? '동기화 중…' : '지금 실행'}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-fg-subtle">
            과제 요청 DB 를 조회해 <code className="rounded bg-bg-soft px-1 py-0.5">assignments</code> 에 반영합니다.
            학생·담당자·마감일은 현재 매핑된 필드 기준으로 연결합니다.
          </p>
          {lastAssignmentMsg && (
            <div className="mt-2 text-[11px] text-fg-muted">{lastAssignmentMsg}</div>
          )}
          {!hasAssignmentDbs && (
            <div className="mt-2 text-[11px] text-amber-300">과제 DB를 먼저 등록하세요.</div>
          )}
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// History card
// -----------------------------------------------------------------------------

function HistoryCard({ runs, loading }: { runs: SyncRun[]; loading: boolean }) {
  const lastSyncs = useMemo(() => {
    const out: Partial<Record<SyncRun['kind'], SyncRun>> = {};
    for (const r of runs) {
      if (!out[r.kind]) out[r.kind] = r;
    }
    return out;
  }, [runs]);

  return (
    <section className="card p-0 overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <History size={14} className="text-fg-subtle" />
          <h2 className="text-sm font-semibold text-fg">동기화 이력</h2>
        </div>
        <div className="text-[11px] text-fg-subtle flex items-center gap-3">
          <span>
            학생: {lastSyncs.students ? fmtDateTime(lastSyncs.students.started_at) : '—'}
          </span>
          <span>
            직원: {lastSyncs.staff ? fmtDateTime(lastSyncs.staff.started_at) : '—'}
          </span>
          <span>
            과제: {lastSyncs.assignments ? fmtDateTime(lastSyncs.assignments.started_at) : '—'}
          </span>
        </div>
      </header>
      {loading ? (
        <LoadingPanel label="이력을 불러오는 중…" />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={History}
          title="아직 실행 이력이 없습니다"
          hint="토큰을 저장하고 '지금 실행' 을 눌러 첫 동기화를 돌려보세요."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-bg-soft/50 text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">시작시각</th>
                <th className="px-3 py-2 text-left font-medium">종류</th>
                <th className="px-3 py-2 text-left font-medium">결과</th>
                <th className="px-3 py-2 text-right font-medium tabular-nums">신규</th>
                <th className="px-3 py-2 text-right font-medium tabular-nums">갱신</th>
                <th className="px-3 py-2 text-right font-medium tabular-nums">건너뜀</th>
                <th className="px-3 py-2 text-right font-medium tabular-nums">에러</th>
                <th className="px-3 py-2 text-left font-medium">메시지</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-bg-soft/40">
                  <td className="px-3 py-2 tabular-nums text-fg-subtle">
                    {fmtDateTime(r.started_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'rounded border px-1.5 py-0.5 text-[10px]',
                        KIND_TONE[r.kind],
                      )}
                    >
                      {KIND_LABEL[r.kind]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.ok ? (
                      <span className="inline-flex items-center gap-1 text-emerald-300">
                        <CheckCircle2 size={12} /> 성공
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-300">
                        <AlertCircle size={12} /> 실패
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.inserted}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.updated}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-subtle">
                    {r.skipped}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      r.errors > 0 ? 'text-rose-300' : 'text-fg-subtle',
                    )}
                  >
                    {r.errors}
                  </td>
                  <td className="px-3 py-2 text-fg-muted max-w-[360px] truncate">
                    {r.message ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

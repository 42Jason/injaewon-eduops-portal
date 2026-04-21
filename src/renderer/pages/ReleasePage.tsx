import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Rocket,
  KeyRound,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Shield,
  Save,
  Trash2,
  Github,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useToast } from '@/stores/toast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField, TextInput, Textarea } from '@/components/ui/FormField';
import { fmtDateTime } from '@/lib/date';
import { cn } from '@/lib/cn';

// -----------------------------------------------------------------------------
// ReleasePage — leadership-only in-app trigger for the release workflow.
//
// What it does:
//   1. Leadership enters a GitHub PAT once (stored encrypted via safeStorage).
//   2. They pick patch / minor / major (or a custom version) + optional notes.
//   3. Click "릴리스 트리거" → main process calls GitHub workflow_dispatch on
//      `.github/workflows/release-bump.yml`, which bumps package.json, commits,
//      tags, and pushes. The existing release.yml then builds + publishes.
//   4. The recent workflow runs are polled every 5s so the user can watch it.
//
// Runs from any computer with the app + a leadership login. No local git.
// -----------------------------------------------------------------------------

type BumpType = 'patch' | 'minor' | 'major';

interface ReleaseRun {
  id: number;
  name: string;
  title: string;
  branch: string;
  sha: string;
  status: string;
  conclusion: string;
  event: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  path: string;
}

function StatusPill({ run }: { run: ReleaseRun }) {
  const inProgress = run.status === 'in_progress' || run.status === 'queued' || run.status === 'waiting';
  const failure = run.conclusion === 'failure' || run.conclusion === 'cancelled' || run.conclusion === 'timed_out';
  const success = run.conclusion === 'success';

  const label = inProgress
    ? run.status === 'queued'
      ? '대기 중'
      : '실행 중'
    : success
    ? '성공'
    : failure
    ? run.conclusion === 'cancelled'
      ? '취소됨'
      : run.conclusion === 'timed_out'
      ? '시간 초과'
      : '실패'
    : run.conclusion || run.status || '-';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        inProgress && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        success && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        failure && 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
        !inProgress && !success && !failure && 'bg-surface-2 text-fg-subtle',
      )}
    >
      {inProgress && <Loader2 className="h-3 w-3 animate-spin" />}
      {success && <CheckCircle2 className="h-3 w-3" />}
      {failure && <AlertCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

export function ReleasePage() {
  const { user } = useSession();
  const toast = useToast();
  const api = getApi();
  const qc = useQueryClient();

  const isLeadership = !!user?.perms.isLeadership;

  // ---------------------------------------------------------------------------
  // Config (PAT + repo info)
  // ---------------------------------------------------------------------------
  const configQuery = useQuery({
    queryKey: ['release', 'config'],
    enabled: !!api && isLeadership,
    queryFn: async () => {
      if (!api) throw new Error('no-api');
      return api.release.getConfig();
    },
  });

  const [patInput, setPatInput] = useState('');
  const [repoOwner, setRepoOwner] = useState('');
  const [repoName, setRepoName] = useState('');
  const [workflowFile, setWorkflowFile] = useState('');

  useEffect(() => {
    if (!configQuery.data) return;
    setRepoOwner(configQuery.data.repoOwner);
    setRepoName(configQuery.data.repoName);
    setWorkflowFile(configQuery.data.workflowFile);
  }, [configQuery.data]);

  const saveConfig = useMutationWithToast({
    mutationFn: async (payload: {
      pat?: string | null;
      repoOwner?: string;
      repoName?: string;
      workflowFile?: string;
    }) => {
      if (!api) throw new Error('no-api');
      return api.release.setConfig(payload);
    },
    successMessage: '저장되었습니다',
    invalidates: [['release', 'config']],
  });

  const clearPat = useMutationWithToast({
    mutationFn: async () => {
      if (!api) throw new Error('no-api');
      return api.release.setConfig({ pat: '' });
    },
    successMessage: 'PAT 를 삭제했습니다',
    invalidates: [['release', 'config']],
  });

  // ---------------------------------------------------------------------------
  // Trigger form
  // ---------------------------------------------------------------------------
  const [bumpType, setBumpType] = useState<BumpType>('patch');
  const [customVersion, setCustomVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const trigger = useMutationWithToast({
    mutationFn: async () => {
      if (!api) throw new Error('no-api');
      return api.release.trigger({
        bumpType,
        customVersion: customVersion.trim() || null,
        notes: notes.trim() || null,
      });
    },
    successMessage: '릴리스 워크플로를 시작했습니다. 아래 실행 목록에서 진행 상황을 확인하세요.',
    errorMessage: '릴리스 실행에 실패했습니다',
    invalidates: [['release', 'runs']],
    onSuccess: (data) => {
      if (data && 'ok' in data && data.ok) {
        setNotes('');
        setCustomVersion('');
        setConfirmOpen(false);
        // Kick off a runs refetch shortly after — GitHub needs a second or two
        // to register the new run.
        setTimeout(() => {
          qc.invalidateQueries({ queryKey: ['release', 'runs'] });
        }, 1500);
      }
    },
  });

  // ---------------------------------------------------------------------------
  // Runs list (polled)
  // ---------------------------------------------------------------------------
  const runsQuery = useQuery({
    queryKey: ['release', 'runs'],
    enabled: !!api && isLeadership && !!configQuery.data?.hasPat,
    refetchInterval: 5000,
    queryFn: async () => {
      if (!api) throw new Error('no-api');
      return api.release.listRuns({ limit: 10 });
    },
  });

  const runs: ReleaseRun[] = useMemo(() => {
    if (!runsQuery.data || !('ok' in runsQuery.data) || !runsQuery.data.ok) return [];
    return runsQuery.data.runs;
  }, [runsQuery.data]);

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------
  if (!isLeadership) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Shield}
          title="권한이 없습니다"
          hint="릴리스 페이지는 대표/CTO/운영매니저만 사용할 수 있습니다."
        />
      </div>
    );
  }

  if (!api) {
    return (
      <div className="p-6">
        <EmptyState
          icon={AlertCircle}
          title="Electron 환경이 필요합니다"
          hint="릴리스 트리거는 설치된 앱 안에서만 동작합니다."
        />
      </div>
    );
  }

  if (configQuery.isLoading) {
    return <LoadingPanel label="릴리스 설정 불러오는 중…" />;
  }

  const cfg = configQuery.data;
  const hasPat = !!cfg?.hasPat;
  const encryptionAvailable = !!cfg?.encryptionAvailable;
  const currentVersion = cfg?.currentVersion ?? '';

  const canTrigger = hasPat && !trigger.isPending;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-accent/10 p-2 text-accent">
          <Rocket className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">릴리스</h1>
          <p className="mt-1 text-sm text-fg-subtle">
            앱에서 직접 GitHub Actions 를 트리거해 새 버전을 배포합니다. 로컬 Git·Node 불필요.
          </p>
        </div>
      </div>

      {/* -------------------------------------------------------------------- */}
      {/* 1. Repo + PAT 설정 */}
      {/* -------------------------------------------------------------------- */}
      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Github className="h-4 w-4 text-fg-subtle" />
          <h2 className="text-base font-semibold">GitHub 연동</h2>
          {hasPat ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              PAT 등록됨
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3 w-3" />
              PAT 필요
            </span>
          )}
        </div>

        {!encryptionAvailable && (
          <div className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">
            이 컴퓨터에서는 OS 암호 저장소(safeStorage)가 비활성화되어 있습니다. PAT 가 평문으로 저장되지
            않도록 이 페이지에서는 PAT 저장을 막았습니다. Keychain/Credential Manager 사용 가능한
            환경에서 다시 시도해주세요.
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <FormField label="Repo Owner">
            {(slot) => (
              <TextInput
                {...slot}
                value={repoOwner}
                onChange={(e) => setRepoOwner(e.target.value)}
                placeholder="42Jason"
              />
            )}
          </FormField>
          <FormField label="Repo Name">
            {(slot) => (
              <TextInput
                {...slot}
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                placeholder="injaewon-eduops-portal"
              />
            )}
          </FormField>
          <FormField label="Workflow 파일">
            {(slot) => (
              <TextInput
                {...slot}
                value={workflowFile}
                onChange={(e) => setWorkflowFile(e.target.value)}
                placeholder="release-bump.yml"
              />
            )}
          </FormField>
        </div>

        <div className="mt-4">
          <FormField
            label="GitHub Personal Access Token"
            hint="Fine-grained PAT · 권한: Contents(write), Actions(write), Metadata(read). 입력 후 저장 시 OS 키체인에 암호화되어 보관됩니다. 등록된 PAT 은 다시 표시되지 않습니다."
          >
            {(slot) => (
              <div className="flex gap-2">
                <TextInput
                  {...slot}
                  type="password"
                  value={patInput}
                  onChange={(e) => setPatInput(e.target.value)}
                  placeholder={hasPat ? '●●●●●●●●●●●● (등록됨 — 변경 시 새 값 입력)' : 'github_pat_…'}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                  disabled={saveConfig.isPending || !encryptionAvailable}
                  onClick={() => {
                    saveConfig.mutate({
                      pat: patInput || undefined,
                      repoOwner: repoOwner.trim() || undefined,
                      repoName: repoName.trim() || undefined,
                      workflowFile: workflowFile.trim() || undefined,
                    });
                    setPatInput('');
                  }}
                >
                  <Save className="h-4 w-4" />
                  저장
                </button>
                {hasPat && (
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-medium text-fg hover:bg-surface-3 disabled:opacity-50"
                    disabled={clearPat.isPending}
                    onClick={() => {
                      if (window.confirm('저장된 PAT 을 삭제하시겠습니까?')) {
                        clearPat.mutate();
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    PAT 삭제
                  </button>
                )}
              </div>
            )}
          </FormField>
        </div>
      </section>

      {/* -------------------------------------------------------------------- */}
      {/* 2. 릴리스 트리거 */}
      {/* -------------------------------------------------------------------- */}
      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-fg-subtle" />
            <h2 className="text-base font-semibold">새 버전 배포</h2>
          </div>
          {currentVersion && (
            <div className="text-sm text-fg-subtle">
              현재 버전: <span className="font-mono font-semibold text-fg">v{currentVersion}</span>
            </div>
          )}
        </div>

        {!hasPat ? (
          <p className="rounded-lg bg-surface-2 p-4 text-sm text-fg-subtle">
            먼저 위 섹션에서 GitHub PAT 을 저장해주세요.
          </p>
        ) : (
          <div className="space-y-4">
            <FormField label="Bump 유형">
              {() => (
                <div className="flex flex-wrap gap-2">
                  {(['patch', 'minor', 'major'] as BumpType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setBumpType(t)}
                      className={cn(
                        'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                        bumpType === t
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-surface-2 text-fg-subtle hover:bg-surface-3',
                      )}
                    >
                      {t === 'patch' && '패치 +1'}
                      {t === 'minor' && '마이너 +1'}
                      {t === 'major' && '메이저 +1'}
                      <span className="ml-2 font-mono text-xs text-fg-muted">
                        {t === 'patch' && '(x.y.Z)'}
                        {t === 'minor' && '(x.Y.0)'}
                        {t === 'major' && '(X.0.0)'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </FormField>

            <FormField
              label="직접 버전 지정 (선택)"
              hint="입력하면 Bump 유형 대신 이 값이 사용됩니다. 예: 0.2.0"
            >
              {(slot) => (
                <TextInput
                  {...slot}
                  value={customVersion}
                  onChange={(e) => setCustomVersion(e.target.value)}
                  placeholder="비워두면 위의 Bump 유형 사용"
                />
              )}
            </FormField>

            <FormField label="릴리스 노트 (선택)">
              {(slot) => (
                <Textarea
                  {...slot}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="이번 릴리스의 주요 변경 사항을 한 줄로 적어주세요."
                />
              )}
            </FormField>

            <div className="flex items-center justify-between rounded-lg bg-surface-2 p-3 text-sm">
              <div className="text-fg-subtle">
                실행 저장소:{' '}
                <span className="font-mono text-fg">
                  {cfg?.repoOwner}/{cfg?.repoName}
                </span>{' '}
                · 워크플로 <span className="font-mono text-fg">{cfg?.workflowFile}</span>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canTrigger}
                onClick={() => setConfirmOpen(true)}
              >
                {trigger.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4" />
                )}
                릴리스 트리거
              </button>
            </div>

            {confirmOpen && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
                <div className="font-medium text-amber-800 dark:text-amber-200">
                  정말 새 릴리스를 시작하시겠습니까?
                </div>
                <div className="mt-1 text-amber-800/80 dark:text-amber-200/80">
                  {customVersion.trim()
                    ? <>버전이 <span className="font-mono">v{customVersion.trim()}</span> 으로 올라갑니다.</>
                    : <>버전이 <span className="font-mono">{bumpType}</span> 단위로 올라갑니다 (현재 v{currentVersion}).</>}
                  {' '}main 에 커밋이 푸시되고, 태그 푸시가 Windows 빌드 워크플로를 자동으로 시작합니다.
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                    disabled={trigger.isPending}
                    onClick={() => trigger.mutate()}
                  >
                    {trigger.isPending ? '실행 중…' : '확인'}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-2"
                    onClick={() => setConfirmOpen(false)}
                  >
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* -------------------------------------------------------------------- */}
      {/* 3. 최근 워크플로 실행 */}
      {/* -------------------------------------------------------------------- */}
      <section className="rounded-xl border border-border bg-surface-1 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-fg-subtle" />
            <h2 className="text-base font-semibold">최근 워크플로 실행</h2>
            <span className="text-xs text-fg-muted">(5초마다 자동 갱신)</span>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-3 disabled:opacity-50"
            disabled={runsQuery.isFetching}
            onClick={() => qc.invalidateQueries({ queryKey: ['release', 'runs'] })}
          >
            <RefreshCw className={cn('h-3 w-3', runsQuery.isFetching && 'animate-spin')} />
            새로고침
          </button>
        </div>

        {!hasPat ? (
          <p className="rounded-lg bg-surface-2 p-4 text-sm text-fg-subtle">PAT 등록 후 목록이 표시됩니다.</p>
        ) : runsQuery.isLoading ? (
          <LoadingPanel label="워크플로 실행 목록 불러오는 중…" />
        ) : runsQuery.data && 'ok' in runsQuery.data && !runsQuery.data.ok ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
            <div className="font-medium">GitHub API 호출 실패</div>
            <div className="mt-1">
              {runsQuery.data.error}
              {runsQuery.data.detail ? ` — ${runsQuery.data.detail}` : ''}
            </div>
            <div className="mt-2 text-xs opacity-80">
              PAT 권한이 부족하거나 레포 이름/오너가 잘못되었을 수 있습니다.
            </div>
          </div>
        ) : runs.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="아직 실행된 워크플로가 없습니다"
            hint="릴리스를 트리거하면 여기에 나타납니다."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-fg-subtle">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">워크플로</th>
                  <th className="px-3 py-2 font-medium">브랜치 / 커밋</th>
                  <th className="px-3 py-2 font-medium">상태</th>
                  <th className="px-3 py-2 font-medium">시작</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-surface-2/50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-fg">{run.name || run.path}</div>
                      {run.title && <div className="text-xs text-fg-subtle">{run.title}</div>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-fg-subtle">
                      {run.branch}
                      {run.sha && <span className="ml-1 text-fg-muted">@ {run.sha}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill run={run} />
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-subtle">
                      {run.createdAt ? fmtDateTime(run.createdAt) : '-'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {run.url && (
                        <a
                          href={run.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                          onClick={(e) => {
                            // Electron: open in external browser so the app
                            // window doesn't navigate away.
                            // (electron-builder's default webPreferences should
                            // already handle this, but belt + suspenders.)
                            e.preventDefault();
                            try {
                              window.open(run.url, '_blank', 'noopener,noreferrer');
                            } catch {
                              /* ignore */
                            }
                          }}
                        >
                          열기
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="rounded-lg border border-border bg-surface-1 p-4 text-xs text-fg-subtle">
        <div className="mb-1 font-medium text-fg">작동 원리</div>
        <ol className="list-inside list-decimal space-y-0.5">
          <li>
            "릴리스 트리거" 버튼이 GitHub Actions 의 <span className="font-mono">release-bump.yml</span> 워크플로를 실행합니다.
          </li>
          <li>
            러너가 <span className="font-mono">npm version</span> 으로 package.json 을 올리고 커밋/태그를 만들어 main 에 push 합니다.
          </li>
          <li>
            태그 push 가 기존 <span className="font-mono">release.yml</span> 을 트리거해 Windows 설치본을 빌드·공개합니다.
          </li>
          <li>
            electron-updater 가 사용자 앱에 자동으로 업데이트를 알립니다.
          </li>
        </ol>
      </div>
    </div>
  );
}

export default ReleasePage;

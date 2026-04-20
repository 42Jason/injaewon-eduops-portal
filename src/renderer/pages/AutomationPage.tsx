import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  FileCode,
  Inbox,
  ListFilter,
  RefreshCcw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  User as UserIcon,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { fmtDateTime, relative } from '@/lib/date';
import { cn } from '@/lib/cn';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { FormField, TextInput, Textarea } from '@/components/ui/FormField';
import { firstError, maxLength, required } from '@/lib/validators';

interface LogRow {
  id: number;
  actor_id: number | null;
  actor_name?: string | null;
  action: string;
  target?: string | null;
  meta_json?: string | null;
  created_at: string;
}

interface SettingRow {
  key: string;
  value_json: string;
  updated_at: string;
}

const KEY_MAX = 80;
const KEY_RE = /^[a-z][a-z0-9_.\-]{1,78}[a-z0-9]$/;

function validateJson(v: string): string | null {
  if (!v.trim()) return 'JSON 값을 입력해 주세요';
  try {
    JSON.parse(v);
    return null;
  } catch {
    return '유효한 JSON이 아닙니다';
  }
}

export function AutomationPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;

  const isCTO = user?.role === 'CTO' || user?.role === 'CEO';

  const [actionFilter, setActionFilter] = useState('');
  const [limit, setLimit] = useState(100);
  const [tab, setTab] = useState<'logs' | 'settings'>('logs');

  const logsQuery = useQuery({
    queryKey: ['logs.list', actionFilter || null, limit],
    queryFn: () =>
      api!.logs.list({
        action: actionFilter || undefined,
        limit,
      }) as unknown as Promise<LogRow[]>,
    enabled: live && isCTO,
    refetchInterval: 30_000,
  });

  const settingsQuery = useQuery({
    queryKey: ['settings.list'],
    queryFn: () => api!.settings.list(),
    enabled: live && isCTO,
  });

  const logs = logsQuery.data ?? [];

  const logStats = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of logs) m.set(r.action, (m.get(r.action) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [logs]);

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 자동화 로그를 확인할 수 있습니다.
        </div>
      </div>
    );
  }

  if (!isCTO) {
    return (
      <div className="p-6">
        <div className="card max-w-xl">
          <div className="flex items-center gap-2 text-rose-300">
            <ShieldAlert size={18} /> 접근 권한 없음
          </div>
          <p className="text-sm text-fg-muted mt-2">
            자동화 로그 · 설정 페이지는 CTO / CEO 권한자만 접근할 수 있습니다.
            <br />
            현재 역할: <span className="font-mono">{user?.role}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <Bot size={20} /> CTO 자동화
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            활동 로그(감사 트레일) · 시스템 설정(key/value).
          </p>
        </div>
        <div className="flex items-center gap-1 bg-bg-soft rounded-lg p-1" role="tablist">
          <TabBtn active={tab === 'logs'} onClick={() => setTab('logs')} icon={<FileCode size={13} />}>
            활동 로그
          </TabBtn>
          <TabBtn active={tab === 'settings'} onClick={() => setTab('settings')} icon={<Settings2 size={13} />}>
            시스템 설정
          </TabBtn>
        </div>
      </div>

      {tab === 'logs' && (
        <LogsTab
          logs={logs}
          stats={logStats}
          actionFilter={actionFilter}
          setActionFilter={setActionFilter}
          limit={limit}
          setLimit={setLimit}
          onRefresh={() => logsQuery.refetch()}
          loading={logsQuery.isLoading}
          isError={logsQuery.isError}
          isFetching={logsQuery.isFetching}
        />
      )}

      {tab === 'settings' && (
        <SettingsTab
          settings={(settingsQuery.data ?? []) as SettingRow[]}
          isLoading={settingsQuery.isLoading}
          isError={settingsQuery.isError}
          onRetry={() => settingsQuery.refetch()}
        />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        'px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active ? 'bg-bg text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function LogsTab({
  logs,
  stats,
  actionFilter,
  setActionFilter,
  limit,
  setLimit,
  onRefresh,
  loading,
  isError,
  isFetching,
}: {
  logs: LogRow[];
  stats: Array<[string, number]>;
  actionFilter: string;
  setActionFilter: (s: string) => void;
  limit: number;
  setLimit: (n: number) => void;
  onRefresh: () => void;
  loading: boolean;
  isError: boolean;
  isFetching: boolean;
}) {
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 lg:col-span-3 card p-0 overflow-hidden h-fit">
        <div className="px-3 py-2 border-b border-border bg-bg-soft/40 flex items-center justify-between">
          <span className="text-sm font-medium flex items-center gap-1.5">
            <ListFilter size={13} /> 액션 통계
          </span>
          <span className="text-xs text-fg-subtle">{stats.length}종</span>
        </div>
        <div className="max-h-[70vh] overflow-y-auto divide-y divide-border" role="radiogroup" aria-label="액션 필터">
          <button
            type="button"
            onClick={() => setActionFilter('')}
            role="radio"
            aria-checked={!actionFilter}
            className={cn(
              'w-full text-left px-3 py-2 text-xs flex items-center justify-between focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
              !actionFilter ? 'bg-accent/10 text-accent' : 'hover:bg-bg-soft/40',
            )}
          >
            <span>전체</span>
            <span className="font-mono">{logs.length}</span>
          </button>
          {stats.map(([action, n]) => (
            <button
              key={action}
              type="button"
              onClick={() => setActionFilter(action)}
              role="radio"
              aria-checked={actionFilter === action}
              className={cn(
                'w-full text-left px-3 py-2 text-xs flex items-center justify-between font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                actionFilter === action ? 'bg-accent/10 text-accent' : 'hover:bg-bg-soft/40',
              )}
            >
              <span className="truncate">{action}</span>
              <span>{n}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="col-span-12 lg:col-span-9 card p-0 overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-bg-soft/40 flex items-center gap-2 flex-wrap">
          <Search size={13} className="text-fg-subtle" aria-hidden="true" />
          <input
            type="search"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="action 패턴 (예: cs.update)"
            aria-label="action 필터"
            className="input text-xs py-1 w-48 font-mono"
          />
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            aria-label="조회 개수"
            className="input text-xs py-1 w-24"
          >
            <option value={50}>50건</option>
            <option value={100}>100건</option>
            <option value={200}>200건</option>
            <option value={500}>500건</option>
          </select>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isFetching}
            className="btn-outline text-xs flex items-center gap-1 ml-auto disabled:opacity-60"
          >
            {isFetching ? <Spinner size={12} /> : <RefreshCcw size={12} />} 새로고침
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {loading ? (
            <LoadingPanel label="로그를 불러오는 중…" className="py-10" />
          ) : isError ? (
            <EmptyState
              tone="error"
              icon={AlertTriangle}
              title="로그를 불러오지 못했습니다"
              hint="네트워크 상태를 확인하거나 잠시 후 다시 시도해 주세요."
              action={
                <button className="btn-outline" onClick={onRefresh}>
                  다시 시도
                </button>
              }
              className="border-0"
            />
          ) : logs.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={actionFilter ? `"${actionFilter}" 패턴에 해당하는 로그가 없습니다` : '기록된 로그가 없습니다'}
              hint={actionFilter ? '패턴을 지우거나 다른 액션을 시도해 보세요.' : '작업이 발생하면 여기에 기록됩니다.'}
              action={
                actionFilter && (
                  <button className="btn-outline" onClick={() => setActionFilter('')}>
                    필터 초기화
                  </button>
                )
              }
              className="border-0"
            />
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-bg-soft/30 sticky top-0">
                <tr className="text-fg-subtle">
                  <th className="text-left px-3 py-1.5 font-normal">시각</th>
                  <th className="text-left px-3 py-1.5 font-normal">실행자</th>
                  <th className="text-left px-3 py-1.5 font-normal">액션</th>
                  <th className="text-left px-3 py-1.5 font-normal">대상</th>
                  <th className="text-left px-3 py-1.5 font-normal">메타</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((r) => (
                  <tr key={r.id} className="hover:bg-bg-soft/30">
                    <td className="px-3 py-1.5 text-fg-subtle whitespace-nowrap">
                      <div>{relative(r.created_at)}</div>
                      <div className="text-[10px]">{fmtDateTime(r.created_at)}</div>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <span className="flex items-center gap-1 text-fg-muted">
                        <UserIcon size={11} /> {r.actor_name ?? `#${r.actor_id ?? '-'}`}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-[11px] text-accent">{r.action}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-fg-subtle">
                      {r.target ?? '-'}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-fg-subtle max-w-xs truncate">
                      {r.meta_json ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsTab({
  settings,
  isLoading,
  isError,
  onRetry,
}: {
  settings: SettingRow[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="card text-xs text-fg-muted flex items-start gap-2">
        <ShieldAlert size={14} className="text-amber-300 shrink-0 mt-0.5" />
        <div>
          시스템 설정은 전역 운영 파라미터(SLA 시간, 휴가 기본 잔여, 템플릿 활성 버전 등)를 담습니다.
          값은 JSON 형식이어야 하며 저장 시 즉시 반영됩니다.
        </div>
      </div>
      {isLoading ? (
        <LoadingPanel label="설정을 불러오는 중…" />
      ) : isError ? (
        <EmptyState
          tone="error"
          icon={AlertTriangle}
          title="설정을 불러오지 못했습니다"
          action={
            <button className="btn-outline" onClick={onRetry}>
              다시 시도
            </button>
          }
        />
      ) : settings.length === 0 ? (
        <EmptyState
          icon={Settings2}
          title="등록된 설정이 없습니다"
          hint="아래 “설정 추가”로 첫 key/value를 등록해 보세요."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {settings.map((s) => (
            <SettingEditor key={s.key} setting={s} />
          ))}
        </div>
      )}
      <NewSettingForm />
    </div>
  );
}

function SettingEditor({ setting }: { setting: SettingRow }) {
  const { user } = useSession();
  const api = getApi();
  const [value, setValue] = useState(setting.value_json);
  const [touched, setTouched] = useState(false);

  const jsonErr = validateJson(value);
  const showErr = touched ? jsonErr : null;

  const mut = useMutationWithToast({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      if (jsonErr) throw new Error(jsonErr);
      return api.settings.set({
        key: setting.key,
        valueJson: value,
        actorId: user.id,
      });
    },
    successMessage: `"${setting.key}" 설정이 저장되었습니다`,
    errorMessage: '설정 저장에 실패했습니다',
    invalidates: [['settings.list']],
  });

  const dirty = value !== setting.value_json;

  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-sm text-fg">{setting.key}</div>
        <div className="text-[10px] text-fg-subtle">{relative(setting.updated_at)}</div>
      </div>
      <FormField error={showErr} hint="JSON 형식 · 변경 후 저장을 눌러 주세요">
        {(slot) => (
          <Textarea
            {...slot}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (!touched) setTouched(true);
            }}
            onBlur={() => setTouched(true)}
            rows={4}
            className="text-xs font-mono"
            spellCheck={false}
          />
        )}
      </FormField>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!dirty || mut.isPending || !!jsonErr}
          onClick={() => mut.mutate()}
          className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
        >
          {mut.isPending ? <Spinner size={11} /> : <Save size={11} />} 저장
        </button>
        {mut.isSuccess && !dirty && (
          <span className="text-[11px] text-emerald-300 flex items-center gap-1" role="status">
            <CheckCircle2 size={11} /> 저장됨
          </span>
        )}
      </div>
    </div>
  );
}

function NewSettingForm() {
  const { user } = useSession();
  const api = getApi();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('{}');
  const [touched, setTouched] = useState<{ key?: boolean; value?: boolean }>({});

  const keyRules = firstError<string>([
    required('key를 입력해 주세요'),
    maxLength(KEY_MAX),
    (v) => (KEY_RE.test(v) ? null : '영문 소문자/숫자/._- 조합으로 입력해 주세요'),
  ]);
  const keyErr = keyRules(key);
  const valueErr = validateJson(value);

  const showKeyErr = touched.key ? keyErr : null;
  const showValueErr = touched.value ? valueErr : null;

  const mut = useMutationWithToast({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      return api.settings.set({
        key: key.trim(),
        valueJson: value,
        actorId: user.id,
      });
    },
    successMessage: `"${key.trim()}" 설정이 추가되었습니다`,
    errorMessage: '설정 추가에 실패했습니다',
    invalidates: [['settings.list']],
    onSuccess: (res) => {
      if (res.ok) {
        setKey('');
        setValue('{}');
        setTouched({});
      }
    },
  });

  const invalid = !!(keyErr || valueErr);
  const handleSubmit = () => {
    setTouched({ key: true, value: true });
    if (invalid) return;
    mut.mutate();
  };

  return (
    <div className="card space-y-2">
      <h3 className="text-sm font-semibold">설정 추가</h3>
      <FormField
        label="key"
        required
        error={showKeyErr}
        hint="예: sla.qa1_hours"
        count={key.length}
        max={KEY_MAX}
      >
        {(slot) => (
          <TextInput
            {...slot}
            type="text"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, key: true }))}
            placeholder="sla.qa1_hours"
            className="font-mono text-xs"
            maxLength={KEY_MAX + 20}
          />
        )}
      </FormField>
      <FormField
        label="JSON 값"
        required
        error={showValueErr}
        hint="예: {&quot;hours&quot;: 24}"
      >
        {(slot) => (
          <Textarea
            {...slot}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, value: true }))}
            rows={3}
            className="text-xs font-mono"
            placeholder='{"hours": 24}'
            spellCheck={false}
          />
        )}
      </FormField>
      <button
        type="button"
        disabled={mut.isPending}
        onClick={handleSubmit}
        className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
      >
        {mut.isPending ? <Spinner size={11} /> : <Save size={11} />} 추가
      </button>
    </div>
  );
}

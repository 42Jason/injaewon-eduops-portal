import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bot, ShieldAlert, Settings2, Save, Search, RefreshCcw, FileCode,
  CheckCircle2, XCircle, User as UserIcon, ListFilter,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { fmtDateTime, relative } from '@/lib/date';
import { cn } from '@/lib/cn';

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

export function AutomationPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();

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
      }) as Promise<LogRow[]>,
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
        <div className="flex items-center gap-1 bg-bg-soft rounded-lg p-1">
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
          onRefresh={() => qc.invalidateQueries({ queryKey: ['logs.list'] })}
          loading={logsQuery.isLoading}
        />
      )}

      {tab === 'settings' && (
        <SettingsTab settings={(settingsQuery.data ?? []) as SettingRow[]} />
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
      className={cn(
        'px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 transition',
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
}: {
  logs: LogRow[];
  stats: Array<[string, number]>;
  actionFilter: string;
  setActionFilter: (s: string) => void;
  limit: number;
  setLimit: (n: number) => void;
  onRefresh: () => void;
  loading: boolean;
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
        <div className="max-h-[70vh] overflow-y-auto divide-y divide-border">
          <button
            type="button"
            onClick={() => setActionFilter('')}
            className={cn(
              'w-full text-left px-3 py-2 text-xs flex items-center justify-between',
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
              className={cn(
                'w-full text-left px-3 py-2 text-xs flex items-center justify-between font-mono',
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
          <Search size={13} className="text-fg-subtle" />
          <input
            type="text"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="action 패턴 (예: cs.update)"
            className="input text-xs py-1 w-48 font-mono"
          />
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
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
            className="btn-outline text-xs flex items-center gap-1 ml-auto"
          >
            <RefreshCcw size={12} /> 새로고침
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {loading && (
            <div className="p-6 text-center text-sm text-fg-subtle">로딩 중…</div>
          )}
          {!loading && logs.length === 0 && (
            <div className="p-6 text-center text-sm text-fg-subtle">로그 없음</div>
          )}
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
        </div>
      </div>
    </div>
  );
}

function SettingsTab({ settings }: { settings: SettingRow[] }) {
  return (
    <div className="space-y-3">
      <div className="card text-xs text-fg-muted flex items-start gap-2">
        <ShieldAlert size={14} className="text-amber-300 shrink-0 mt-0.5" />
        <div>
          시스템 설정은 전역 운영 파라미터(SLA 시간, 휴가 기본 잔여, 템플릿 활성 버전 등)를 담습니다.
          값은 JSON 형식이어야 하며 저장 시 즉시 반영됩니다.
        </div>
      </div>
      {settings.length === 0 && (
        <div className="card text-sm text-fg-subtle">등록된 설정이 없습니다.</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {settings.map((s) => (
          <SettingEditor key={s.key} setting={s} />
        ))}
      </div>
      <NewSettingForm />
    </div>
  );
}

function SettingEditor({ setting }: { setting: SettingRow }) {
  const { user } = useSession();
  const api = getApi();
  const qc = useQueryClient();
  const [value, setValue] = useState(setting.value_json);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      try {
        JSON.parse(value);
      } catch {
        throw new Error('유효한 JSON이 아닙니다.');
      }
      const res = await api.settings.set({
        key: setting.key,
        valueJson: value,
        actorId: user.id,
      });
      if (!res.ok) throw new Error(res.error ?? '저장 실패');
      return res;
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['settings.list'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const dirty = value !== setting.value_json;

  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-sm text-fg">{setting.key}</div>
        <div className="text-[10px] text-fg-subtle">{relative(setting.updated_at)}</div>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        className="input text-xs font-mono w-full"
      />
      {error && (
        <div className="text-[11px] text-rose-300 border border-rose-500/40 bg-rose-500/10 rounded px-2 py-1">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!dirty || mut.isPending}
          onClick={() => mut.mutate()}
          className="btn-primary text-xs flex items-center gap-1"
        >
          <Save size={11} /> 저장
        </button>
        {mut.isSuccess && !dirty && (
          <span className="text-[11px] text-emerald-300 flex items-center gap-1">
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
  const qc = useQueryClient();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('{}');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      if (!key.trim()) throw new Error('key 필수');
      try {
        JSON.parse(value);
      } catch {
        throw new Error('유효한 JSON이 아닙니다.');
      }
      const res = await api.settings.set({
        key: key.trim(),
        valueJson: value,
        actorId: user.id,
      });
      if (!res.ok) throw new Error(res.error ?? '저장 실패');
      return res;
    },
    onSuccess: () => {
      setKey('');
      setValue('{}');
      setError(null);
      qc.invalidateQueries({ queryKey: ['settings.list'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="card space-y-2">
      <h3 className="text-sm font-semibold">설정 추가</h3>
      <div className="flex gap-2">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="key (예: sla.qa1_hours)"
          className="input text-xs font-mono flex-1"
        />
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        className="input text-xs font-mono w-full"
        placeholder='JSON 값 (예: {"hours": 24})'
      />
      {error && (
        <div className="text-[11px] text-rose-300 border border-rose-500/40 bg-rose-500/10 rounded px-2 py-1">
          {error}
        </div>
      )}
      <button
        type="button"
        disabled={mut.isPending}
        onClick={() => mut.mutate()}
        className="btn-primary text-xs flex items-center gap-1"
      >
        <Save size={11} /> 추가
      </button>
    </div>
  );
}

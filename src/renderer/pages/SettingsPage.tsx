import { useEffect, useMemo, useState } from 'react';
import {
  Settings as SettingsIcon,
  User as UserIcon,
  Monitor,
  Moon,
  Sun,
  RefreshCw,
  Shield,
  Save,
  CheckCircle2,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useToast } from '@/stores/toast';
import { cn } from '@/lib/cn';
import { hasRole, ROLE_GROUPS } from '@/lib/roleAccess';
import { ROLE_LABELS } from '@shared/types/user';
import { UpdateCheckButton } from '@/components/UpdateBanner';

type Theme = 'system' | 'light' | 'dark';
const THEME_KEY = 'eduops.theme.v1';

function readTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // ignore
  }
  return 'system';
}

function applyTheme(t: Theme) {
  const root = document.documentElement;
  const dark =
    t === 'dark' ||
    (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
}

export function SettingsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const qc = useQueryClient();
  const toast = useToast();

  const [theme, setTheme] = useState<Theme>(readTheme());
  const canManageSystemSettings = hasRole(user?.role, ROLE_GROUPS.executive);
  const [appInfo, setAppInfo] = useState<{
    version: string;
    platform: string;
    dbPath: string;
    isDev: boolean;
  } | null>(null);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    if (!api) return;
    api.app.info().then(setAppInfo).catch(() => {});
  }, [api]);

  const settingsQuery = useQuery({
    queryKey: ['settings.list'],
    queryFn: () => api!.settings.list(),
    enabled: live && canManageSystemSettings,
  });

  const parsedSettings = useMemo(() => {
    const rows = settingsQuery.data ?? [];
    return rows.map((r) => {
      let parsed: unknown = r.value_json;
      try {
        parsed = JSON.parse(r.value_json);
      } catch {
        // keep raw
      }
      return { ...r, parsed };
    });
  }, [settingsQuery.data]);

  async function saveSetting(key: string, rawJson: string) {
    if (!api || !user) return;
    try {
      JSON.parse(rawJson);
    } catch {
      toast.err('JSON 형식이 올바르지 않습니다.');
      return;
    }
    const r = await api.settings.set({ key, valueJson: rawJson, actorId: user.id });
    if (r.ok) {
      toast.ok(`'${key}' 저장되었습니다.`);
      qc.invalidateQueries({ queryKey: ['settings.list'] });
    } else {
      toast.err(r.error ?? '저장 실패');
    }
  }

  const [editing, setEditing] = useState<Record<string, string>>({});

  if (!live) {
    return (
      <div className="card">
        <h1 className="text-lg font-semibold text-fg">설정</h1>
        <p className="mt-2 text-sm text-fg-muted">
          로그인 후에 설정을 변경할 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">설정</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          개인 환경 설정과 앱 정보를 관리합니다.
        </p>
      </div>

      {/* Profile */}
      <section className="card">
        <div className="flex items-center gap-2 mb-3">
          <UserIcon size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-fg">내 프로필</h2>
        </div>
        <dl className="grid grid-cols-1 gap-y-2 gap-x-6 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">이름</dt>
            <dd className="text-fg">{user.name}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">이메일</dt>
            <dd className="text-fg truncate">{user.email}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">역할</dt>
            <dd className="text-fg">{ROLE_LABELS[user.role]}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-fg-muted">부서</dt>
            <dd className="text-fg">{user.departmentName ?? '—'}</dd>
          </div>
          {user.title && (
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">직함</dt>
              <dd className="text-fg">{user.title}</dd>
            </div>
          )}
          {user.phone && (
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">연락처</dt>
              <dd className="text-fg">{user.phone}</dd>
            </div>
          )}
        </dl>
        <p className="mt-3 text-[11px] text-fg-subtle">
          연락처·직함 수정은 행정/인사 담당자에게 요청해 주세요.
        </p>
      </section>

      {/* Appearance */}
      <section className="card">
        <div className="flex items-center gap-2 mb-3">
          <Monitor size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-fg">테마</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: 'system', label: '시스템 기본', Icon: Monitor },
              { key: 'light', label: '라이트', Icon: Sun },
              { key: 'dark', label: '다크', Icon: Moon },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTheme(key)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                theme === key
                  ? 'border-accent bg-accent/10 text-fg'
                  : 'border-border text-fg-muted hover:bg-bg-soft hover:text-fg',
              )}
            >
              <Icon size={12} />
              {label}
              {theme === key && <CheckCircle2 size={12} className="text-accent" />}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-fg-subtle">
          선택한 테마는 이 컴퓨터에만 저장됩니다.
        </p>
      </section>

      {/* App info + updates */}
      <section className="card">
        <div className="flex items-center gap-2 mb-3">
          <SettingsIcon size={14} className="text-accent" />
          <h2 className="text-sm font-semibold text-fg">앱 정보</h2>
          <div className="ml-auto">
            <UpdateCheckButton />
          </div>
        </div>
        {appInfo ? (
          <dl className="grid grid-cols-1 gap-y-2 gap-x-6 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">버전</dt>
              <dd className="text-fg font-mono">{appInfo.version}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">플랫폼</dt>
              <dd className="text-fg font-mono">{appInfo.platform}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">모드</dt>
              <dd className="text-fg">{appInfo.isDev ? '개발 모드' : '배포 빌드'}</dd>
            </div>
            <div className="flex items-start justify-between gap-3 sm:col-span-2">
              <dt className="text-fg-muted whitespace-nowrap">DB 경로</dt>
              <dd
                className="text-[11px] text-fg-muted font-mono break-all text-right"
                title={appInfo.dbPath}
              >
                {appInfo.dbPath}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-fg-subtle">불러오는 중…</p>
        )}
      </section>

      {/* Admin settings — leadership only */}
      {canManageSystemSettings && (
        <section className="card">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-accent" />
            <h2 className="text-sm font-semibold text-fg">시스템 설정 (관리자)</h2>
            <button
              type="button"
              onClick={() => qc.invalidateQueries({ queryKey: ['settings.list'] })}
              className="btn-ghost text-xs ml-auto"
            >
              <RefreshCw size={12} className={cn(settingsQuery.isFetching && 'animate-spin')} /> 새로고침
            </button>
          </div>
          {settingsQuery.isLoading ? (
            <p className="text-xs text-fg-subtle">불러오는 중…</p>
          ) : parsedSettings.length === 0 ? (
            <p className="text-sm text-fg-muted">
              저장된 시스템 설정이 아직 없습니다. CTO 자동화 페이지에서 최초 키를 생성할 수 있습니다.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {parsedSettings.map((s) => {
                const raw = editing[s.key] ?? s.value_json;
                const dirty = editing[s.key] !== undefined && editing[s.key] !== s.value_json;
                return (
                  <li key={s.key} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-xs text-fg">{s.key}</code>
                      <span className="text-[11px] text-fg-subtle">
                        {new Date(s.updated_at).toLocaleString('ko-KR')}
                      </span>
                    </div>
                    <textarea
                      className="input mt-2 min-h-[70px] font-mono text-[11px]"
                      value={raw}
                      onChange={(e) =>
                        setEditing((m) => ({ ...m, [s.key]: e.target.value }))
                      }
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      {dirty && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditing((m) => {
                              const { [s.key]: _ignored, ...rest } = m;
                              return rest;
                            })
                          }
                          className="btn-ghost text-xs"
                        >
                          되돌리기
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!dirty}
                        onClick={() => saveSetting(s.key, raw)}
                        className="btn-primary text-xs"
                      >
                        <Save size={12} /> 저장
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

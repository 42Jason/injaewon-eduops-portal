import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Loader2, Download, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';

/**
 * Game-launcher style pre-login update gate.
 *
 * Boots in `waiting` mode the moment the app window shows up. Its job is to
 * hold the renderer hostage — render nothing but an overlay — until exactly
 * one of the following resolves:
 *
 *   1. `not-available`  → fresh version already installed, dismiss immediately
 *   2. `error`          → show the short reason for a beat, then dismiss so the
 *                         user can still log in (the sidebar `<UpdateBanner>`
 *                         picks up persistent errors separately)
 *   3. `ready`          → update downloaded, start a countdown then trigger
 *                         `quitAndInstall()` automatically (Steam / Battle.net
 *                         pattern)
 *   4. idle > 12 s      → we probably never got a check response (offline,
 *                         dev mode that wasn't flagged, CDN hang). Bail.
 *
 * The gate deliberately does NOT block the app on `error`: a flaky GitHub
 * response should never lock employees out of the portal. It only blocks when
 * we are *actively* doing something (checking / downloading / ready).
 *
 * Dev + browser-preview shortcut: if `window.api` is missing or the main
 * process reports `dev_mode`, we dismiss on the next tick.
 */

type Phase = 'waiting' | 'dismissed';

// Hard ceiling on how long we'll sit on `idle` before giving up — users
// shouldn't have to stare at a spinner because GitHub is having a bad day.
const IDLE_TIMEOUT_MS = 12_000;

// Auto-install countdown once the download is `ready`. Long enough for the
// user to read "재시작됩니다" and hit 건너뛰기 if they really can't afford a
// restart right now, short enough that it still feels automatic.
const INSTALL_COUNTDOWN_S = 5;

// Error splash duration before we dismiss. Short — the sidebar banner owns
// the long-form error UX, the gate just acknowledges and gets out of the way.
const ERROR_DISMISS_MS = 2_500;

// How long before we offer a user-visible "건너뛰기" escape hatch, in case
// the check hangs in a state we didn't anticipate.
const SKIP_VISIBLE_AFTER_MS = 6_000;

function shortReason(msg: string | undefined | null): string {
  if (!msg) return '확인 실패';
  const m = String(msg);
  if (/Unable to find latest version/i.test(m) || /releases\/latest/i.test(m))
    return 'GitHub 릴리즈를 찾지 못함';
  if (/404/.test(m)) return '릴리즈 없음';
  if (/406/.test(m)) return '업데이트 서버 응답 오류';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(m)) return '네트워크 연결 실패';
  if (/signature|signed/i.test(m)) return '서명 검증 실패';
  return m.replace(/\s+/g, ' ').slice(0, 60);
}

function formatBytes(n: number): string {
  if (!n || !Number.isFinite(n)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function UpdateGate({ children }: { children: ReactNode }) {
  const api = getApi();
  const [phase, setPhase] = useState<Phase>('waiting');
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'idle' });
  const [countdown, setCountdown] = useState<number>(INSTALL_COUNTDOWN_S);
  const [skipVisible, setSkipVisible] = useState(false);
  const [installing, setInstalling] = useState(false);

  // We track whether the gate has definitively resolved — once dismissed, no
  // future status event is allowed to pull it back up. Employees tapping away
  // at login shouldn't be interrupted by a background re-check that found a
  // release; those are handled by the sidebar banner.
  const resolvedRef = useRef(false);

  // --- Fast-path exits: no API (browser preview) or dev mode ---
  useEffect(() => {
    if (!api?.updater) {
      resolvedRef.current = true;
      setPhase('dismissed');
      return;
    }
    let cancelled = false;
    // Kick off a fresh check; in dev/unpackaged this returns `dev_mode` and
    // we bail instantly. In packaged builds this is redundant with the
    // `initAutoUpdater()` timer but harmless — electron-updater coalesces
    // back-to-back checkForUpdates() calls.
    api.updater
      .check()
      .then((r) => {
        if (cancelled) return;
        if (!r.ok && r.error === 'dev_mode') {
          resolvedRef.current = true;
          setPhase('dismissed');
        }
      })
      .catch(() => {
        // non-fatal — the status subscription will drive us
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // --- Subscribe to status ---
  useEffect(() => {
    if (!api?.updater) return;
    let cancelled = false;
    api.updater
      .status()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    const unsub = api.updater.onStatus((s) => {
      if (cancelled || resolvedRef.current) return;
      setStatus(s);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [api]);

  // --- Dismiss rules based on status ---
  useEffect(() => {
    if (resolvedRef.current) return;
    if (status.state === 'not-available') {
      resolvedRef.current = true;
      setPhase('dismissed');
    }
    if (status.state === 'error') {
      // Flash the error briefly then get out of the way.
      const t = window.setTimeout(() => {
        if (!resolvedRef.current) {
          resolvedRef.current = true;
          setPhase('dismissed');
        }
      }, ERROR_DISMISS_MS);
      return () => window.clearTimeout(t);
    }
  }, [status]);

  // --- Idle timeout: don't let the gate hang forever ---
  useEffect(() => {
    if (resolvedRef.current) return;
    const t = window.setTimeout(() => {
      if (!resolvedRef.current && status.state === 'idle') {
        resolvedRef.current = true;
        setPhase('dismissed');
      }
    }, IDLE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
    // Intentionally only runs on mount — we don't want to reset the timer
    // on every status change. If we leave `idle` the check is proceeding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Skip-button visibility timer ---
  useEffect(() => {
    const t = window.setTimeout(() => setSkipVisible(true), SKIP_VISIBLE_AFTER_MS);
    return () => window.clearTimeout(t);
  }, []);

  // --- Auto-install countdown when `ready` ---
  useEffect(() => {
    if (status.state !== 'ready') {
      setCountdown(INSTALL_COUNTDOWN_S);
      return;
    }
    let remaining = INSTALL_COUNTDOWN_S;
    setCountdown(remaining);
    const interval = window.setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        window.clearInterval(interval);
        void triggerInstall();
      }
    }, 1000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.state]);

  async function triggerInstall() {
    if (!api?.updater || installing) return;
    setInstalling(true);
    const r = await api.updater.install();
    if (!r.ok) {
      // Install failed — stop the countdown, surface the error and let the
      // user click 건너뛰기. Flipping to `error` means the dismiss timer will
      // take over.
      setStatus({ state: 'error', message: r.error ?? '설치 실패' });
      setInstalling(false);
    }
  }

  function skip() {
    resolvedRef.current = true;
    setPhase('dismissed');
  }

  // If we've decided to let the user through, render the actual app.
  if (phase === 'dismissed') return <>{children}</>;

  // --- Overlay UI ---
  const s = status;
  const showProgressBar = s.state === 'downloading';
  const progressPct = s.state === 'downloading' ? Math.max(3, Math.min(100, s.percent)) : 0;

  // Tailwind can't interpolate dynamic widths into utility classes reliably,
  // so we fall back to inline style for the bar fill.
  const progressStyle = { width: `${progressPct}%` } as const;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-bg text-fg"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-md px-6 text-center">
        {/* Header / brand */}
        <div className="mb-6">
          <div className="text-2xl font-semibold tracking-tight">EduOps 포털</div>
          <div className="mt-1 text-xs text-fg-subtle">업데이트 관리자</div>
        </div>

        {/* Status icon */}
        <div className="mb-4 flex justify-center">
          {(s.state === 'idle' || s.state === 'checking') && (
            <Loader2 size={44} className="animate-spin text-accent" />
          )}
          {s.state === 'available' && <Download size={44} className="text-accent" />}
          {s.state === 'downloading' && (
            <Loader2 size={44} className="animate-spin text-accent" />
          )}
          {s.state === 'ready' && <CheckCircle2 size={44} className="text-success" />}
          {s.state === 'not-available' && (
            <CheckCircle2 size={44} className="text-success" />
          )}
          {s.state === 'error' && <AlertTriangle size={44} className="text-danger" />}
        </div>

        {/* Status headline */}
        <div className="text-base font-medium">
          {s.state === 'idle' && '업데이트 확인을 시작합니다…'}
          {s.state === 'checking' && '업데이트 확인 중…'}
          {s.state === 'available' && `신규 버전 ${s.version} 준비 중…`}
          {s.state === 'downloading' && `업데이트 다운로드 중… ${s.percent}%`}
          {s.state === 'ready' &&
            (installing ? '재시작 중…' : `v${s.version} 설치 준비 완료`)}
          {s.state === 'not-available' && '최신 버전입니다'}
          {s.state === 'error' && `업데이트 오류 · ${shortReason(s.message)}`}
        </div>

        {/* Secondary line */}
        <div className="mt-1 text-xs text-fg-subtle min-h-[16px]">
          {s.state === 'idle' && '잠시만 기다려 주세요.'}
          {s.state === 'checking' && '서버에서 릴리즈를 조회하는 중입니다.'}
          {s.state === 'available' && '곧 다운로드가 시작됩니다.'}
          {s.state === 'downloading' &&
            `${formatBytes(s.transferred)} / ${formatBytes(s.total)}${
              s.bytesPerSecond ? ` · ${formatBytes(s.bytesPerSecond)}/s` : ''
            }`}
          {s.state === 'ready' &&
            !installing &&
            `${countdown}초 후 자동으로 재시작됩니다.`}
          {s.state === 'ready' && installing && '업데이트 설치가 시작되었습니다.'}
          {s.state === 'not-available' && '곧 로그인 화면으로 이동합니다.'}
          {s.state === 'error' && '로그인 화면으로 계속 진행합니다.'}
        </div>

        {/* Progress bar */}
        {showProgressBar && (
          <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-bg-soft">
            <div
              className="h-full bg-accent transition-[width] duration-300 ease-out"
              style={progressStyle}
            />
          </div>
        )}

        {/* Ready-state action buttons */}
        {s.state === 'ready' && !installing && (
          <div className="mt-6 flex justify-center gap-2">
            <button
              type="button"
              onClick={triggerInstall}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/50 bg-accent/20 px-3 py-1.5 text-sm font-medium text-fg hover:bg-accent/30"
            >
              <RefreshCw size={14} /> 지금 재시작
            </button>
            <button
              type="button"
              onClick={skip}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:bg-bg-soft"
            >
              나중에
            </button>
          </div>
        )}

        {/* Emergency skip — appears after a few seconds in case we're stuck */}
        {skipVisible && phase === 'waiting' && s.state !== 'ready' && (
          <div className="mt-8">
            <button
              type="button"
              onClick={skip}
              className={cn(
                'text-xs text-fg-subtle underline-offset-4 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
              )}
            >
              건너뛰기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

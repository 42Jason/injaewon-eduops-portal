import { useEffect, useState } from 'react';
import {
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  BellOff,
} from 'lucide-react';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';

/**
 * Compact update status card pinned to the bottom of the sidebar.
 *
 * Design goals (after repeated user complaints about the banner eating the
 * whole sidebar when a GitHub release was missing):
 *
 * 1. **Never grow tall.** The banner has a hard height cap. Long messages are
 *    collapsed behind a toggle; even when expanded, a scroll-area caps the box.
 * 2. **Error title only by default.** The raw electron-updater message (which
 *    can include CSP headers, URLs, stack traces) is hidden until the user
 *    explicitly expands it.
 * 3. **Three dismiss options:**
 *    - 24h snooze of the exact error (X)
 *    - Permanent kill-switch ("알림 끄기") per-machine (localStorage)
 *    - Status transitions (error → checking → error) don't re-open a snoozed
 *      or killed banner.
 * 4. **Accessible.** role="alert" for errors, role="status" for progress,
 *    aria-expanded on the disclosure, sr-only labels on icon buttons.
 */

const SNOOZE_KEY = 'eduops.updater.snoozed_errors.v1';
const DISABLED_KEY = 'eduops.updater.banner_disabled.v1';
const SNOOZE_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_VISIBLE_MESSAGE_LEN = 220; // soft cap when expanded

type SnoozeMap = Record<string, number>; // message -> expiresAt (unix ms)

function loadSnoozes(): SnoozeMap {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const now = Date.now();
    const out: SnoozeMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && v > now) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveSnoozes(map: SnoozeMap) {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(map));
  } catch {
    // storage full / disabled — non-fatal.
  }
}

function isSnoozed(map: SnoozeMap, msg: string | undefined | null): boolean {
  if (!msg) return false;
  const exp = map[msg];
  return typeof exp === 'number' && exp > Date.now();
}

function loadDisabled(): boolean {
  try {
    return localStorage.getItem(DISABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveDisabled(v: boolean) {
  try {
    if (v) localStorage.setItem(DISABLED_KEY, '1');
    else localStorage.removeItem(DISABLED_KEY);
  } catch {
    // non-fatal
  }
}

/** Boil a noisy electron-updater error down to a one-line summary for the title. */
function shortReason(msg: string | undefined | null): string {
  if (!msg) return '확인 실패';
  const m = String(msg);
  if (/Unable to find latest version/i.test(m) || /releases\/latest/i.test(m))
    return 'GitHub 릴리즈를 찾지 못함';
  if (/404/.test(m)) return '릴리즈 없음 (404)';
  if (/406/.test(m)) return '업데이트 서버 응답 오류 (406)';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(m)) return '네트워크 연결 실패';
  if (/signature|signed/i.test(m)) return '서명 검증 실패';
  // Fallback: first 60 chars, strip newlines
  return m.replace(/\s+/g, ' ').slice(0, 60);
}

export function UpdateBanner() {
  const api = getApi();
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [snoozes, setSnoozes] = useState<SnoozeMap>(() => loadSnoozes());
  const [disabled, setDisabled] = useState<boolean>(() => loadDisabled());
  const [expanded, setExpanded] = useState(false);

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
      if (!cancelled) {
        setStatus(s);
        setBusy(false);
        // Collapse automatically on state change so a new error doesn't open expanded
        setExpanded(false);
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [api]);

  if (!api?.updater) return null;

  // Quiet states — render nothing.
  if (status.state === 'idle' || status.state === 'not-available') return null;

  const isError = status.state === 'error';
  const isReady = status.state === 'ready';
  const isAvailable = status.state === 'available';
  const isDownloading = status.state === 'downloading';
  const isChecking = status.state === 'checking';

  // Kill-switch: user explicitly disabled the banner. Still show ready/available
  // (actionable, non-annoying) but never errors or progress chatter.
  if (disabled && (isError || isChecking || isDownloading)) return null;

  // Per-message 24h snooze for errors.
  if (isError && isSnoozed(snoozes, status.message)) return null;

  async function handleDownload() {
    if (!api?.updater) return;
    setBusy(true);
    setErr(null);
    const r = await api.updater.download();
    if (!r.ok) {
      setErr(r.error ?? '다운로드 실패');
      setBusy(false);
    }
  }

  async function handleInstall() {
    if (!api?.updater) return;
    setBusy(true);
    setErr(null);
    const r = await api.updater.install();
    if (!r.ok) {
      setErr(r.error ?? '설치 실패');
      setBusy(false);
    }
  }

  function snoozeCurrentError() {
    if (status.state !== 'error') return;
    const next: SnoozeMap = { ...snoozes, [status.message]: Date.now() + SNOOZE_MS };
    saveSnoozes(next);
    setSnoozes(next);
    setExpanded(false);
  }

  function permanentlyDisable() {
    saveDisabled(true);
    setDisabled(true);
    setExpanded(false);
  }

  const errorMsg = isError ? status.message : '';
  const trimmedMsg =
    errorMsg.length > MAX_VISIBLE_MESSAGE_LEN
      ? `${errorMsg.slice(0, MAX_VISIBLE_MESSAGE_LEN)}…`
      : errorMsg;

  return (
    <div
      className={cn(
        'mx-3 mb-3 rounded-md border px-2.5 py-2 text-xs shrink-0',
        isError && 'border-rose-500/40 bg-rose-500/10 text-rose-200',
        isReady && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
        (isAvailable || isDownloading || isChecking) && 'border-accent/40 bg-accent/10 text-fg',
      )}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'polite' : 'off'}
    >
      {/* Title row — always a single line, always the same height. */}
      <div className="flex items-center gap-1.5 font-medium">
        {isChecking && <Loader2 size={12} className="animate-spin shrink-0" />}
        {isAvailable && <Download size={12} className="shrink-0" />}
        {isDownloading && <Loader2 size={12} className="animate-spin shrink-0" />}
        {isReady && <CheckCircle2 size={12} className="shrink-0" />}
        {isError && <AlertTriangle size={12} className="shrink-0" />}
        <span className="flex-1 truncate" title={isError ? status.message : undefined}>
          {isChecking && '업데이트 확인 중…'}
          {isAvailable && `신규 버전 ${status.version}`}
          {isDownloading && `다운로드 ${status.percent}%`}
          {isReady && `재시작 시 v${status.version} 적용`}
          {isError && `업데이트 오류 · ${shortReason(status.message)}`}
        </span>
        {isError && (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-rose-300/80 hover:text-rose-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-300 rounded-sm shrink-0"
              aria-label={expanded ? '자세히 접기' : '자세히 보기'}
              aria-expanded={expanded}
              title={expanded ? '접기' : '자세히'}
            >
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            <button
              type="button"
              onClick={snoozeCurrentError}
              className="text-rose-300/80 hover:text-rose-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-300 rounded-sm shrink-0"
              aria-label="24시간 동안 숨기기"
              title="24시간 숨김"
            >
              <X size={12} />
            </button>
          </>
        )}
      </div>

      {isDownloading && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-black/30">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.max(3, status.percent)}%` }}
          />
        </div>
      )}

      {/* Error detail — COLLAPSED by default; only opens if the user clicks the chevron. */}
      {isError && expanded && (
        <div className="mt-1.5 space-y-1.5">
          <div
            className="max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded bg-black/20 px-2 py-1 text-[11px] leading-snug text-rose-100/90 font-mono"
            style={{ wordBreak: 'break-all' }}
          >
            {trimmedMsg || '(세부 내용 없음)'}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-rose-300/70">
              X = 24시간 숨김
            </span>
            <button
              type="button"
              onClick={permanentlyDisable}
              className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-200 hover:bg-rose-500/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-rose-300"
              title="이 PC 에서 업데이트 알림을 영구적으로 숨깁니다"
            >
              <BellOff size={10} /> 알림 끄기
            </button>
          </div>
        </div>
      )}

      {(isAvailable || isReady) && (
        <div className="mt-1.5 flex gap-1.5">
          {isAvailable && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={busy}
              className="flex-1 rounded border border-accent/50 bg-accent/20 px-2 py-1 text-[11px] font-medium text-fg hover:bg-accent/30 disabled:opacity-50"
            >
              <Download size={11} className="-mt-0.5 mr-1 inline" />
              다운로드
            </button>
          )}
          {isReady && (
            <button
              type="button"
              onClick={handleInstall}
              disabled={busy}
              className="flex-1 rounded border border-emerald-500/50 bg-emerald-500/20 px-2 py-1 text-[11px] font-medium text-fg hover:bg-emerald-500/30 disabled:opacity-50"
            >
              <RefreshCw size={11} className="-mt-0.5 mr-1 inline" />
              재시작 후 설치
            </button>
          )}
        </div>
      )}

      {err && <div className="mt-1 text-[11px] text-rose-300 break-all">{err}</div>}
    </div>
  );
}

/**
 * Compact "check for updates" link — can be dropped into Settings/Automation
 * later. Triggers a one-shot check; the banner surfaces the result.
 *
 * Re-enables the banner if it was previously killed — assumes user explicitly
 * asking for a check means they want to see the result.
 */
export function UpdateCheckButton() {
  const api = getApi();
  const [busy, setBusy] = useState(false);
  if (!api?.updater) return null;
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        // Re-enable banner so the user sees their requested result.
        try {
          localStorage.removeItem(DISABLED_KEY);
        } catch {
          // non-fatal
        }
        await api.updater!.check().finally(() => setBusy(false));
      }}
      className="btn-ghost text-xs flex items-center gap-1"
    >
      <RefreshCw size={11} className={cn(busy && 'animate-spin')} /> 업데이트 확인
    </button>
  );
}

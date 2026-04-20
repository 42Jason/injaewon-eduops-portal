import { useEffect, useState } from 'react';
import { Download, RefreshCw, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';

/**
 * Small update status card pinned to the bottom of the sidebar.
 * - Polls current status on mount, then subscribes to push events.
 * - Hidden entirely in dev / when no update is available (keeps the chrome clean).
 */
export function UpdateBanner() {
  const api = getApi();
  const [status, setStatus] = useState<UpdaterStatus>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [api]);

  if (!api?.updater) return null;

  // Hide the card entirely in quiet states — only show when user action is meaningful.
  if (status.state === 'idle' || status.state === 'not-available') return null;

  const isError = status.state === 'error';
  const isReady = status.state === 'ready';
  const isAvailable = status.state === 'available';
  const isDownloading = status.state === 'downloading';
  const isChecking = status.state === 'checking';

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

  return (
    <div
      className={cn(
        'mx-3 mb-3 rounded-md border px-2.5 py-2 text-xs',
        isError && 'border-rose-500/40 bg-rose-500/10 text-rose-200',
        isReady && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
        (isAvailable || isDownloading || isChecking) && 'border-accent/40 bg-accent/10 text-fg',
      )}
    >
      <div className="flex items-center gap-1.5 font-medium">
        {isChecking && <Loader2 size={12} className="animate-spin" />}
        {isAvailable && <Download size={12} />}
        {isDownloading && <Loader2 size={12} className="animate-spin" />}
        {isReady && <CheckCircle2 size={12} />}
        {isError && <AlertTriangle size={12} />}
        <span className="flex-1 truncate">
          {isChecking && '업데이트 확인 중…'}
          {isAvailable && `신규 버전 ${status.version}`}
          {isDownloading && `다운로드 ${status.percent}%`}
          {isReady && `재시작 시 v${status.version} 적용`}
          {isError && '업데이트 오류'}
        </span>
      </div>

      {isDownloading && (
        <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-black/30">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.max(3, status.percent)}%` }}
          />
        </div>
      )}

      {isError && <div className="mt-1 text-[11px] leading-snug">{status.message}</div>}

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

      {err && <div className="mt-1 text-[11px] text-rose-300">{err}</div>}
    </div>
  );
}

/**
 * Compact "check for updates" link — can be dropped into Settings/Automation
 * later. Triggers a one-shot check; the banner surfaces the result.
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
        await api.updater!.check().finally(() => setBusy(false));
      }}
      className="btn-ghost text-xs flex items-center gap-1"
    >
      <RefreshCw size={11} className={cn(busy && 'animate-spin')} /> 업데이트 확인
    </button>
  );
}

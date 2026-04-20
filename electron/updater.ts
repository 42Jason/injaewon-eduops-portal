import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
// electron-updater exposes its API as CommonJS named exports. Using a namespace
// import (and pulling `autoUpdater` off it at runtime) dodges the CJS/ESM interop
// pitfall where `default` would be undefined under esModuleInterop.
import * as electronUpdater from 'electron-updater';
const autoUpdater = electronUpdater.autoUpdater;

export type UpdaterState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string; releaseDate?: string }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number; transferred: number; total: number; bytesPerSecond: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

let currentStatus: UpdaterState = { state: 'idle' };
let targetWindow: BrowserWindow | null = null;

function broadcast(next: UpdaterState) {
  currentStatus = next;
  const win = targetWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send('updater:status', next);
  }
}

function hasConfiguredUpdateRepo(): boolean {
  // Guard against shipping the placeholder GitHub repo URL. Without this check
  // the updater pings `github.com/YOUR_GITHUB_USER/...` every 6h and surfaces a
  // noisy 404 banner in the sidebar on a fresh install.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pkg = require(path.join(app.getAppPath(), 'package.json')) as {
      repository?: { url?: string } | string;
    };
    const raw =
      typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '';
    if (!raw) return false;
    if (raw.includes('YOUR_GITHUB_USER')) return false;
    if (raw.includes('example.com')) return false;
    return true;
  } catch (err) {
    console.warn('[updater] could not read repository config:', err);
    return false;
  }
}

function isUpdatableEnvironment(): boolean {
  // Only run the real updater when packaged + a real repo is configured.
  if (!app.isPackaged) return false;
  if (process.env.NODE_ENV === 'development') return false;
  if (!hasConfiguredUpdateRepo()) return false;
  return true;
}

export function setUpdaterWindow(win: BrowserWindow) {
  targetWindow = win;
}

export function initAutoUpdater() {
  if (!isUpdatableEnvironment()) {
    console.log('[updater] disabled (dev / unpackaged)');
    return;
  }

  // Let the user confirm the download — we surface the "available" status
  // and provide an explicit IPC to trigger downloadUpdate().
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('checking-for-update', () => {
    broadcast({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    broadcast({
      state: 'available',
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : Array.isArray(info.releaseNotes)
            ? info.releaseNotes
                .map((r) => (typeof r === 'string' ? r : r.note ?? ''))
                .join('\n\n')
            : undefined,
      releaseDate: info.releaseDate,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    broadcast({ state: 'not-available', version: info.version });
  });

  autoUpdater.on('download-progress', (p) => {
    broadcast({
      state: 'downloading',
      percent: Math.round(p.percent ?? 0),
      transferred: p.transferred ?? 0,
      total: p.total ?? 0,
      bytesPerSecond: p.bytesPerSecond ?? 0,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ state: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater] error:', err);
    const msg = err?.message ?? String(err);
    // Silently downgrade expected "no release yet / transient network" errors
    // to `not-available` so a fresh repo without published releases doesn't
    // spam the sidebar with a scary red banner every 6 hours.
    //
    // Keep this list generous: the update banner is non-critical UI — the user
    // can always click "업데이트 확인" in Settings. An opaque red banner is
    // worse than a silently deferred check.
    const isSuppressible =
      // GitHub response errors that almost always mean "no release yet" or
      // "rate limit" — neither is actionable by the user.
      /HttpError:\s*(?:400|401|403|404|406|409|410|429|5\d\d)/i.test(msg) ||
      // GitHub sometimes returns 406 with MIME-related messages when Release
      // feed shape is unexpected (e.g., empty release list on a fresh repo).
      /Cannot parse releases feed|releases feed|MIME|content-type/i.test(msg) ||
      /Cannot find (?:latest-[a-z-]+\.yml|latest\.yml)/i.test(msg) ||
      // Transient DNS / network / TLS / proxy failures.
      /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|EPIPE|net::ERR_|getaddrinfo/i.test(msg) ||
      /CERT_|SELF_SIGNED_CERT|UNABLE_TO_GET_ISSUER_CERT|DEPTH_ZERO_SELF_SIGNED_CERT/i.test(msg) ||
      // Common "no published release" / "empty feed" variants from electron-updater.
      /No (?:published|valid) versions? on/i.test(msg) ||
      /cannot download|Unable to find latest version/i.test(msg) ||
      // Checksum / signature glitches during partial download — the next poll
      // usually succeeds, so downgrading avoids a sticky red banner.
      /sha\d+ checksum mismatch|Integrity check|Signature is invalid/i.test(msg);
    if (isSuppressible) {
      console.warn('[updater] suppressing transient/no-release error:', msg);
      broadcast({ state: 'not-available', version: app.getVersion() });
      return;
    }
    broadcast({ state: 'error', message: msg });
  });

  // First check after a short delay so we don't race the initial window load.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] initial check failed:', err);
    });
  }, 8_000);

  // Re-check every 6 hours.
  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch(() => {});
    },
    6 * 60 * 60 * 1000,
  );
}

export function registerUpdaterIpc() {
  ipcMain.handle('updater:status', () => currentStatus);

  ipcMain.handle('updater:check', async () => {
    if (!isUpdatableEnvironment()) {
      return { ok: false, error: 'dev_mode' };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('updater:download', async () => {
    if (!isUpdatableEnvironment()) {
      return { ok: false, error: 'dev_mode' };
    }
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('updater:install', () => {
    if (!isUpdatableEnvironment()) {
      return { ok: false, error: 'dev_mode' };
    }
    // isSilent=false keeps the NSIS UI shown; isForceRunAfter=true relaunches on finish.
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });
}

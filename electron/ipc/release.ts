import { ipcMain, safeStorage } from 'electron';
import { getDb } from '../db';
import { requireRole, ROLE_SETS } from '../auth';

type ReleaseIpcDeps = {
  logActivity: (
    db: ReturnType<typeof getDb>,
    actorId: number | null,
    action: string,
    target: string,
    meta: Record<string, unknown>,
  ) => void;
};

// ===========================================================================
// In-app release trigger (leadership only).
//
//   release:getConfig   → whether a PAT is stored + current repo/workflow
//   release:setConfig   → save PAT (safeStorage-encrypted) + repo overrides
//   release:clearConfig → wipe PAT
//   release:trigger     → POST GitHub Actions workflow_dispatch
//   release:listRuns    → poll recent workflow runs
//
// The PAT is stored base64-encrypted via Electron's safeStorage (OS keychain
// where available) in admin_settings under the key `release.config.v1`. It
// is NEVER returned to the renderer — only `{ hasPat: true }`.
// ===========================================================================

type ReleaseConfigStored = {
  repoOwner: string;
  repoName: string;
  workflowFile: string;
  patCipherBase64?: string;
};

const RELEASE_SETTING_KEY = 'release.config.v1';
const RELEASE_DEFAULT: ReleaseConfigStored = {
  repoOwner: '42Jason',
  repoName: 'injaewon-eduops-portal',
  workflowFile: 'release-bump.yml',
};

function readReleaseConfig(): ReleaseConfigStored {
  const db = getDb();
  const row = db
    .prepare(`SELECT value_json FROM admin_settings WHERE key = ?`)
    .get(RELEASE_SETTING_KEY) as { value_json: string } | undefined;
  if (!row) return { ...RELEASE_DEFAULT };
  try {
    const parsed = JSON.parse(row.value_json) as Partial<ReleaseConfigStored>;
    return {
      repoOwner: parsed.repoOwner ?? RELEASE_DEFAULT.repoOwner,
      repoName: parsed.repoName ?? RELEASE_DEFAULT.repoName,
      workflowFile: parsed.workflowFile ?? RELEASE_DEFAULT.workflowFile,
      patCipherBase64: parsed.patCipherBase64,
    };
  } catch {
    return { ...RELEASE_DEFAULT };
  }
}

function writeReleaseConfig(cfg: ReleaseConfigStored) {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO admin_settings (key, value_json, updated_at)
     VALUES (?, ?, datetime('now'))`,
  ).run(RELEASE_SETTING_KEY, JSON.stringify(cfg));
}

function decryptPat(cfg: ReleaseConfigStored): string | null {
  if (!cfg.patCipherBase64) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = Buffer.from(cfg.patCipherBase64, 'base64');
    return safeStorage.decryptString(buf);
  } catch (err) {
    console.warn('[ipc] release PAT decrypt failed', err);
    return null;
  }
}

export function registerReleaseIpc(appVersion: string, { logActivity }: ReleaseIpcDeps) {
  ipcMain.handle('release:getConfig', (event) => {
    requireRole(event, ROLE_SETS.leadership);
    const cfg = readReleaseConfig();
    return {
      ok: true as const,
      hasPat: Boolean(cfg.patCipherBase64),
      repoOwner: cfg.repoOwner,
      repoName: cfg.repoName,
      workflowFile: cfg.workflowFile,
      currentVersion: appVersion,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  });

  ipcMain.handle(
    'release:setConfig',
    (
      event,
      payload: {
        pat?: string | null;
        repoOwner?: string;
        repoName?: string;
        workflowFile?: string;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.leadership);
      const db = getDb();
      const current = readReleaseConfig();
      const next: ReleaseConfigStored = {
        repoOwner: payload.repoOwner?.trim() || current.repoOwner,
        repoName: payload.repoName?.trim() || current.repoName,
        workflowFile: payload.workflowFile?.trim() || current.workflowFile,
        patCipherBase64: current.patCipherBase64,
      };
      if (typeof payload.pat === 'string') {
        const trimmed = payload.pat.trim();
        if (trimmed.length === 0) {
          // empty string → clear PAT
          next.patCipherBase64 = undefined;
        } else {
          if (!safeStorage.isEncryptionAvailable()) {
            return { ok: false as const, error: 'safe_storage_unavailable' };
          }
          const cipher = safeStorage.encryptString(trimmed);
          next.patCipherBase64 = cipher.toString('base64');
        }
      }
      writeReleaseConfig(next);
      logActivity(db, actor.userId, 'release.configSet', 'release:config', {
        patChanged: typeof payload.pat === 'string',
        repoOwner: next.repoOwner,
        repoName: next.repoName,
        workflowFile: next.workflowFile,
      });
      return { ok: true as const };
    },
  );

  ipcMain.handle('release:clearConfig', (event) => {
    const actor = requireRole(event, ROLE_SETS.leadership);
    const db = getDb();
    const current = readReleaseConfig();
    writeReleaseConfig({
      repoOwner: current.repoOwner,
      repoName: current.repoName,
      workflowFile: current.workflowFile,
      patCipherBase64: undefined,
    });
    logActivity(db, actor.userId, 'release.configClear', 'release:config', {});
    return { ok: true as const };
  });

  ipcMain.handle(
    'release:trigger',
    async (
      event,
      payload: {
        bumpType: 'patch' | 'minor' | 'major';
        customVersion?: string | null;
        notes?: string | null;
      },
    ) => {
      const actor = requireRole(event, ROLE_SETS.leadership);
      const db = getDb();
      const cfg = readReleaseConfig();
      const pat = decryptPat(cfg);
      if (!pat) {
        return { ok: false as const, error: 'pat_missing' };
      }
      const url = `https://api.github.com/repos/${encodeURIComponent(cfg.repoOwner)}/${encodeURIComponent(cfg.repoName)}/actions/workflows/${encodeURIComponent(cfg.workflowFile)}/dispatches`;
      const body = {
        ref: 'main',
        inputs: {
          bump_type: payload.bumpType,
          custom_version: payload.customVersion?.trim() ?? '',
          notes: payload.notes?.trim() ?? '',
        },
      };
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${pat}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'User-Agent': 'EduOps-Portal-Release-Trigger',
          },
          body: JSON.stringify(body),
        });
        if (res.status === 204) {
          logActivity(db, actor.userId, 'release.triggered', 'release:bump', {
            bumpType: payload.bumpType,
            customVersion: payload.customVersion ?? null,
            notes: payload.notes ?? null,
          });
          return { ok: true as const };
        }
        const text = await res.text();
        return {
          ok: false as const,
          error: `github_${res.status}`,
          detail: text.slice(0, 500),
        };
      } catch (err) {
        return {
          ok: false as const,
          error: 'network_error',
          detail: (err as Error).message ?? String(err),
        };
      }
    },
  );

  ipcMain.handle('release:listRuns', async (event, payload?: { limit?: number }) => {
    requireRole(event, ROLE_SETS.leadership);
    const cfg = readReleaseConfig();
    const pat = decryptPat(cfg);
    if (!pat) {
      return { ok: false as const, error: 'pat_missing' };
    }
    const limit = Math.max(1, Math.min(20, payload?.limit ?? 10));
    const url = `https://api.github.com/repos/${encodeURIComponent(cfg.repoOwner)}/${encodeURIComponent(cfg.repoName)}/actions/runs?per_page=${limit}`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${pat}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'EduOps-Portal-Release-Trigger',
        },
      });
      if (!res.ok) {
        const text = await res.text();
        return {
          ok: false as const,
          error: `github_${res.status}`,
          detail: text.slice(0, 500),
        };
      }
      const json = (await res.json()) as {
        workflow_runs?: Array<{
          id: number;
          name?: string | null;
          display_title?: string | null;
          head_branch?: string | null;
          head_sha?: string | null;
          status?: string | null;
          conclusion?: string | null;
          event?: string | null;
          html_url?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          path?: string | null;
        }>;
      };
      const runs = (json.workflow_runs ?? []).map((r) => ({
        id: r.id,
        name: r.name ?? '',
        title: r.display_title ?? '',
        branch: r.head_branch ?? '',
        sha: (r.head_sha ?? '').slice(0, 7),
        status: r.status ?? '',
        conclusion: r.conclusion ?? '',
        event: r.event ?? '',
        url: r.html_url ?? '',
        createdAt: r.created_at ?? '',
        updatedAt: r.updated_at ?? '',
        path: r.path ?? '',
      }));
      return { ok: true as const, runs };
    } catch (err) {
      return {
        ok: false as const,
        error: 'network_error',
        detail: (err as Error).message ?? String(err),
      };
    }
  });
}

/**
 * Small helper — append an activity log row. Any error swallowed (logs must
 * never block the caller).
 */

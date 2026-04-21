import { create } from 'zustand';
import type { Role, SessionUser, User } from '@shared/types/user';

function derivePerms(role: Role): SessionUser['perms'] {
  const leadership = role === 'CEO' || role === 'CTO' || role === 'OPS_MANAGER';
  const ta = role === 'TA';
  // 정규직(= 조교가 아닌 사람). TA가 업로드한 파싱 엑셀을 보고 외부 프로그램으로
  // 수행평가를 생성하는 "소비자" 레인.
  const fullTimeParser = role === 'PARSER' || leadership;
  return {
    canReviewQA1: !ta && (role === 'QA1' || leadership),
    canReviewQAFinal: !ta && (role === 'QA_FINAL' || leadership),
    // TA도 파싱 업로드는 할 수 있다. 단, 실제 assignments 생성은 정규직만.
    canParseAssignments: ta || fullTimeParser,
    canManagePeople: !ta && (role === 'HR_ADMIN' || role === 'CEO' || role === 'OPS_MANAGER'),
    canApprove: !ta && (leadership || role === 'HR_ADMIN'),
    isLeadership: leadership,
    canReviewParsedExcel: fullTimeParser,
    isParsingAssistantOnly: ta,
  };
}

function toSessionUser(u: User): SessionUser {
  return { ...u, perms: derivePerms(u.role) };
}

interface SessionState {
  user: SessionUser | null;
  hydrated: boolean;
  login: (u: User) => void;
  logout: () => void;
  hydrateFromStorage: () => Promise<void>;
}

const STORAGE_KEY = 'eduops.session.v1';

export const useSession = create<SessionState>((set) => ({
  user: null,
  hydrated: false,
  login: (u) => {
    const session = toSessionUser(u);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    set({ user: session, hydrated: true });
  },
  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    try {
      void window.api?.auth.logout();
    } catch {
      // swallow — UI-level logout is what matters
    }
    set({ user: null });
  },
  /**
   * Restore the session on startup.
   *
   * localStorage alone isn't trusted — anyone can hand-edit it in DevTools and
   * forge a leadership role. So we:
   *   1. Ask the main process whether our webContents still has a live actor
   *      (see `auth:me`).
   *   2. If main says no, drop whatever localStorage had — treat it as forged
   *      or stale (e.g. the app was relaunched and the main session map is
   *      empty again).
   *   3. If main says yes, prefer main's actor over localStorage: main is the
   *      source of truth for role, so even if someone tampered with the stored
   *      JSON we'll correct it.
   */
  hydrateFromStorage: async () => {
    let stored: User | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw) as User;
    } catch {
      // corrupt — fall through as if nothing was stored
    }

    // Outside Electron (browser preview): trust storage only — there's no main
    // process to consult.
    const api = window.api;
    if (!api?.auth.me) {
      if (stored) set({ user: toSessionUser(stored), hydrated: true });
      else set({ hydrated: true });
      return;
    }

    try {
      const res = await api.auth.me();
      if (res.ok) {
        // Reconcile: prefer main's authoritative actor fields, but fall back
        // to stored details (title, avatar, etc.) for fields main doesn't
        // return.
        const base: User = stored ?? ({
          id: res.actor.userId,
          email: res.actor.email,
          name: res.actor.name,
          role: res.actor.role as Role,
          departmentId: res.actor.departmentId,
          active: true,
          createdAt: new Date().toISOString(),
        } as unknown as User);
        const merged: User = {
          ...base,
          id: res.actor.userId,
          email: res.actor.email,
          name: res.actor.name,
          role: res.actor.role as Role,
          departmentId: res.actor.departmentId,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        set({ user: toSessionUser(merged), hydrated: true });
        return;
      }
      // main says no active session — clear any forged/stale storage.
      localStorage.removeItem(STORAGE_KEY);
      set({ user: null, hydrated: true });
    } catch {
      // IPC itself failed — don't silently trust localStorage for a
      // privileged app. Force re-login.
      localStorage.removeItem(STORAGE_KEY);
      set({ user: null, hydrated: true });
    }
  },
}));

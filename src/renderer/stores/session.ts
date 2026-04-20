import { create } from 'zustand';
import type { Role, SessionUser, User } from '@shared/types/user';

function derivePerms(role: Role): SessionUser['perms'] {
  const leadership = role === 'CEO' || role === 'CTO' || role === 'OPS_MANAGER';
  return {
    canReviewQA1: role === 'QA1' || leadership,
    canReviewQAFinal: role === 'QA_FINAL' || leadership,
    canParseAssignments: role === 'PARSER' || leadership,
    canManagePeople: role === 'HR_ADMIN' || role === 'CEO' || role === 'OPS_MANAGER',
    canApprove: leadership || role === 'HR_ADMIN',
    isLeadership: leadership,
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
  hydrateFromStorage: () => void;
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
    set({ user: null });
  },
  hydrateFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const u = JSON.parse(raw) as User;
        set({ user: toSessionUser(u), hydrated: true });
        return;
      }
    } catch {
      // corrupt — fall through
    }
    set({ hydrated: true });
  },
}));

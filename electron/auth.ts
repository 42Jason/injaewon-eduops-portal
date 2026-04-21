import bcrypt from 'bcryptjs';
import type { Database as Db } from 'better-sqlite3';
import type { IpcMainInvokeEvent } from 'electron';

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  department_id: number | null;
  department_name: string | null;
  title: string | null;
  phone: string | null;
  avatar_url: string | null;
  active: number;
}

export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  role: string;
  departmentId: number | null;
  departmentName?: string;
  title?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  active: boolean;
  createdAt: string;
}

export interface LoginResult {
  ok: boolean;
  user?: AuthenticatedUser;
  error?: 'not_found' | 'inactive' | 'bad_password';
}

const SELECT_USER = `
  SELECT u.id, u.email, u.password_hash, u.name, u.role, u.department_id,
         u.title, u.phone, u.avatar_url, u.active,
         d.name AS department_name
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id
   WHERE u.email = ?
`;

export function login(db: Db, email: string, password: string): LoginResult {
  const row = db.prepare(SELECT_USER).get(email) as UserRow | undefined;
  if (!row) return { ok: false, error: 'not_found' };
  if (!row.active) return { ok: false, error: 'inactive' };

  const ok = bcrypt.compareSync(password, row.password_hash);
  if (!ok) return { ok: false, error: 'bad_password' };

  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      departmentId: row.department_id,
      departmentName: row.department_name ?? undefined,
      title: row.title,
      phone: row.phone,
      avatarUrl: row.avatar_url,
      active: !!row.active,
      createdAt: '',
    },
  };
}

// ---------------------------------------------------------------------------
//  Session registry & IPC guards
// ---------------------------------------------------------------------------
//  main process 에 "webContents.id → 로그인 유저" 맵을 하나 두고, 모든 민감
//  ipcMain.handle() 은 renderer 가 전달한 actorId 대신 여기에 저장된 actor 를
//  신뢰해서 권한을 판정한다. 이렇게 하면 renderer 쪽 스토어가 조작돼도
//  - 급여 조회·수정
//  - 직원 정보 수정/삭제
//  - 학생 삭제
//  - 노션 싱크
//  같은 핸들러가 권한 없는 상태로 호출되는 걸 막을 수 있음.
// ---------------------------------------------------------------------------

export type ActorRole = string;

export interface SessionActor {
  userId: number;
  email: string;
  name: string;
  role: ActorRole;
  departmentId: number | null;
  loggedInAt: number;
}

const sessions = new Map<number, SessionActor>();

/** 로그인 성공 시 webContents 기준으로 세션 등록. */
export function setSession(webContentsId: number, user: AuthenticatedUser): SessionActor {
  const actor: SessionActor = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    departmentId: user.departmentId,
    loggedInAt: Date.now(),
  };
  sessions.set(webContentsId, actor);
  return actor;
}

/** 로그아웃 / BrowserWindow close 시 세션 제거. */
export function clearSession(webContentsId: number): void {
  sessions.delete(webContentsId);
}

/** 현재 등록된 세션 전체 스냅샷 (디버그/감사용). */
export function listSessions(): Array<{ webContentsId: number; actor: SessionActor }> {
  return Array.from(sessions.entries()).map(([webContentsId, actor]) => ({
    webContentsId,
    actor,
  }));
}

/** IPC 이벤트에서 actor 를 꺼냄. 세션이 없으면 null. */
export function getActor(event: IpcMainInvokeEvent): SessionActor | null {
  return sessions.get(event.sender.id) ?? null;
}

// ---------------------------------------------------------------------------
//  Guard errors
// ---------------------------------------------------------------------------

export type AuthErrorCode = 'unauthorized' | 'forbidden';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? (code === 'unauthorized' ? '로그인이 필요합니다.' : '권한이 없습니다.'));
    this.name = 'AuthError';
    this.code = code;
  }
}

/** 로그인된 actor 만 통과. 세션 없으면 AuthError('unauthorized'). */
export function requireActor(event: IpcMainInvokeEvent): SessionActor {
  const actor = getActor(event);
  if (!actor) {
    throw new AuthError('unauthorized');
  }
  return actor;
}

/** 허용된 role 목록에 속하는 actor 만 통과. 아니면 AuthError('forbidden'). */
export function requireRole(
  event: IpcMainInvokeEvent,
  allowedRoles: readonly ActorRole[],
): SessionActor {
  const actor = requireActor(event);
  if (!allowedRoles.includes(actor.role)) {
    throw new AuthError(
      'forbidden',
      `이 작업을 수행할 권한이 없습니다. (필요 권한: ${allowedRoles.join(', ')})`,
    );
  }
  return actor;
}

// ---------------------------------------------------------------------------
//  Role matrix — 전사 공용 권한 상수. ipc.ts 핸들러에서 참조.
// ---------------------------------------------------------------------------

export const ROLES = {
  CEO: 'CEO',
  CTO: 'CTO',
  OPS_MANAGER: 'OPS_MANAGER',
  HR_ADMIN: 'HR_ADMIN',
  QA1: 'QA1',
  QA_FINAL: 'QA_FINAL',
  PARSER: 'PARSER',
} as const;

export const ROLE_SETS = {
  /** 리더십 — CEO/CTO. 모든 기밀 조회 가능. */
  leadership: [ROLES.CEO, ROLES.CTO] as const,
  /** 인사/급여 관리 — HR_ADMIN 포함. */
  hrAdmin: [ROLES.CEO, ROLES.CTO, ROLES.HR_ADMIN] as const,
  /** 학생/과제 운영 — OPS_MANAGER 포함. */
  opsAdmin: [ROLES.CEO, ROLES.CTO, ROLES.OPS_MANAGER] as const,
  /** QA 1차 심사 가능. */
  qaReviewer: [ROLES.CEO, ROLES.CTO, ROLES.QA1, ROLES.QA_FINAL] as const,
  /** QA 최종 심사 가능. */
  qaFinalReviewer: [ROLES.CEO, ROLES.CTO, ROLES.QA_FINAL] as const,
  /** 과제 파싱 작업자. */
  parser: [ROLES.CEO, ROLES.CTO, ROLES.OPS_MANAGER, ROLES.PARSER] as const,
} as const;


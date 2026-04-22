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
      role: normalizeRole(row.role),
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

export function normalizeRole(role: ActorRole | null | undefined): ActorRole {
  return String(role ?? '').trim().toUpperCase();
}

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
    role: normalizeRole(user.role),
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
  const actorRole = normalizeRole(actor.role);
  if (!(allowedRoles as readonly ActorRole[]).includes(actorRole)) {
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
  CS: 'CS',
  STAFF: 'STAFF',
  TA: 'TA',
} as const;

export const ROLE_SETS = {
  /** 리더십 — CEO/CTO. 모든 기밀 조회 가능. */
  leadership: [ROLES.CEO, ROLES.CTO] as const,
  regularStaff: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 인사/급여 관리 — HR_ADMIN 포함. */
  hrAdmin: [ROLES.CEO, ROLES.CTO, ROLES.HR_ADMIN] as const,
  /** 학생/과제 운영 — OPS_MANAGER 포함. */
  opsAdmin: [ROLES.CEO, ROLES.CTO, ROLES.OPS_MANAGER] as const,
  /** 운영 문서/매뉴얼/공지 편집. */
  knowledgeEditor: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** QA 1차 심사 가능. */
  qaReviewer: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** QA 최종 심사 가능. */
  qaFinalReviewer: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 과제 파싱 작업자 (정규직). assignments 생성/수정 권한 있음. */
  parser: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 파싱 엑셀 업로더 — 정규직 + 조교(TA). 업로드/자신 파일 조회만 가능. */
  parsingUploader: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
    ROLES.TA,
  ] as const,
  /** 업로드 큐 소비자 (정규직 한정). downloadUpload / markConsumed 용. */
  parsingConsumer: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 학생 실명 조회 가능. 조교(TA)는 제외한다. */
  studentIdentityViewer: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 과제/QA/CS 운영 조회. 로그인한 정규 운영 인원만 허용하고 TA는 제외한다. */
  assignmentReader: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 학생 상세 이력/파싱 JSON/보고서 파일 조회. 실명 조회 정책과 동일하게 TA는 제외한다. */
  studentDataReader: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 직원 목록 조회. 드롭다운/담당자 배정에 필요하지만 세션 없는 접근은 막는다. */
  peopleReader: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 감사 로그 조회. 운영/인사 관리자급만 허용한다. */
  auditReader: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 매출/수납/청구 조회. 운영/인사 관리자급만 허용한다. */
  financeReader: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 정기 구독/법인카드 운영. CEO/CTO와 HR_ADMIN만 허용한다. */
  subscriptionCardAdmin: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
  /** 개인 홈 통계의 타인 조회 권한. */
  userStatsReader: [
    ROLES.CEO,
    ROLES.CTO,
    ROLES.OPS_MANAGER,
    ROLES.HR_ADMIN,
    ROLES.PARSER,
    ROLES.QA1,
    ROLES.QA_FINAL,
    ROLES.CS,
    ROLES.STAFF,
  ] as const,
} as const;

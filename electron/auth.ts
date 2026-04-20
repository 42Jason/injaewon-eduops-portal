import bcrypt from 'bcryptjs';
import type { Database as Db } from 'better-sqlite3';

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

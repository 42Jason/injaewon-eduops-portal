import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { useSession } from '@/stores/session';
import type { Role, User } from '@shared/types/user';
import { ROLE_LABELS } from '@shared/types/user';

/**
 * Demo identities — used for quick-login buttons and as a renderer-only
 * fallback when `window.api` isn't available (i.e. running Vite standalone
 * without Electron). In Electron mode we call the real `auth:login` IPC,
 * which validates against the SQLite `users` table with bcrypt.
 */
const DEMO_USERS: Array<Pick<User, 'email' | 'name' | 'role' | 'departmentName'>> = [
  { email: 'ceo@eduops.kr',     name: '김대표', role: 'CEO',         departmentName: '경영' },
  { email: 'cto@eduops.kr',     name: '이기술', role: 'CTO',         departmentName: '경영' },
  { email: 'ops@eduops.kr',     name: '박운영', role: 'OPS_MANAGER', departmentName: '운영' },
  { email: 'hr@eduops.kr',      name: '최인사', role: 'HR_ADMIN',    departmentName: '행정/인사' },
  { email: 'parser1@eduops.kr', name: '정파싱', role: 'PARSER',      departmentName: '파싱팀' },
  { email: 'qa1@eduops.kr',     name: '강QA1',  role: 'QA1',         departmentName: 'QA' },
  { email: 'qafinal@eduops.kr', name: '윤최종', role: 'QA_FINAL',    departmentName: 'QA' },
  { email: 'cs@eduops.kr',      name: '장CS',   role: 'CS',          departmentName: 'CS' },
  { email: 'staff@eduops.kr',   name: '한직원', role: 'STAFF',       departmentName: '운영' },
];

const ERROR_MESSAGES: Record<string, string> = {
  not_found: '등록되지 않은 이메일입니다.',
  inactive: '비활성화된 계정입니다. 관리자에게 문의하세요.',
  bad_password: '비밀번호가 올바르지 않습니다.',
  server_error: '서버 오류가 발생했습니다. 로그를 확인해주세요.',
};

export function LoginPage() {
  const { login } = useSession();
  const navigate = useNavigate();
  const [email, setEmail] = useState('ops@eduops.kr');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function doLogin(emailArg: string, passwordArg: string) {
    setSubmitting(true);
    setError(null);
    try {
      if (window.api) {
        // Real Electron IPC path
        const res = await window.api.auth.login(emailArg, passwordArg);
        if (!res.ok || !res.user) {
          setError(ERROR_MESSAGES[res.error ?? ''] ?? '로그인에 실패했습니다.');
          return;
        }
        // Cast role string to Role — main-side schema already constrains it
        login({
          ...res.user,
          role: res.user.role as Role,
        } as User);
        navigate('/home', { replace: true });
      } else {
        // Browser / Vite-only fallback — no bcrypt, email match only.
        const demo = DEMO_USERS.find((u) => u.email === emailArg);
        if (!demo) {
          setError(ERROR_MESSAGES.not_found);
          return;
        }
        const fake: User = {
          id: 0,
          email: demo.email,
          name: demo.name,
          role: demo.role,
          departmentId: null,
          departmentName: demo.departmentName,
          active: true,
          createdAt: '',
        };
        login(fake);
        navigate('/home', { replace: true });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 모두 입력해주세요.');
      return;
    }
    void doLogin(email.trim(), password);
  }

  function quickLogin(role: Role) {
    const u = DEMO_USERS.find((d) => d.role === role);
    if (u) {
      setEmail(u.email);
      void doLogin(u.email, 'demo1234');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white text-xl font-bold">
            E
          </div>
          <h1 className="text-2xl font-semibold text-fg">EduOps Employee Portal</h1>
          <p className="mt-1 text-sm text-fg-muted">사내 직원 로그인</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="name@eduops.kr"
              autoFocus
              disabled={submitting}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-muted">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
              disabled={submitting}
            />
          </div>
          {error && (
            <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          <button type="submit" className="btn-primary w-full h-10" disabled={submitting}>
            <LogIn size={14} /> {submitting ? '로그인 중…' : '로그인'}
          </button>
        </form>

        <div className="mt-6 card">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
            데모 — 역할별 빠른 로그인
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {DEMO_USERS.map((u) => (
              <button
                key={u.email}
                onClick={() => quickLogin(u.role)}
                disabled={submitting}
                className="rounded-md border border-border px-2 py-1.5 text-left text-xs hover:bg-bg-soft disabled:opacity-50"
              >
                <div className="font-medium text-fg">{u.name}</div>
                <div className="text-[10px] text-fg-subtle">{ROLE_LABELS[u.role]}</div>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-4 text-fg-subtle">
            모든 데모 계정 비밀번호: <code className="font-mono">demo1234</code>.
            Electron 실행 환경에서는 SQLite + bcrypt 로 실제 검증되고, Vite 단독 실행 시에는 이메일 매칭만으로 통과합니다.
          </p>
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users, ShieldAlert, Search, User as UserIcon, Mail, Phone, Check, X, Edit3, Save,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { ROLE_LABELS, type Role } from '@shared/types/user';
import { fmtDate } from '@/lib/date';
import { cn } from '@/lib/cn';

interface EmployeeRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  department_id: number | null;
  department_name?: string | null;
  title?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  active: number;
  created_at: string;
  leave_balance?: number;
}

interface DepartmentRow {
  id: number;
  name: string;
  parent_id: number | null;
}

const ROLES: Role[] = [
  'CEO', 'CTO', 'OPS_MANAGER', 'HR_ADMIN',
  'PARSER', 'QA1', 'QA_FINAL', 'CS', 'STAFF',
];

export function EmployeesPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;

  const canManage = !!user?.perms.canManagePeople;

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL'>('ALL');
  const [editingId, setEditingId] = useState<number | null>(null);

  const usersQuery = useQuery({
    queryKey: ['users.list'],
    queryFn: () => api!.users.list() as Promise<EmployeeRow[]>,
    enabled: live && canManage,
  });

  const deptQuery = useQuery({
    queryKey: ['departments.list'],
    queryFn: () => api!.departments.list(),
    enabled: live && canManage,
  });

  const departments = (deptQuery.data ?? []) as DepartmentRow[];

  const rows = usersQuery.data ?? [];
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (roleFilter !== 'ALL' && r.role !== roleFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [r.name, r.email, r.department_name ?? '', r.title ?? ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, roleFilter, search]);

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 직원 정보를 확인할 수 있습니다.
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="p-6">
        <div className="card max-w-xl">
          <div className="flex items-center gap-2 text-rose-300">
            <ShieldAlert size={18} /> 접근 권한 없음
          </div>
          <p className="text-sm text-fg-muted mt-2">
            직원 관리는 HR_ADMIN / CEO / OPS_MANAGER 권한자만 접근할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
          <Users size={20} /> 직원 관리
        </h1>
        <p className="text-sm text-fg-subtle mt-0.5">
          계정 · 역할 · 부서 · 연차 잔여를 관리합니다.
        </p>
      </div>

      {/* Filters */}
      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Search size={13} className="text-fg-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 / 이메일 / 부서 검색"
            className="input text-xs py-1 w-64"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as Role | 'ALL')}
          className="input text-xs py-1 w-36"
        >
          <option value="ALL">역할: 전체</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <span className="text-xs text-fg-subtle ml-auto">
          {filtered.length}/{rows.length}명
        </span>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-soft/40 text-xs text-fg-subtle">
              <tr>
                <th className="text-left px-3 py-2 font-normal">이름</th>
                <th className="text-left px-3 py-2 font-normal">역할</th>
                <th className="text-left px-3 py-2 font-normal">부서</th>
                <th className="text-left px-3 py-2 font-normal">직함</th>
                <th className="text-left px-3 py-2 font-normal">연락처</th>
                <th className="text-right px-3 py-2 font-normal">연차 잔여</th>
                <th className="text-center px-3 py-2 font-normal">상태</th>
                <th className="text-left px-3 py-2 font-normal">생성일</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-fg-subtle">
                    해당하는 직원이 없습니다.
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                editingId === r.id ? (
                  <EmployeeEditRow
                    key={r.id}
                    row={r}
                    departments={departments}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <tr key={r.id} className="hover:bg-bg-soft/30">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs">
                          {r.name.slice(0, 1)}
                        </div>
                        <div>
                          <div className="text-fg">{r.name}</div>
                          <div className="text-[10px] text-fg-subtle flex items-center gap-1">
                            <Mail size={9} /> {r.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs border border-border bg-bg-soft/50 rounded px-1.5 py-0.5">
                        {ROLE_LABELS[r.role]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-fg-muted">{r.department_name ?? '-'}</td>
                    <td className="px-3 py-2 text-fg-muted">{r.title ?? '-'}</td>
                    <td className="px-3 py-2 text-fg-muted text-xs">
                      {r.phone ? (
                        <span className="flex items-center gap-1">
                          <Phone size={10} /> {r.phone}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                      {r.leave_balance ?? 0}일
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.active ? (
                        <span className="text-emerald-300 inline-flex items-center gap-0.5 text-xs">
                          <Check size={11} /> 재직
                        </span>
                      ) : (
                        <span className="text-fg-subtle inline-flex items-center gap-0.5 text-xs">
                          <X size={11} /> 비활성
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-subtle">{fmtDate(r.created_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setEditingId(r.id)}
                        className="btn-outline text-xs flex items-center gap-1"
                      >
                        <Edit3 size={11} /> 수정
                      </button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EmployeeEditRow({
  row,
  departments,
  onDone,
}: {
  row: EmployeeRow;
  departments: DepartmentRow[];
  onDone: () => void;
}) {
  const { user } = useSession();
  const api = getApi();
  const qc = useQueryClient();

  const [role, setRole] = useState<Role>(row.role);
  const [deptId, setDeptId] = useState<number | null>(row.department_id);
  const [title, setTitle] = useState(row.title ?? '');
  const [phone, setPhone] = useState(row.phone ?? '');
  const [active, setActive] = useState(!!row.active);
  const [leaveBalance, setLeaveBalance] = useState(row.leave_balance ?? 0);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      if (!api || !user) throw new Error('not ready');
      const res = await api.users.update({
        id: row.id,
        role,
        departmentId: deptId,
        title: title.trim() || null,
        phone: phone.trim() || null,
        active,
        leaveBalance,
        actorId: user.id,
      });
      if (!res.ok) throw new Error(res.error ?? '저장 실패');
      return res;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users.list'] });
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <tr className="bg-accent/5">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <UserIcon size={13} className="text-fg-subtle" />
          <div>
            <div className="text-fg text-sm">{row.name}</div>
            <div className="text-[10px] text-fg-subtle">{row.email}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="input text-xs py-1 w-full"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          value={deptId ?? ''}
          onChange={(e) => setDeptId(e.target.value ? Number(e.target.value) : null)}
          className="input text-xs py-1 w-full"
        >
          <option value="">-</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="input text-xs py-1 w-full"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input text-xs py-1 w-full"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          step="0.5"
          value={leaveBalance}
          onChange={(e) => setLeaveBalance(Number(e.target.value))}
          className="input text-xs py-1 w-20 text-right tabular-nums"
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </td>
      <td colSpan={2} className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          {error && <span className="text-[11px] text-rose-300">{error}</span>}
          <button
            type="button"
            onClick={onDone}
            className="btn-ghost text-xs"
          >
            취소
          </button>
          <button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
            className="btn-primary text-xs flex items-center gap-1"
          >
            <Save size={11} /> 저장
          </button>
        </div>
      </td>
    </tr>
  );
}

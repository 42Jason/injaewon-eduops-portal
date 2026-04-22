import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users, ShieldAlert, Search, User as UserIcon, Mail, Phone, Check, X, Edit3, Save,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  FormField,
  SelectInput,
  TextInput,
} from '@/components/ui/FormField';
import { firstError, koreanPhone, maxLength, numberRange } from '@/lib/validators';
import { ROLE_LABELS, type Role } from '@shared/types/user';
import { fmtDate } from '@/lib/date';

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
  'PARSER', 'QA1', 'QA_FINAL', 'CS', 'STAFF', 'TA',
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
    queryFn: () => api!.users.list() as unknown as Promise<EmployeeRow[]>,
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
        <label className="flex items-center gap-1.5">
          <Search size={13} className="text-fg-subtle" aria-hidden="true" />
          <span className="sr-only">검색</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 / 이메일 / 부서 검색"
            className="input text-xs py-1 w-64"
            aria-label="직원 검색"
          />
        </label>
        <label className="flex items-center gap-1.5">
          <span className="sr-only">역할 필터</span>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as Role | 'ALL')}
            className="input text-xs py-1 w-36"
            aria-label="역할 필터"
          >
            <option value="ALL">역할: 전체</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-fg-subtle ml-auto" aria-live="polite">
          {filtered.length}/{rows.length}명
        </span>
      </div>

      {/* Table / states */}
      {usersQuery.isLoading ? (
        <LoadingPanel label="직원 목록 불러오는 중…" />
      ) : usersQuery.isError ? (
        <EmptyState
          tone="error"
          title="직원 목록을 불러오지 못했습니다"
          hint={
            usersQuery.error instanceof Error
              ? usersQuery.error.message
              : '네트워크 상태를 확인하고 다시 시도해 주세요.'
          }
          action={
            <button
              type="button"
              onClick={() => usersQuery.refetch()}
              className="btn-outline text-xs"
            >
              다시 시도
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="등록된 직원이 없습니다"
          hint="시드 데이터가 없거나 아직 초기 설정 단계일 수 있습니다."
        />
      ) : (
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
                      <div className="inline-flex flex-col items-center gap-1">
                        <span>검색 조건에 해당하는 직원이 없습니다.</span>
                        {(search || roleFilter !== 'ALL') && (
                          <button
                            type="button"
                            onClick={() => {
                              setSearch('');
                              setRoleFilter('ALL');
                            }}
                            className="btn-ghost text-xs"
                          >
                            필터 초기화
                          </button>
                        )}
                      </div>
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
                          className="btn-outline text-xs flex items-center gap-1 focus-visible:ring-2 focus-visible:ring-accent"
                          aria-label={`${r.name} 직원 정보 수정`}
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
      )}
    </div>
  );
}

const TITLE_MAX = 60;
const phoneRules = firstError<string>([
  // Empty phone is allowed; the validator shortcuts on empty.
  koreanPhone('전화번호 형식이 올바르지 않습니다'),
]);
const titleRules = firstError<string>([
  maxLength(TITLE_MAX, `최대 ${TITLE_MAX}자까지 입력할 수 있습니다`),
]);
const leaveRules = firstError<number | null | undefined>([
  numberRange(0, 99, '연차 잔여는 0 ~ 99일 사이여야 합니다'),
]);

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

  const [role, setRole] = useState<Role>(row.role);
  const [deptId, setDeptId] = useState<number | null>(row.department_id);
  const [title, setTitle] = useState(row.title ?? '');
  const [phone, setPhone] = useState(row.phone ?? '');
  const [active, setActive] = useState(!!row.active);
  const [leaveBalance, setLeaveBalance] = useState(row.leave_balance ?? 0);
  const [touched, setTouched] = useState<{ phone?: boolean; title?: boolean; leave?: boolean }>({});

  const phoneErr = phoneRules(phone.trim());
  const titleErr = titleRules(title);
  const leaveErr = leaveRules(leaveBalance);
  const showPhoneErr = touched.phone ? phoneErr : null;
  const showTitleErr = touched.title ? titleErr : null;
  const showLeaveErr = touched.leave ? leaveErr : null;
  const anyErr = phoneErr || titleErr || leaveErr;

  const mut = useMutationWithToast({
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
      return res;
    },
    successMessage: `${row.name} 정보가 저장되었습니다`,
    errorMessage: '저장에 실패했습니다',
    invalidates: [['users.list']],
    onSuccess: onDone,
  });

  function handleSave() {
    setTouched({ phone: true, title: true, leave: true });
    if (anyErr) return;
    mut.mutate();
  }

  return (
    <tr className="bg-accent/5 align-top">
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
        <FormField label="역할">
          {(slot) => (
            <SelectInput
              {...slot}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="text-xs py-1"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
      </td>
      <td className="px-3 py-2">
        <FormField label="부서">
          {(slot) => (
            <SelectInput
              {...slot}
              value={deptId ?? ''}
              onChange={(e) => setDeptId(e.target.value ? Number(e.target.value) : null)}
              className="text-xs py-1"
            >
              <option value="">-</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
      </td>
      <td className="px-3 py-2">
        <FormField label="직함" error={showTitleErr} count={title.length} max={TITLE_MAX}>
          {(slot) => (
            <TextInput
              {...slot}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              maxLength={TITLE_MAX}
              className="text-xs py-1"
            />
          )}
        </FormField>
      </td>
      <td className="px-3 py-2">
        <FormField label="연락처" error={showPhoneErr} hint="예: 010-1234-5678">
          {(slot) => (
            <TextInput
              {...slot}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
              placeholder="010-1234-5678"
              className="text-xs py-1"
            />
          )}
        </FormField>
      </td>
      <td className="px-3 py-2">
        <FormField label="연차" error={showLeaveErr}>
          {(slot) => (
            <TextInput
              {...slot}
              type="number"
              step={0.5}
              min={0}
              max={99}
              value={leaveBalance}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isNaN(v)) return;
                setLeaveBalance(v);
              }}
              onBlur={(e) => {
                setTouched((t) => ({ ...t, leave: true }));
                const v = Number(e.target.value);
                if (Number.isNaN(v)) setLeaveBalance(0);
                else setLeaveBalance(Math.max(0, Math.min(99, v)));
              }}
              className="text-xs py-1 w-20 text-right tabular-nums"
            />
          )}
        </FormField>
      </td>
      <td className="px-3 py-2 text-center">
        <label className="inline-flex items-center gap-1 cursor-pointer text-xs text-fg-muted">
          <input
            id={`emp-active-${row.id}`}
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border bg-bg-soft accent-accent"
          />
          <span>{active ? '재직' : '비활성'}</span>
        </label>
      </td>
      <td colSpan={2} className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={onDone}
            disabled={mut.isPending}
            className="btn-ghost text-xs"
          >
            취소
          </button>
          <button
            type="button"
            disabled={mut.isPending || !!anyErr}
            onClick={handleSave}
            className="btn-primary text-xs flex items-center gap-1 disabled:opacity-50"
          >
            <Save size={11} /> {mut.isPending ? '저장 중…' : '저장'}
          </button>
        </div>
      </td>
    </tr>
  );
}

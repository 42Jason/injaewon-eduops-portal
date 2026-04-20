import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldAlert,
  Banknote,
  Users,
  PlusCircle,
  Lock,
  CheckCircle2,
  Edit3,
  Save,
  RefreshCw,
  UserCog,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import { fmtDate, thisMonthYm } from '@/lib/date';

type EmploymentType = 'regular' | 'freelancer' | 'parttime';
type PeriodStatus = 'draft' | 'closed' | 'paid';
type PayslipStatus = 'draft' | 'closed' | 'paid';

interface ProfileRow {
  user_id: number;
  name: string;
  email: string;
  role: string;
  department_id: number | null;
  active: number;
  department_name: string | null;
  employment_type: EmploymentType;
  base_salary: number;
  position_allowance: number;
  meal_allowance: number;
  transport_allowance: number;
  other_allowance: number;
  dependents_count: number;
  kids_under_20: number;
  bank_name: string | null;
  bank_account: string | null;
  updated_at: string | null;
}

interface PeriodRow {
  id: number;
  period_yyyymm: string;
  pay_date: string | null;
  status: PeriodStatus;
  note: string | null;
  closed_by: number | null;
  closed_by_name: string | null;
  closed_at: string | null;
  paid_at: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  payslip_count: number;
  total_net_pay: number;
}

interface PayslipRow {
  id: number;
  period_id: number;
  user_id: number;
  employment_type: EmploymentType;
  base_salary: number;
  overtime_pay: number;
  position_allowance: number;
  meal_allowance: number;
  transport_allowance: number;
  bonus: number;
  other_taxable: number;
  other_nontaxable: number;
  gross_pay: number;
  taxable_base: number;
  income_tax: number;
  local_income_tax: number;
  national_pension: number;
  health_insurance: number;
  long_term_care: number;
  employment_insurance: number;
  freelancer_withholding: number;
  other_deduction: number;
  total_deduction: number;
  net_pay: number;
  status: PayslipStatus;
  memo: string | null;
  calc_version: number;
  created_at: string;
  updated_at: string;
  user_name: string;
  email: string;
  role: string;
  department_name: string | null;
}

const STATUS_LABEL: Record<PeriodStatus, { label: string; tone: string }> = {
  draft:  { label: '작성 중', tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  closed: { label: '확정',     tone: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  paid:   { label: '지급 완료', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
};

const EMP_LABEL: Record<EmploymentType, string> = {
  regular: '정규직',
  freelancer: '프리랜서',
  parttime: '시급/단기',
};

function fmtWon(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `${n.toLocaleString('ko-KR')}원`;
}

export function PayrollAdminPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const canManage =
    !!user && (user.role === 'HR_ADMIN' || user.role === 'CEO' || user.role === 'OPS_MANAGER');

  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  const [editingPayslip, setEditingPayslip] = useState<PayslipRow | null>(null);

  const periodsQuery = useQuery({
    queryKey: ['payroll.periods'],
    queryFn: () => api!.payroll.listPeriods() as unknown as Promise<PeriodRow[]>,
    enabled: live && canManage,
  });

  const payslipsQuery = useQuery({
    queryKey: ['payroll.payslips', selectedPeriod],
    queryFn: () =>
      api!.payroll.listPayslips(selectedPeriod!) as unknown as Promise<PayslipRow[]>,
    enabled: live && canManage && typeof selectedPeriod === 'number',
  });

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 급여 관리 기능을 사용할 수 있습니다.
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
            급여 관리는 HR_ADMIN / CEO / OPS_MANAGER 권한자만 접근할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  const periods = periodsQuery.data ?? [];
  const currentPeriod = periods.find((p) => p.id === selectedPeriod) ?? null;
  const payslips = payslipsQuery.data ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <Banknote size={20} /> 급여 관리
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            월별 급여 정산을 생성·확정·지급 처리합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-outline text-xs flex items-center gap-1"
            onClick={() => setShowProfiles(true)}
          >
            <UserCog size={12} /> 직원 급여 프로필
          </button>
          <button
            type="button"
            className="btn-primary text-xs flex items-center gap-1"
            onClick={() => setShowCreate(true)}
          >
            <PlusCircle size={12} /> 월 정산 생성
          </button>
        </div>
      </div>

      {/* Periods list */}
      {periodsQuery.isLoading ? (
        <LoadingPanel label="정산 내역 불러오는 중…" />
      ) : periodsQuery.isError ? (
        <EmptyState
          tone="error"
          title="정산 내역을 불러오지 못했습니다"
          hint={
            periodsQuery.error instanceof Error
              ? periodsQuery.error.message
              : '네트워크 상태를 확인하고 다시 시도해 주세요.'
          }
          action={
            <button
              type="button"
              onClick={() => periodsQuery.refetch()}
              className="btn-outline text-xs"
            >
              다시 시도
            </button>
          }
        />
      ) : periods.length === 0 ? (
        <EmptyState
          title="생성된 정산이 없습니다"
          hint="'월 정산 생성' 버튼으로 첫 번째 정산을 만들어 보세요."
          action={
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="btn-primary text-xs"
            >
              월 정산 생성
            </button>
          }
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-soft/40 text-xs text-fg-subtle">
                <tr>
                  <th className="text-left px-3 py-2 font-normal">정산월</th>
                  <th className="text-left px-3 py-2 font-normal">지급일</th>
                  <th className="text-center px-3 py-2 font-normal">명세서</th>
                  <th className="text-right px-3 py-2 font-normal">실지급 합계</th>
                  <th className="text-center px-3 py-2 font-normal">상태</th>
                  <th className="text-left px-3 py-2 font-normal">처리</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {periods.map((p) => (
                  <tr
                    key={p.id}
                    className={`hover:bg-bg-soft/30 cursor-pointer ${
                      selectedPeriod === p.id ? 'bg-accent-soft/40' : ''
                    }`}
                    onClick={() => setSelectedPeriod(p.id)}
                  >
                    <td className="px-3 py-2 font-medium text-fg">{p.period_yyyymm}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">
                      {p.pay_date ? fmtDate(p.pay_date) : '-'}
                    </td>
                    <td className="px-3 py-2 text-center text-fg-muted tabular-nums">
                      {p.payslip_count}건
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-fg">
                      {fmtWon(p.total_net_pay)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`text-[10px] border rounded px-1.5 py-0.5 ${STATUS_LABEL[p.status].tone}`}
                      >
                        {STATUS_LABEL[p.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-subtle">
                      {p.closed_at ? `확정: ${fmtDate(p.closed_at)}` : ''}
                      {p.paid_at ? ` · 지급: ${fmtDate(p.paid_at)}` : ''}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPeriod(p.id);
                        }}
                      >
                        명세서 보기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payslip detail for selected period */}
      {currentPeriod && (
        <PayslipPanel
          period={currentPeriod}
          payslips={payslips}
          loading={payslipsQuery.isLoading}
          onEditPayslip={setEditingPayslip}
          onRefresh={() => payslipsQuery.refetch()}
        />
      )}

      {/* Modals */}
      {showCreate && (
        <CreatePeriodModal onClose={() => setShowCreate(false)} />
      )}
      {showProfiles && (
        <ProfilesModal onClose={() => setShowProfiles(false)} />
      )}
      {editingPayslip && (
        <EditPayslipModal
          payslip={editingPayslip}
          onClose={() => setEditingPayslip(null)}
          periodId={editingPayslip.period_id}
        />
      )}
    </div>
  );
}

/* ---------------- Payslip panel ---------------- */

function PayslipPanel({
  period,
  payslips,
  loading,
  onEditPayslip,
  onRefresh,
}: {
  period: PeriodRow;
  payslips: PayslipRow[];
  loading: boolean;
  onEditPayslip: (p: PayslipRow) => void;
  onRefresh: () => void;
}) {
  const { user } = useSession();
  const api = getApi()!;

  const generate = useMutationWithToast({
    mutationFn: (overwriteDraft: boolean) =>
      api.payroll.generatePayslips({
        periodId: period.id,
        overwriteDraft,
        actorId: user!.id,
      }),
    successMessage: '명세서가 생성되었습니다',
    errorMessage: '명세서 생성에 실패했습니다',
    invalidates: [
      ['payroll.payslips', period.id],
      ['payroll.periods'],
    ],
  });

  const closePeriod = useMutationWithToast({
    mutationFn: () =>
      api.payroll.closePeriod({ periodId: period.id, actorId: user!.id }),
    successMessage: '정산이 확정되었습니다',
    errorMessage: '확정에 실패했습니다',
    invalidates: [
      ['payroll.payslips', period.id],
      ['payroll.periods'],
    ],
  });

  const markPaid = useMutationWithToast({
    mutationFn: () =>
      api.payroll.markPaid({ periodId: period.id, actorId: user!.id }),
    successMessage: '지급 완료 처리되었습니다',
    errorMessage: '지급 처리에 실패했습니다',
    invalidates: [
      ['payroll.payslips', period.id],
      ['payroll.periods'],
    ],
  });

  const draft = period.status === 'draft';
  const canClose = draft && payslips.length > 0;
  const canPay = period.status !== 'paid' && payslips.length > 0;

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">{period.period_yyyymm} 명세서</span>
          <span
            className={`text-[10px] border rounded px-1.5 py-0.5 ${STATUS_LABEL[period.status].tone}`}
          >
            {STATUS_LABEL[period.status].label}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="btn-ghost text-xs flex items-center gap-1"
          >
            <RefreshCw size={11} /> 새로고침
          </button>
          {draft && (
            <>
              <button
                type="button"
                onClick={() => generate.mutate(payslips.length === 0)}
                className="btn-outline text-xs flex items-center gap-1"
                disabled={generate.isPending}
              >
                {generate.isPending && <Spinner size={11} />}
                {payslips.length === 0 ? '명세서 일괄 생성' : '미작성자만 추가 생성'}
              </button>
              {payslips.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      confirm(
                        'draft 상태의 명세서를 모두 재계산합니다.\n수동 수정한 항목이 덮어쓰기됩니다. 진행하시겠습니까?',
                      )
                    ) {
                      generate.mutate(true);
                    }
                  }}
                  className="btn-ghost text-xs"
                  disabled={generate.isPending}
                >
                  전체 재계산
                </button>
              )}
            </>
          )}
          {canClose && (
            <button
              type="button"
              onClick={() => {
                if (confirm('정산을 확정하면 이후 수정이 불가합니다. 진행하시겠습니까?')) {
                  closePeriod.mutate();
                }
              }}
              className="btn-outline text-xs flex items-center gap-1"
              disabled={closePeriod.isPending}
            >
              {closePeriod.isPending && <Spinner size={11} />}
              <Lock size={11} /> 정산 확정
            </button>
          )}
          {canPay && (
            <button
              type="button"
              onClick={() => {
                if (confirm('지급 완료로 처리합니다. 진행하시겠습니까?')) {
                  markPaid.mutate();
                }
              }}
              className="btn-primary text-xs flex items-center gap-1"
              disabled={markPaid.isPending}
            >
              {markPaid.isPending && <Spinner size={11} />}
              <CheckCircle2 size={11} /> 지급 완료
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingPanel label="명세서 불러오는 중…" />
      ) : payslips.length === 0 ? (
        <div className="p-6 text-center text-sm text-fg-subtle">
          아직 생성된 명세서가 없습니다. 상단의 <span className="text-fg">명세서 일괄 생성</span>
          을 눌러 주세요.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-bg-soft/40 text-fg-subtle">
              <tr>
                <th className="text-left px-3 py-2 font-normal">직원</th>
                <th className="text-left px-3 py-2 font-normal">고용</th>
                <th className="text-right px-3 py-2 font-normal">지급 합계</th>
                <th className="text-right px-3 py-2 font-normal">과세</th>
                <th className="text-right px-3 py-2 font-normal">공제 합계</th>
                <th className="text-right px-3 py-2 font-normal">실수령</th>
                <th className="text-center px-3 py-2 font-normal">상태</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payslips.map((p) => (
                <tr key={p.id} className="hover:bg-bg-soft/30">
                  <td className="px-3 py-2">
                    <div className="text-fg">{p.user_name}</div>
                    <div className="text-[10px] text-fg-subtle">
                      {p.department_name ?? '-'} · {p.email}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{EMP_LABEL[p.employment_type]}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg">
                    {fmtWon(p.gross_pay)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                    {fmtWon(p.taxable_base)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-rose-300">
                    {fmtWon(p.total_deduction)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-300 font-semibold">
                    {fmtWon(p.net_pay)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`text-[10px] border rounded px-1.5 py-0.5 ${STATUS_LABEL[p.status].tone}`}
                    >
                      {STATUS_LABEL[p.status].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.status === 'draft' ? (
                      <button
                        type="button"
                        onClick={() => onEditPayslip(p)}
                        className="btn-ghost text-xs flex items-center gap-1"
                      >
                        <Edit3 size={11} /> 수정
                      </button>
                    ) : (
                      <span className="text-[10px] text-fg-subtle">잠금</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-bg-soft/60 text-xs font-semibold text-fg">
                <td className="px-3 py-2" colSpan={2}>
                  합계 ({payslips.length}명)
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtWon(payslips.reduce((a, b) => a + b.gross_pay, 0))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtWon(payslips.reduce((a, b) => a + b.taxable_base, 0))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-rose-300">
                  {fmtWon(payslips.reduce((a, b) => a + b.total_deduction, 0))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-300">
                  {fmtWon(payslips.reduce((a, b) => a + b.net_pay, 0))}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Create period modal ---------------- */

function CreatePeriodModal({ onClose }: { onClose: () => void }) {
  const { user } = useSession();
  const api = getApi()!;
  const [period, setPeriod] = useState(thisMonthYm());
  const [payDate, setPayDate] = useState('');

  const ensure = useMutationWithToast<
    { ok: boolean; id?: number; created?: boolean; error?: string },
    Error,
    void
  >({
    mutationFn: () =>
      api.payroll.ensurePeriod({
        period,
        payDate: payDate || null,
        actorId: user!.id,
      }),
    successMessage: '정산 월이 준비되었습니다',
    errorMessage: '정산 월 생성에 실패했습니다',
    invalidates: [['payroll.periods']],
    onSuccess: () => onClose(),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="월 정산 생성"
      size="sm"
      footer={
        <>
          <button className="btn-ghost text-xs" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary text-xs flex items-center gap-1"
            onClick={() => ensure.mutate()}
            disabled={ensure.isPending}
          >
            {ensure.isPending && <Spinner size={11} />} 생성
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <FormField label="정산월" required>
          {(slot) => (
            <TextInput
              {...slot}
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="지급 예정일 (선택)" hint="확정 후 지급 처리 시 기본값으로 사용됩니다.">
          {(slot) => (
            <TextInput
              {...slot}
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

/* ---------------- Edit payslip modal ---------------- */

function EditPayslipModal({
  payslip,
  onClose,
  periodId,
}: {
  payslip: PayslipRow;
  onClose: () => void;
  periodId: number;
}) {
  const { user } = useSession();
  const api = getApi()!;
  const [overtimePay, setOvertimePay] = useState(payslip.overtime_pay);
  const [bonus, setBonus] = useState(payslip.bonus);
  const [otherTaxable, setOtherTaxable] = useState(payslip.other_taxable);
  const [otherNontaxable, setOtherNontaxable] = useState(payslip.other_nontaxable);
  const [otherDeduction, setOtherDeduction] = useState(payslip.other_deduction);
  const [memo, setMemo] = useState(payslip.memo ?? '');

  const save = useMutationWithToast({
    mutationFn: () =>
      api.payroll.updatePayslip({
        id: payslip.id,
        patch: {
          overtimePay,
          bonus,
          otherTaxable,
          otherNontaxable,
          otherDeduction,
          memo: memo || null,
        },
        actorId: user!.id,
      }),
    successMessage: '명세서가 수정되었습니다',
    errorMessage: '수정에 실패했습니다',
    invalidates: [
      ['payroll.payslips', periodId],
      ['payroll.periods'],
    ],
    onSuccess: () => onClose(),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`명세서 수정 · ${payslip.user_name}`}
      size="md"
      footer={
        <>
          <button className="btn-ghost text-xs" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary text-xs flex items-center gap-1"
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {save.isPending && <Spinner size={11} />} <Save size={11} /> 저장
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="rounded border border-border bg-bg-soft/40 px-3 py-2 text-xs text-fg-muted">
          고용형태: <span className="text-fg font-semibold">{EMP_LABEL[payslip.employment_type]}</span>
          {' · '}기본급: <span className="text-fg">{fmtWon(payslip.base_salary)}</span>
          {' · '}현재 실수령: <span className="text-emerald-300">{fmtWon(payslip.net_pay)}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="연장수당/초과근로 (원)">
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(overtimePay)}
                onChange={(e) =>
                  setOvertimePay(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                }
              />
            )}
          </FormField>
          <FormField label="상여 (원)">
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(bonus)}
                onChange={(e) => setBonus(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
            )}
          </FormField>
          <FormField label="기타 과세 (원)">
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(otherTaxable)}
                onChange={(e) =>
                  setOtherTaxable(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                }
              />
            )}
          </FormField>
          <FormField label="기타 비과세 (원)">
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(otherNontaxable)}
                onChange={(e) =>
                  setOtherNontaxable(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                }
              />
            )}
          </FormField>
          <FormField
            label="기타 공제 (원)"
            hint="연회비/사내대출 상환 등 수동 공제 항목"
          >
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(otherDeduction)}
                onChange={(e) =>
                  setOtherDeduction(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                }
              />
            )}
          </FormField>
        </div>

        <FormField label="메모">
          {(slot) => (
            <Textarea
              {...slot}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              rows={2}
            />
          )}
        </FormField>

        <p className="text-[11px] text-fg-subtle">
          저장 시 세금·4대보험·실수령액이 자동 재계산됩니다.
        </p>
      </div>
    </Modal>
  );
}

/* ---------------- Profiles modal ---------------- */

function ProfilesModal({ onClose }: { onClose: () => void }) {
  const api = getApi()!;
  const [q, setQ] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['payroll.profiles'],
    queryFn: () => api.payroll.listProfiles() as unknown as Promise<ProfileRow[]>,
  });

  const profiles = profilesQuery.data ?? [];
  const filtered = useMemo(() => {
    if (!q.trim()) return profiles;
    const s = q.trim().toLowerCase();
    return profiles.filter((r) =>
      [r.name, r.email, r.department_name ?? '', r.role].join(' ').toLowerCase().includes(s),
    );
  }, [profiles, q]);

  return (
    <Modal open onClose={onClose} title="직원 급여 프로필" size="xl">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Users size={12} className="text-fg-subtle" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름 / 이메일 / 부서 / 역할"
            className="input text-xs py-1 flex-1"
            aria-label="직원 검색"
          />
          <span className="text-[11px] text-fg-subtle">{filtered.length}/{profiles.length}명</span>
        </div>

        {profilesQuery.isLoading ? (
          <LoadingPanel label="프로필 불러오는 중…" />
        ) : (
          <div className="border border-border rounded overflow-hidden max-h-[60vh] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-bg-soft/40 text-fg-subtle sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1 font-normal">직원</th>
                  <th className="text-left px-2 py-1 font-normal">고용</th>
                  <th className="text-right px-2 py-1 font-normal">기본급</th>
                  <th className="text-right px-2 py-1 font-normal">직책/식대/교통</th>
                  <th className="text-center px-2 py-1 font-normal">부양</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-fg-subtle">
                      조건에 맞는 직원이 없습니다.
                    </td>
                  </tr>
                )}
                {filtered.map((p) =>
                  editingId === p.user_id ? (
                    <ProfileEditRow
                      key={p.user_id}
                      profile={p}
                      onDone={() => setEditingId(null)}
                    />
                  ) : (
                    <tr key={p.user_id} className="hover:bg-bg-soft/30">
                      <td className="px-2 py-1">
                        <div className="text-fg">{p.name}</div>
                        <div className="text-[10px] text-fg-subtle">
                          {p.department_name ?? '-'} · {p.email}
                        </div>
                      </td>
                      <td className="px-2 py-1 text-fg-muted">{EMP_LABEL[p.employment_type]}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-fg">
                        {fmtWon(p.base_salary)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-fg-muted">
                        {fmtWon(p.position_allowance)} / {fmtWon(p.meal_allowance)} /{' '}
                        {fmtWon(p.transport_allowance)}
                      </td>
                      <td className="px-2 py-1 text-center text-fg-muted">
                        {p.dependents_count}명 ({p.kids_under_20}자)
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => setEditingId(p.user_id)}
                          className="btn-ghost text-xs flex items-center gap-1"
                        >
                          <Edit3 size={11} /> 수정
                        </button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ProfileEditRow({
  profile,
  onDone,
}: {
  profile: ProfileRow;
  onDone: () => void;
}) {
  const { user } = useSession();
  const api = getApi()!;
  const [empType, setEmpType] = useState<EmploymentType>(profile.employment_type);
  const [base, setBase] = useState(profile.base_salary);
  const [pos, setPos] = useState(profile.position_allowance);
  const [meal, setMeal] = useState(profile.meal_allowance);
  const [transport, setTransport] = useState(profile.transport_allowance);
  const [other, setOther] = useState(profile.other_allowance);
  const [deps, setDeps] = useState(profile.dependents_count);
  const [kids, setKids] = useState(profile.kids_under_20);

  const save = useMutationWithToast({
    mutationFn: () =>
      api.payroll.upsertProfile({
        userId: profile.user_id,
        employmentType: empType,
        baseSalary: base,
        positionAllowance: pos,
        mealAllowance: meal,
        transportAllowance: transport,
        otherAllowance: other,
        dependentsCount: deps,
        kidsUnder20: kids,
        bankName: profile.bank_name,
        bankAccount: profile.bank_account,
        actorId: user!.id,
      }),
    successMessage: '프로필이 저장되었습니다',
    errorMessage: '저장에 실패했습니다',
    invalidates: [['payroll.profiles']],
    onSuccess: () => onDone(),
  });

  return (
    <tr className="bg-bg-soft/30">
      <td className="px-2 py-1" colSpan={6}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-fg font-semibold">{profile.name}</span>
          <span className="text-[10px] text-fg-subtle">
            {profile.department_name ?? '-'} · {profile.email}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <label className="text-[10px] text-fg-subtle">
            고용형태
            <select
              value={empType}
              onChange={(e) => setEmpType(e.target.value as EmploymentType)}
              className="input text-xs py-1 w-full mt-0.5"
            >
              <option value="regular">정규직</option>
              <option value="freelancer">프리랜서 (3.3%)</option>
              <option value="parttime">시급/단기</option>
            </select>
          </label>
          <NumField label="기본급" value={base} onChange={setBase} />
          <NumField label="직책수당" value={pos} onChange={setPos} />
          <NumField label="식대 (200,000 비과세)" value={meal} onChange={setMeal} />
          <NumField label="차량유지비 (200,000 비과세)" value={transport} onChange={setTransport} />
          <NumField label="기타수당(과세)" value={other} onChange={setOther} />
          <NumField label="부양가족 수" value={deps} onChange={setDeps} min={1} />
          <NumField label="20세 이하 자녀" value={kids} onChange={setKids} />
        </div>
        <div className="flex items-center gap-1 justify-end mt-2">
          <button type="button" onClick={onDone} className="btn-ghost text-xs">
            취소
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="btn-primary text-xs flex items-center gap-1"
          >
            {save.isPending ? <Spinner size={11} /> : <Save size={11} />} 저장
          </button>
        </div>
      </td>
    </tr>
  );
}

function NumField({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
}) {
  return (
    <label className="text-[10px] text-fg-subtle">
      {label}
      <input
        type="number"
        min={min}
        value={String(value)}
        onChange={(e) => onChange(Math.max(min, Math.floor(Number(e.target.value) || min)))}
        className="input text-xs py-1 w-full mt-0.5 tabular-nums"
      />
    </label>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Wallet,
  Printer,
  FileText,
  Calendar,
  TrendingUp,
  TrendingDown,
  Banknote,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { LoadingPanel } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { fmtDate } from '@/lib/date';

type EmploymentType = 'regular' | 'freelancer' | 'parttime';
type PayslipStatus = 'draft' | 'closed' | 'paid';
type PeriodStatus = 'draft' | 'closed' | 'paid';

interface MyPayslipRow {
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
  created_at: string;
  updated_at: string;
  period_yyyymm: string;
  pay_date: string;
  period_status: PeriodStatus;
}

const PERIOD_STATUS_LABEL: Record<PeriodStatus, { label: string; tone: string }> = {
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

function fmtPeriod(yyyymm: string): string {
  if (!yyyymm || yyyymm.length !== 6) return yyyymm;
  return `${yyyymm.slice(0, 4)}년 ${Number(yyyymm.slice(4, 6))}월`;
}

export function MyPayslipsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;

  const [selected, setSelected] = useState<MyPayslipRow | null>(null);

  const payslipsQuery = useQuery({
    queryKey: ['payroll.myPayslips', user?.id ?? 0],
    queryFn: () =>
      api!.payroll.getMyPayslips(user!.id) as unknown as Promise<MyPayslipRow[]>,
    enabled: live,
  });

  const rows = useMemo<MyPayslipRow[]>(
    () => payslipsQuery.data ?? [],
    [payslipsQuery.data],
  );
  const latest = rows[0] ?? null;

  // YTD: sum of closed/paid payslips in current year
  const thisYear = new Date().getFullYear().toString();
  const ytd = useMemo(() => {
    const yearRows = rows.filter((r) => r.period_yyyymm.startsWith(thisYear));
    return {
      count: yearRows.length,
      gross: yearRows.reduce((a, b) => a + (b.gross_pay || 0), 0),
      deduction: yearRows.reduce((a, b) => a + (b.total_deduction || 0), 0),
      net: yearRows.reduce((a, b) => a + (b.net_pay || 0), 0),
    };
  }, [rows, thisYear]);

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 급여 명세서를 확인할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Wallet size={20} /> 내 급여 명세서
          </h1>
          <p className="mt-1 text-xs text-fg-subtle">
            확정되거나 지급 완료된 최근 24개월의 명세서만 표시됩니다.
          </p>
        </div>
      </header>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard
          icon={<Banknote size={14} className="text-emerald-300" />}
          label="가장 최근 실수령액"
          value={latest ? fmtWon(latest.net_pay) : '-'}
          caption={latest ? `${fmtPeriod(latest.period_yyyymm)} · ${fmtDate(latest.pay_date)} 지급` : '명세서 없음'}
        />
        <SummaryCard
          icon={<TrendingUp size={14} className="text-sky-300" />}
          label={`${thisYear}년 누적 총지급`}
          value={fmtWon(ytd.gross)}
          caption={`${ytd.count}개 명세서`}
        />
        <SummaryCard
          icon={<TrendingDown size={14} className="text-rose-300" />}
          label={`${thisYear}년 누적 공제`}
          value={fmtWon(ytd.deduction)}
          caption="세금+4대보험 등"
        />
        <SummaryCard
          icon={<Wallet size={14} className="text-emerald-300" />}
          label={`${thisYear}년 누적 실수령`}
          value={fmtWon(ytd.net)}
          caption="세후 합계"
        />
      </div>

      {/* Payslip list */}
      {payslipsQuery.isLoading ? (
        <LoadingPanel label="명세서를 불러오는 중입니다" />
      ) : payslipsQuery.isError ? (
        <EmptyState
          tone="error"
          icon={FileText}
          title="명세서를 불러오지 못했습니다"
          hint={(payslipsQuery.error as Error | null)?.message || '다시 시도해 주세요.'}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="확정된 급여 명세서가 아직 없습니다"
          hint="관리자가 명세서를 확정하면 여기서 확인할 수 있습니다."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r)}
              className="card text-left transition hover:border-sky-500/40 hover:bg-bg-soft/60 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{fmtPeriod(r.period_yyyymm)}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-fg-subtle">
                    <Calendar size={10} /> 지급일 {fmtDate(r.pay_date)}
                  </div>
                </div>
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] ${
                    PERIOD_STATUS_LABEL[r.period_status].tone
                  }`}
                >
                  {PERIOD_STATUS_LABEL[r.period_status].label}
                </span>
              </div>

              <div className="mt-3 rounded bg-bg-soft/40 px-3 py-2">
                <div className="text-[11px] text-fg-subtle">실수령액</div>
                <div className="mt-0.5 text-lg font-semibold text-emerald-300">
                  {fmtWon(r.net_pay)}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-fg-muted">
                <div>총지급: <span className="text-fg">{fmtWon(r.gross_pay)}</span></div>
                <div>공제: <span className="text-fg">{fmtWon(r.total_deduction)}</span></div>
                <div className="col-span-2 text-[10px] text-fg-subtle">
                  고용형태: {EMP_LABEL[r.employment_type]}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <PayslipDetailModal payslip={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

/* ---------------- summary card ---------------- */

function SummaryCard({
  icon,
  label,
  value,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-1 text-[11px] text-fg-subtle">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {caption && <div className="mt-0.5 text-[11px] text-fg-subtle">{caption}</div>}
    </div>
  );
}

/* ---------------- payslip detail modal ---------------- */

function PayslipDetailModal({
  payslip,
  onClose,
}: {
  payslip: MyPayslipRow;
  onClose: () => void;
}) {
  const { user } = useSession();

  const onPrint = () => {
    window.print();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${fmtPeriod(payslip.period_yyyymm)} 급여 명세서`}
      footer={
        <>
          <button className="btn-ghost text-xs" onClick={onClose}>
            닫기
          </button>
          <button
            className="btn-primary text-xs flex items-center gap-1"
            onClick={onPrint}
          >
            <Printer size={11} /> 인쇄 / PDF 저장
          </button>
        </>
      }
    >
      <div className="space-y-4 print:text-black">
        {/* Header */}
        <div className="rounded border border-border bg-bg-soft/40 px-4 py-3 text-sm">
          <div className="grid grid-cols-2 gap-y-1 text-xs">
            <div>
              <span className="text-fg-subtle">성명</span>{' '}
              <span className="font-semibold text-fg">{user?.name ?? '-'}</span>
            </div>
            <div>
              <span className="text-fg-subtle">직책/역할</span>{' '}
              <span className="text-fg">{user?.title ?? user?.role ?? '-'}</span>
            </div>
            <div>
              <span className="text-fg-subtle">소속</span>{' '}
              <span className="text-fg">{user?.departmentName ?? '-'}</span>
            </div>
            <div>
              <span className="text-fg-subtle">고용형태</span>{' '}
              <span className="text-fg">{EMP_LABEL[payslip.employment_type]}</span>
            </div>
            <div>
              <span className="text-fg-subtle">귀속 기간</span>{' '}
              <span className="text-fg">{fmtPeriod(payslip.period_yyyymm)}</span>
            </div>
            <div>
              <span className="text-fg-subtle">지급일</span>{' '}
              <span className="text-fg">{fmtDate(payslip.pay_date)}</span>
            </div>
          </div>
        </div>

        {/* Earnings + Deductions grid */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <section className="rounded border border-border">
            <header className="border-b border-border bg-bg-soft/40 px-3 py-2 text-xs font-semibold">
              지급 내역
            </header>
            <div className="divide-y divide-border text-xs">
              <LineItem label="기본급" value={payslip.base_salary} />
              <LineItem label="연장/초과근로수당" value={payslip.overtime_pay} />
              <LineItem label="직책수당" value={payslip.position_allowance} />
              <LineItem label="식대 (비과세)" value={payslip.meal_allowance} muted />
              <LineItem label="차량유지비 (비과세)" value={payslip.transport_allowance} muted />
              <LineItem label="상여" value={payslip.bonus} />
              <LineItem label="기타 과세" value={payslip.other_taxable} />
              <LineItem label="기타 비과세" value={payslip.other_nontaxable} muted />
              <div className="flex items-center justify-between bg-bg-soft/40 px-3 py-2 text-xs">
                <span className="font-semibold">지급 합계</span>
                <span className="font-semibold">{fmtWon(payslip.gross_pay)}</span>
              </div>
            </div>
          </section>

          <section className="rounded border border-border">
            <header className="border-b border-border bg-bg-soft/40 px-3 py-2 text-xs font-semibold">
              공제 내역
            </header>
            <div className="divide-y divide-border text-xs">
              {payslip.employment_type === 'freelancer' ? (
                <LineItem
                  label="프리랜서 원천징수 (3.3%)"
                  value={payslip.freelancer_withholding}
                />
              ) : (
                <>
                  <LineItem label="소득세" value={payslip.income_tax} />
                  <LineItem label="지방소득세" value={payslip.local_income_tax} />
                  <LineItem label="국민연금" value={payslip.national_pension} />
                  <LineItem label="건강보험" value={payslip.health_insurance} />
                  <LineItem label="장기요양보험" value={payslip.long_term_care} />
                  <LineItem label="고용보험" value={payslip.employment_insurance} />
                </>
              )}
              <LineItem label="기타 공제" value={payslip.other_deduction} />
              <div className="flex items-center justify-between bg-bg-soft/40 px-3 py-2 text-xs">
                <span className="font-semibold">공제 합계</span>
                <span className="font-semibold text-rose-300">
                  {fmtWon(payslip.total_deduction)}
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* Net pay */}
        <div className="rounded border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] text-emerald-200">실 수령액</div>
              <div className="text-[10px] text-fg-subtle">
                과세 근로소득: {fmtWon(payslip.taxable_base)}
              </div>
            </div>
            <div className="text-2xl font-bold text-emerald-300">
              {fmtWon(payslip.net_pay)}
            </div>
          </div>
        </div>

        {payslip.memo && (
          <div className="rounded border border-border bg-bg-soft/40 px-3 py-2 text-xs">
            <div className="text-[11px] text-fg-subtle">메모</div>
            <div className="mt-0.5 whitespace-pre-wrap text-fg">{payslip.memo}</div>
          </div>
        )}

        <p className="text-[10px] text-fg-subtle">
          본 명세서는 회사 내부 관리 시스템에서 자동 생성된 자료이며, 원천징수영수증 등 법정 서식은 회계팀에서 별도 발급받을 수 있습니다.
        </p>
      </div>
    </Modal>
  );
}

function LineItem({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5">
      <span className={muted ? 'text-fg-subtle' : 'text-fg-muted'}>{label}</span>
      <span className={muted ? 'text-fg-subtle' : 'text-fg'}>{fmtWon(value)}</span>
    </div>
  );
}

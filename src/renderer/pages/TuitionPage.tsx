import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Wallet,
  ShieldAlert,
  CalendarRange,
  PlusCircle,
  RefreshCw,
  Check,
  X,
  CircleDollarSign,
  Edit3,
  Save,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import { firstError, numberRange, required } from '@/lib/validators';
import { fmtDate, fmtDateTime, thisMonthYm } from '@/lib/date';
import {
  METHOD_LABEL,
  STATUS_LABEL,
  fmtWon,
  type InvoiceRow,
  type PaymentRow,
  type PeriodSummary,
  type StudentRow,
} from './tuition/types';

export function TuitionPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const canManage = !!user && user.role !== 'TA';

  const [period, setPeriod] = useState<string>(thisMonthYm());
  const [statusFilter, setStatusFilter] = useState<'ALL' | InvoiceRow['status']>('ALL');
  const [search, setSearch] = useState('');

  // Modals
  const [studentEditId, setStudentEditId] = useState<number | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceRow | null>(null);
  const [editInvoice, setEditInvoice] = useState<InvoiceRow | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const studentsQuery = useQuery({
    queryKey: ['tuition.students'],
    queryFn: () => api!.tuition.listStudents() as unknown as Promise<StudentRow[]>,
    enabled: live && canManage,
  });

  const invoicesQuery = useQuery({
    queryKey: ['tuition.invoices', period],
    queryFn: () =>
      api!.tuition.listInvoices({ period }) as unknown as Promise<InvoiceRow[]>,
    enabled: live && canManage && !!period,
  });

  const summaryQuery = useQuery({
    queryKey: ['tuition.summary', period],
    queryFn: () =>
      api!.tuition.periodSummary(period) as unknown as Promise<PeriodSummary | null>,
    enabled: live && canManage && !!period,
  });

  const rows = invoicesQuery.data ?? [];
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [r.student_code, r.student_name ?? '', r.memo ?? ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusFilter, search]);

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 학원비 수납 기능을 사용할 수 있습니다.
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
            학원비 수납은 HR_ADMIN / CEO / OPS_MANAGER 권한자만 접근할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  const summary = summaryQuery.data ?? null;
  const students = studentsQuery.data ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
            <Wallet size={20} /> 학원비 수납
          </h1>
          <p className="text-sm text-fg-subtle mt-0.5">
            월별 청구서를 발행하고 수납 내역을 관리합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-outline text-xs flex items-center gap-1"
            onClick={() => setStudentEditId(-1)}
          >
            <Edit3 size={12} /> 학생별 수강료 설정
          </button>
          <button
            type="button"
            className="btn-primary text-xs flex items-center gap-1"
            onClick={() => setShowGenerate(true)}
          >
            <PlusCircle size={12} /> 월 청구서 생성
          </button>
        </div>
      </div>

      {/* Period picker + summary */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
          <CalendarRange size={12} /> 청구월
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="input text-xs py-1 w-36"
            aria-label="청구월 선택"
          />
        </label>
        <div className="flex items-center gap-4 ml-auto text-xs">
          <SummaryChip label="청구 건수" value={`${summary?.invoice_count ?? 0}건`} />
          <SummaryChip label="청구 합계" value={fmtWon(summary?.total_billed ?? 0)} />
          <SummaryChip label="수납" value={fmtWon(summary?.total_paid ?? 0)} tone="ok" />
          <SummaryChip label="미납" value={fmtWon(summary?.total_outstanding ?? 0)} tone="danger" />
        </div>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="input text-xs py-1 w-36"
          aria-label="상태 필터"
        >
          <option value="ALL">상태: 전체</option>
          <option value="unpaid">미납</option>
          <option value="partial">일부 납부</option>
          <option value="paid">완납</option>
          <option value="waived">면제</option>
          <option value="cancelled">취소</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="학생 이름 / 학생 코드"
          className="input text-xs py-1 w-64"
          aria-label="청구서 검색"
        />
        <button
          type="button"
          onClick={() => invoicesQuery.refetch()}
          className="btn-ghost text-xs flex items-center gap-1"
          aria-label="새로고침"
        >
          <RefreshCw size={11} /> 새로고침
        </button>
        <span className="text-xs text-fg-subtle ml-auto">
          {filtered.length}/{rows.length}건
        </span>
      </div>

      {/* Table */}
      {invoicesQuery.isLoading ? (
        <LoadingPanel label="청구서 불러오는 중…" />
      ) : invoicesQuery.isError ? (
        <EmptyState
          tone="error"
          title="청구서를 불러오지 못했습니다"
          hint={
            invoicesQuery.error instanceof Error
              ? invoicesQuery.error.message
              : '네트워크 상태를 확인하고 다시 시도해 주세요.'
          }
          action={
            <button
              type="button"
              onClick={() => invoicesQuery.refetch()}
              className="btn-outline text-xs"
            >
              다시 시도
            </button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={`${period} 청구서가 없습니다`}
          hint="상단의 '월 청구서 생성' 버튼으로 이번 달 청구서를 발행할 수 있습니다."
          action={
            <button
              type="button"
              onClick={() => setShowGenerate(true)}
              className="btn-primary text-xs"
            >
              월 청구서 생성
            </button>
          }
        />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg-soft/40 text-xs text-fg-subtle">
                <tr>
                  <th className="text-left px-3 py-2 font-normal">학생</th>
                  <th className="text-left px-3 py-2 font-normal">납기</th>
                  <th className="text-right px-3 py-2 font-normal">청구액</th>
                  <th className="text-right px-3 py-2 font-normal">수납</th>
                  <th className="text-right px-3 py-2 font-normal">잔액</th>
                  <th className="text-center px-3 py-2 font-normal">상태</th>
                  <th className="text-left px-3 py-2 font-normal">메모</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-fg-subtle">
                      검색 조건에 해당하는 청구서가 없습니다.
                    </td>
                  </tr>
                )}
                {filtered.map((r) => {
                  const outstanding = r.total_amount - r.paid_amount;
                  return (
                    <tr key={r.id} className="hover:bg-bg-soft/30">
                      <td className="px-3 py-2">
                        <div className="text-fg">{r.student_name ?? r.student_code}</div>
                        <div className="text-[10px] text-fg-subtle">
                          {r.student_code}
                          {r.student_grade ? ` · ${r.student_grade}` : ''}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-fg-muted text-xs">
                        {r.due_date ? fmtDate(r.due_date) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg">
                        {fmtWon(r.total_amount)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                        {fmtWon(r.paid_amount)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span
                          className={
                            outstanding > 0
                              ? 'text-rose-300'
                              : outstanding < 0
                                ? 'text-emerald-300'
                                : 'text-fg-subtle'
                          }
                        >
                          {fmtWon(outstanding)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`text-[10px] border rounded px-1.5 py-0.5 ${STATUS_LABEL[r.status].tone}`}
                        >
                          {STATUS_LABEL[r.status].label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-fg-subtle truncate max-w-[160px]">
                        {r.memo ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          {(r.status === 'unpaid' || r.status === 'partial') && (
                            <button
                              type="button"
                              onClick={() => setPaymentInvoice(r)}
                              className="btn-primary text-xs flex items-center gap-1"
                            >
                              <CircleDollarSign size={11} /> 수납
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setEditInvoice(r)}
                            className="btn-ghost text-xs flex items-center gap-1"
                          >
                            <Edit3 size={11} /> 조정
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Generate modal */}
      {showGenerate && (
        <GenerateMonthlyModal
          period={period}
          onClose={() => setShowGenerate(false)}
        />
      )}

      {/* Record payment modal */}
      {paymentInvoice && (
        <RecordPaymentModal
          invoice={paymentInvoice}
          onClose={() => setPaymentInvoice(null)}
        />
      )}

      {/* Edit invoice modal */}
      {editInvoice && (
        <EditInvoiceModal
          invoice={editInvoice}
          onClose={() => setEditInvoice(null)}
        />
      )}

      {/* Student billing editor */}
      {studentEditId !== null && (
        <StudentBillingModal
          students={students}
          onClose={() => setStudentEditId(null)}
        />
      )}
    </div>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'danger';
}) {
  const color =
    tone === 'ok'
      ? 'text-emerald-300'
      : tone === 'danger'
        ? 'text-rose-300'
        : 'text-fg';
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

/* ---------------- Generate monthly modal ---------------- */

function GenerateMonthlyModal({
  period,
  onClose,
}: {
  period: string;
  onClose: () => void;
}) {
  const { user } = useSession();
  const api = getApi()!;
  const [targetPeriod, setTargetPeriod] = useState(period);
  const [dueDate, setDueDate] = useState('');
  const [overwrite, setOverwrite] = useState(false);

  const run = useMutationWithToast<
    { ok: boolean; created?: number; skipped?: number; error?: string },
    Error,
    void
  >({
    mutationFn: () =>
      api.tuition.generateMonthly({
        period: targetPeriod,
        dueDate: dueDate || undefined,
        overwrite,
        actorId: user!.id,
      }),
    successMessage: '청구서가 발행되었습니다',
    errorMessage: '청구서 발행에 실패했습니다',
    invalidates: [
      ['tuition.invoices', targetPeriod],
      ['tuition.summary', targetPeriod],
    ],
    onSuccess: (res) => {
      if (res.ok) {
        const created = res.created ?? 0;
        const skipped = res.skipped ?? 0;
        if (created === 0 && skipped > 0) {
          // nothing to do — already generated.
        }
      }
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`월 청구서 생성 · ${targetPeriod}`}
      size="sm"
      footer={
        <>
          <button className="btn-ghost text-xs" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary text-xs flex items-center gap-1"
            onClick={() => run.mutate()}
            disabled={run.isPending}
          >
            {run.isPending && <Spinner size={11} />} 발행
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <FormField label="청구월" required>
          {(slot) => (
            <TextInput
              {...slot}
              type="month"
              value={targetPeriod}
              onChange={(e) => setTargetPeriod(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="납기일 (선택)" hint="비워두면 학생별 결제일을 자동 적용합니다.">
          {(slot) => (
            <TextInput
              {...slot}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          )}
        </FormField>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          이미 존재하는 미납 청구서 덮어쓰기 (수납된 청구서는 보존)
        </label>
        <p className="text-[11px] text-fg-subtle leading-relaxed">
          청구 활성(billing_active) + 월 수강료(monthly_fee &gt; 0)인 학생만 생성됩니다.
        </p>
      </div>
    </Modal>
  );
}

/* ---------------- Record payment modal ---------------- */

function RecordPaymentModal({
  invoice,
  onClose,
}: {
  invoice: InvoiceRow;
  onClose: () => void;
}) {
  const { user } = useSession();
  const api = getApi()!;
  const outstanding = invoice.total_amount - invoice.paid_amount;
  const [amount, setAmount] = useState<number>(outstanding > 0 ? outstanding : 0);
  const [method, setMethod] = useState<PaymentRow['method']>('transfer');
  const [receipt, setReceipt] = useState('');
  const [note, setNote] = useState('');

  const paymentsQuery = useQuery({
    queryKey: ['tuition.payments', invoice.id],
    queryFn: () =>
      api.tuition.listPayments(invoice.id) as unknown as Promise<PaymentRow[]>,
  });

  const save = useMutationWithToast({
    mutationFn: () =>
      api.tuition.recordPayment({
        invoiceId: invoice.id,
        amount,
        method,
        receiptNo: receipt || undefined,
        note: note || undefined,
        actorId: user!.id,
      }),
    successMessage: '수납이 기록되었습니다',
    errorMessage: '수납 기록에 실패했습니다',
    invalidates: [
      ['tuition.invoices', invoice.period_yyyymm],
      ['tuition.summary', invoice.period_yyyymm],
      ['tuition.payments', invoice.id],
    ],
    onSuccess: () => onClose(),
  });

  const error = firstError<number | null | undefined>([
    required('금액을 입력하세요'),
    numberRange(-10_000_000, 10_000_000, '-10,000,000 ~ 10,000,000 원 사이'),
  ])(amount);

  return (
    <Modal
      open
      onClose={onClose}
      title={`수납 · ${invoice.student_name ?? invoice.student_code} (${invoice.period_yyyymm})`}
      size="md"
      footer={
        <>
          <button className="btn-ghost text-xs" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary text-xs flex items-center gap-1"
            disabled={!!error || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Spinner size={11} />} 저장
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded border border-border bg-bg-soft/40 p-2">
            <div className="text-[10px] text-fg-subtle">청구</div>
            <div className="text-sm font-semibold tabular-nums text-fg">
              {fmtWon(invoice.total_amount)}
            </div>
          </div>
          <div className="rounded border border-border bg-bg-soft/40 p-2">
            <div className="text-[10px] text-fg-subtle">기납부</div>
            <div className="text-sm font-semibold tabular-nums text-fg-muted">
              {fmtWon(invoice.paid_amount)}
            </div>
          </div>
          <div className="rounded border border-border bg-bg-soft/40 p-2">
            <div className="text-[10px] text-fg-subtle">잔액</div>
            <div
              className={`text-sm font-semibold tabular-nums ${
                outstanding > 0 ? 'text-rose-300' : 'text-emerald-300'
              }`}
            >
              {fmtWon(outstanding)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="금액 (원)" required error={error}>
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(amount)}
                onChange={(e) => setAmount(Math.floor(Number(e.target.value) || 0))}
              />
            )}
          </FormField>
          <FormField label="결제 수단" required>
            {(slot) => (
              <SelectInput
                {...slot}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentRow['method'])}
              >
                <option value="transfer">{METHOD_LABEL.transfer}</option>
                <option value="card">{METHOD_LABEL.card}</option>
                <option value="cash">{METHOD_LABEL.cash}</option>
                <option value="other">{METHOD_LABEL.other}</option>
              </SelectInput>
            )}
          </FormField>
        </div>

        <FormField label="영수증 번호 (선택)">
          {(slot) => (
            <TextInput
              {...slot}
              value={receipt}
              onChange={(e) => setReceipt(e.target.value)}
              placeholder="예: R-2026-0412-017"
            />
          )}
        </FormField>

        <FormField label="비고 (선택)">
          {(slot) => (
            <Textarea
              {...slot}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="환불·분납·할인 사유 등"
            />
          )}
        </FormField>

        <div>
          <div className="text-[11px] text-fg-subtle mb-1">수납 내역</div>
          {paymentsQuery.isLoading ? (
            <LoadingPanel label="수납 내역 불러오는 중…" />
          ) : (paymentsQuery.data ?? []).length === 0 ? (
            <div className="text-xs text-fg-subtle py-3 text-center border border-border rounded">
              아직 기록된 수납이 없습니다.
            </div>
          ) : (
            <div className="border border-border rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-bg-soft/40 text-fg-subtle">
                  <tr>
                    <th className="text-left px-2 py-1 font-normal">일시</th>
                    <th className="text-left px-2 py-1 font-normal">수단</th>
                    <th className="text-right px-2 py-1 font-normal">금액</th>
                    <th className="text-left px-2 py-1 font-normal">담당</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(paymentsQuery.data ?? []).map((p) => (
                    <tr key={p.id}>
                      <td className="px-2 py-1 text-fg-subtle">{fmtDateTime(p.paid_at)}</td>
                      <td className="px-2 py-1 text-fg-muted">{METHOD_LABEL[p.method]}</td>
                      <td
                        className={`px-2 py-1 text-right tabular-nums ${
                          p.amount < 0 ? 'text-rose-300' : 'text-fg'
                        }`}
                      >
                        {fmtWon(p.amount)}
                      </td>
                      <td className="px-2 py-1 text-fg-subtle">{p.actor_name ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------- Edit invoice modal ---------------- */

function EditInvoiceModal({
  invoice,
  onClose,
}: {
  invoice: InvoiceRow;
  onClose: () => void;
}) {
  const { user } = useSession();
  const api = getApi()!;
  const [base, setBase] = useState<number>(invoice.base_amount);
  const [discount, setDiscount] = useState<number>(invoice.discount);
  const [adjustment, setAdjustment] = useState<number>(invoice.adjustment);
  const [dueDate, setDueDate] = useState<string>(invoice.due_date ?? '');
  const [memo, setMemo] = useState<string>(invoice.memo ?? '');
  const [status, setStatus] = useState<InvoiceRow['status']>(invoice.status);

  const save = useMutationWithToast({
    mutationFn: () =>
      api.tuition.updateInvoice({
        id: invoice.id,
        baseAmount: base,
        discount,
        adjustment,
        dueDate: dueDate || null,
        memo: memo || null,
        status,
        actorId: user!.id,
      }),
    successMessage: '청구서가 수정되었습니다',
    errorMessage: '청구서 수정에 실패했습니다',
    invalidates: [
      ['tuition.invoices', invoice.period_yyyymm],
      ['tuition.summary', invoice.period_yyyymm],
    ],
    onSuccess: () => onClose(),
  });

  const computed = base - discount + adjustment;

  return (
    <Modal
      open
      onClose={onClose}
      title={`청구서 조정 · ${invoice.student_name ?? invoice.student_code}`}
      size="md"
      footer={
        <>
          <button className="btn-ghost text-xs" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary text-xs flex items-center gap-1"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending && <Spinner size={11} />} 저장
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <FormField label="기본 수강료 (원)">
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(base)}
                onChange={(e) => setBase(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
            )}
          </FormField>
          <FormField label="할인 (원)">
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(discount)}
                onChange={(e) => setDiscount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
            )}
          </FormField>
          <FormField label="가산/조정 (원)">
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(adjustment)}
                onChange={(e) => setAdjustment(Math.floor(Number(e.target.value) || 0))}
              />
            )}
          </FormField>
        </div>

        <div className="rounded border border-border bg-bg-soft/40 px-3 py-2 text-xs text-fg-muted">
          실제 청구 합계: <span className="text-fg font-semibold">{fmtWon(computed)}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="납기일">
            {(slot) => (
              <TextInput
                {...slot}
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="상태">
            {(slot) => (
              <SelectInput
                {...slot}
                value={status}
                onChange={(e) => setStatus(e.target.value as InvoiceRow['status'])}
              >
                <option value="unpaid">미납</option>
                <option value="partial">일부</option>
                <option value="paid">완납</option>
                <option value="waived">면제</option>
                <option value="cancelled">취소</option>
              </SelectInput>
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
      </div>
    </Modal>
  );
}

/* ---------------- Student billing modal ---------------- */

function StudentBillingModal({
  students,
  onClose,
}: {
  students: StudentRow[];
  onClose: () => void;
}) {
  const { user } = useSession();
  const api = getApi()!;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    if (!q.trim()) return students;
    const s = q.trim().toLowerCase();
    return students.filter((r) =>
      [r.student_code, r.name, r.school ?? '', r.grade ?? ''].join(' ').toLowerCase().includes(s),
    );
  }, [students, q]);

  return (
    <Modal open onClose={onClose} title="학생별 수강료 설정" size="xl">
      <div className="space-y-3">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="학생 이름 / 코드 / 학교 검색"
          className="input text-xs py-1 w-full"
          aria-label="학생 검색"
        />
        <div className="border border-border rounded overflow-hidden max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-bg-soft/40 text-fg-subtle sticky top-0">
              <tr>
                <th className="text-left px-2 py-1 font-normal">학생</th>
                <th className="text-left px-2 py-1 font-normal">학년/학교</th>
                <th className="text-right px-2 py-1 font-normal">월 수강료</th>
                <th className="text-center px-2 py-1 font-normal">결제일</th>
                <th className="text-center px-2 py-1 font-normal">청구 활성</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-fg-subtle">
                    학생이 없습니다.
                  </td>
                </tr>
              )}
              {filtered.map((s) =>
                editingId === s.id ? (
                  <StudentBillingEditRow
                    key={s.id}
                    student={s}
                    onDone={() => setEditingId(null)}
                    actorId={user!.id}
                    apiClient={api}
                  />
                ) : (
                  <tr key={s.id} className="hover:bg-bg-soft/30">
                    <td className="px-2 py-1">
                      <div className="text-fg">{s.name}</div>
                      <div className="text-[10px] text-fg-subtle">{s.student_code}</div>
                    </td>
                    <td className="px-2 py-1 text-fg-muted">
                      {s.grade ?? '-'} {s.school ? `· ${s.school}` : ''}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-fg">
                      {fmtWon(s.monthly_fee)}
                    </td>
                    <td className="px-2 py-1 text-center text-fg-muted">
                      매월 {s.billing_day}일
                    </td>
                    <td className="px-2 py-1 text-center">
                      {s.billing_active ? (
                        <Check size={12} className="inline text-emerald-300" />
                      ) : (
                        <X size={12} className="inline text-fg-subtle" />
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        onClick={() => setEditingId(s.id)}
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
      </div>
    </Modal>
  );
}

function StudentBillingEditRow({
  student,
  onDone,
  actorId,
  apiClient,
}: {
  student: StudentRow;
  onDone: () => void;
  actorId: number;
  apiClient: NonNullable<Window['api']>;
}) {
  const [fee, setFee] = useState<number>(student.monthly_fee);
  const [day, setDay] = useState<number>(student.billing_day || 5);
  const [active, setActive] = useState<boolean>(!!student.billing_active);

  const save = useMutationWithToast({
    mutationFn: () =>
      apiClient.tuition.updateStudentBilling({
        studentId: student.id,
        monthlyFee: fee,
        billingDay: day,
        billingActive: active,
        actorId,
      }),
    successMessage: '수강료 설정이 저장되었습니다',
    errorMessage: '저장에 실패했습니다',
    invalidates: [['tuition.students']],
    onSuccess: () => onDone(),
  });

  return (
    <tr className="bg-bg-soft/30">
      <td className="px-2 py-1">
        <div className="text-fg">{student.name}</div>
        <div className="text-[10px] text-fg-subtle">{student.student_code}</div>
      </td>
      <td className="px-2 py-1 text-fg-muted">
        {student.grade ?? '-'} {student.school ? `· ${student.school}` : ''}
      </td>
      <td className="px-2 py-1 text-right">
        <input
          type="number"
          value={String(fee)}
          onChange={(e) => setFee(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          className="input text-xs py-1 w-28 text-right tabular-nums"
          aria-label="월 수강료"
        />
      </td>
      <td className="px-2 py-1 text-center">
        <input
          type="number"
          min={1}
          max={28}
          value={String(day)}
          onChange={(e) =>
            setDay(Math.min(28, Math.max(1, Math.floor(Number(e.target.value) || 1))))
          }
          className="input text-xs py-1 w-14 text-center tabular-nums"
          aria-label="결제일"
        />
      </td>
      <td className="px-2 py-1 text-center">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          aria-label="청구 활성"
        />
      </td>
      <td className="px-2 py-1 text-right">
        <div className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={onDone}
            className="btn-ghost text-xs flex items-center gap-1"
          >
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

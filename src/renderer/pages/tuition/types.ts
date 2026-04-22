export interface StudentRow {
  id: number;
  student_code: string;
  name: string;
  grade?: string | null;
  school?: string | null;
  monthly_fee: number;
  billing_day: number;
  billing_active: number;
  memo?: string | null;
}

export interface InvoiceRow {
  id: number;
  student_id: number;
  student_code: string;
  period_yyyymm: string;
  due_date: string | null;
  base_amount: number;
  discount: number;
  adjustment: number;
  total_amount: number;
  paid_amount: number;
  status: 'unpaid' | 'partial' | 'paid' | 'waived' | 'cancelled';
  memo: string | null;
  created_at: string;
  updated_at: string;
  student_name?: string | null;
  student_grade?: string | null;
}

export interface PaymentRow {
  id: number;
  invoice_id: number;
  amount: number;
  method: 'cash' | 'card' | 'transfer' | 'other';
  paid_at: string;
  receipt_no: string | null;
  note: string | null;
  actor_id: number | null;
  actor_name?: string | null;
}

export interface PeriodSummary {
  invoice_count: number;
  total_billed: number;
  total_paid: number;
  total_outstanding: number;
  paid_count: number;
  partial_count: number;
  unpaid_count: number;
  waived_count: number;
}

export const STATUS_LABEL: Record<InvoiceRow['status'], { label: string; tone: string }> = {
  unpaid: { label: '미납', tone: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  partial: { label: '일부', tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  paid: { label: '완납', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  waived: { label: '면제', tone: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  cancelled: { label: '취소', tone: 'bg-bg-soft text-fg-subtle border-border' },
};

export const METHOD_LABEL: Record<PaymentRow['method'], string> = {
  cash: '현금',
  card: '카드',
  transfer: '계좌이체',
  other: '기타',
};

export function fmtWon(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `${n.toLocaleString('ko-KR')}원`;
}

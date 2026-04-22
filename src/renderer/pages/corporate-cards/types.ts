export type CardStatus = 'active' | 'frozen' | 'retired';

export interface CardRow {
  id: number;
  alias: string;
  brand: string | null;
  issuer: string | null;
  last4: string;
  holder_user_id: number | null;
  owner_user_id: number | null;
  monthly_limit: number;
  statement_day: number;
  status: CardStatus;
  memo: string | null;
  created_at: string;
  updated_at: string;
  holder_name: string | null;
  owner_name: string | null;
  active_sub_count: number;
  mtd_spend: number;
}

export interface TxRow {
  id: number;
  card_id: number;
  spent_at: string;
  merchant: string;
  category: string | null;
  amount: number;
  currency: string;
  note: string | null;
  subscription_id: number | null;
  receipt_path: string | null;
  reconciled: number;
  actor_id: number | null;
  created_at: string;
  card_alias: string | null;
  card_last4: string | null;
  subscription_vendor: string | null;
  actor_name: string | null;
}

export interface SummaryRow {
  card_id: number;
  alias: string;
  last4: string;
  monthly_limit: number;
  total_spend: number;
  tx_count: number;
  unreconciled_count: number;
}

export interface UserLite {
  id: number;
  name: string;
  email: string;
  active: number;
}

export interface SubLite {
  id: number;
  vendor: string;
  card_id: number | null;
}

export function fmtWon(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `${n.toLocaleString('ko-KR')}원`;
}

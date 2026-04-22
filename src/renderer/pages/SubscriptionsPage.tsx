import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldAlert,
  Repeat,
  PlusCircle,
  Edit3,
  Save,
  Pause,
  Play,
  X,
  Trash2,
  CalendarClock,
  TrendingUp,
  CreditCard,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import { fmtDate } from '@/lib/date';
import { firstError, required, numberRange } from '@/lib/validators';

type Cadence = 'monthly' | 'yearly' | 'quarterly' | 'weekly' | 'custom';
type Status = 'active' | 'paused' | 'cancelled';

interface SubRow {
  id: number;
  vendor: string;
  plan: string | null;
  category: string | null;
  amount: number;
  currency: string;
  cadence: Cadence;
  cadence_days: number | null;
  next_charge_at: string | null;
  card_id: number | null;
  owner_user_id: number | null;
  status: Status;
  started_at: string | null;
  cancelled_at: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
  card_alias: string | null;
  card_last4: string | null;
  owner_name: string | null;
}

interface CardLite {
  id: number;
  alias: string;
  last4: string;
  status: string;
}

interface UserLite {
  id: number;
  name: string;
  email: string;
  active: number;
}

const STATUS_LABEL: Record<Status, { label: string; tone: string }> = {
  active:    { label: '진행 중', tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  paused:    { label: '일시중지', tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  cancelled: { label: '해지',    tone: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

const CADENCE_LABEL: Record<Cadence, string> = {
  monthly: '월간',
  yearly: '연간',
  quarterly: '분기',
  weekly: '주간',
  custom: '사용자 지정',
};

function fmtWon(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `${n.toLocaleString('ko-KR')}원`;
}

function monthlyEquiv(row: { cadence: Cadence; amount: number; cadence_days: number | null }): number {
  switch (row.cadence) {
    case 'monthly':
      return row.amount;
    case 'yearly':
      return Math.round(row.amount / 12);
    case 'quarterly':
      return Math.round(row.amount / 3);
    case 'weekly':
      return Math.round(row.amount * (52 / 12));
    case 'custom':
      if (row.cadence_days && row.cadence_days > 0) {
        return Math.round((row.amount * 30) / row.cadence_days);
      }
      return row.amount;
  }
}

export function SubscriptionsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const canManage = !!user && user.role !== 'TA';

  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<SubRow | null>(null);

  const subsQuery = useQuery({
    queryKey: ['subs.list', statusFilter || 'all'],
    queryFn: () =>
      api!.subscriptions.list(
        statusFilter ? { status: statusFilter } : undefined,
      ) as unknown as Promise<SubRow[]>,
    enabled: live && canManage,
  });

  const cardsQuery = useQuery({
    queryKey: ['corpCards.list.active'],
    queryFn: () => api!.corpCards.list() as unknown as Promise<CardLite[]>,
    enabled: live && canManage,
  });

  const usersQuery = useQuery({
    queryKey: ['users.list'],
    queryFn: () => api!.users.list() as unknown as Promise<UserLite[]>,
    enabled: live && canManage,
  });

  const forecastQuery = useQuery({
    queryKey: ['subs.forecast'],
    queryFn: () => api!.subscriptions.monthlyForecast(),
    enabled: live && canManage,
  });

  const allRows = useMemo<SubRow[]>(() => subsQuery.data ?? [], [subsQuery.data]);

  const filtered = useMemo(() => {
    if (!q.trim()) return allRows;
    const s = q.trim().toLowerCase();
    return allRows.filter((r) =>
      [
        r.vendor,
        r.plan ?? '',
        r.category ?? '',
        r.card_alias ?? '',
        r.owner_name ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(s),
    );
  }, [allRows, q]);

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 정기 결제 관리 기능을 사용할 수 있습니다.
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
          <p className="mt-2 text-sm text-fg-muted">
            정기 결제 관리는 행정/CEO/운영 매니저만 열람할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  const forecast = forecastQuery.data;

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Repeat size={20} /> 정기 결제 관리
          </h1>
          <p className="mt-1 text-xs text-fg-subtle">
            SaaS 구독, 월정액 서비스, 반복 결제 항목을 통합 관리합니다.
          </p>
        </div>
        <button
          className="btn-primary text-xs flex items-center gap-1"
          onClick={() => setShowNew(true)}
        >
          <PlusCircle size={12} /> 새 정기결제
        </button>
      </header>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="card">
          <div className="flex items-center gap-1 text-[11px] text-fg-subtle">
            <Repeat size={12} /> 진행 중인 구독
          </div>
          <div className="mt-1 text-xl font-semibold">
            {forecast?.activeCount ?? 0}
            <span className="ml-1 text-xs text-fg-subtle">건</span>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-1 text-[11px] text-fg-subtle">
            <TrendingUp size={12} /> 월간 고정비 환산
          </div>
          <div className="mt-1 text-xl font-semibold text-sky-300">
            {fmtWon(forecast?.monthlyTotal)}
          </div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">연간/주간 항목을 월 단위로 환산</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-1 text-[11px] text-fg-subtle">
            <CalendarClock size={12} /> 연간 고정비 환산
          </div>
          <div className="mt-1 text-xl font-semibold">
            {fmtWon((forecast?.monthlyTotal ?? 0) * 12)}
          </div>
        </div>
      </div>

      {/* Filter row */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            <span className="text-fg-subtle">상태</span>
            <select
              className="input text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as '' | Status)}
            >
              <option value="">전체</option>
              <option value="active">진행 중</option>
              <option value="paused">일시중지</option>
              <option value="cancelled">해지</option>
            </select>
          </label>
          <input
            className="input text-xs flex-1 min-w-[160px]"
            placeholder="벤더/플랜/카테고리/카드/담당자 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* Subscriptions table */}
      {subsQuery.isLoading ? (
        <LoadingPanel label="구독 목록을 불러오는 중입니다" />
      ) : subsQuery.isError ? (
        <EmptyState
          tone="error"
          icon={Repeat}
          title="구독 목록을 불러오지 못했습니다"
          hint={(subsQuery.error as Error | null)?.message || '다시 시도해 주세요.'}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="조건에 맞는 구독이 없습니다"
          hint="상단 ‘새 정기결제’로 등록하세요."
        />
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="min-w-full text-xs">
            <thead className="border-b border-border bg-bg-soft/40 text-fg-subtle">
              <tr>
                <th className="px-3 py-2 text-left">벤더 / 플랜</th>
                <th className="px-3 py-2 text-left">카테고리</th>
                <th className="px-3 py-2 text-right">금액</th>
                <th className="px-3 py-2 text-left">주기</th>
                <th className="px-3 py-2 text-right">월 환산</th>
                <th className="px-3 py-2 text-left">다음 결제</th>
                <th className="px-3 py-2 text-left">결제수단</th>
                <th className="px-3 py-2 text-left">담당</th>
                <th className="px-3 py-2 text-left">상태</th>
                <th className="px-3 py-2 text-left">작업</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-bg-soft/40">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{r.vendor}</div>
                    {r.plan && (
                      <div className="text-[11px] text-fg-subtle">{r.plan}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{r.category ?? '-'}</td>
                  <td className="px-3 py-2 text-right">{fmtWon(r.amount)}</td>
                  <td className="px-3 py-2">
                    {CADENCE_LABEL[r.cadence]}
                    {r.cadence === 'custom' && r.cadence_days
                      ? ` (${r.cadence_days}일)`
                      : ''}
                  </td>
                  <td className="px-3 py-2 text-right text-sky-300">
                    {fmtWon(monthlyEquiv(r))}
                  </td>
                  <td className="px-3 py-2">
                    {r.next_charge_at ? fmtDate(r.next_charge_at) : '-'}
                  </td>
                  <td className="px-3 py-2">
                    {r.card_alias ? (
                      <span className="inline-flex items-center gap-1 text-[11px]">
                        <CreditCard size={10} /> {r.card_alias}
                        <span className="text-fg-subtle">·{r.card_last4}</span>
                      </span>
                    ) : (
                      <span className="text-fg-subtle">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.owner_name ?? '-'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] ${STATUS_LABEL[r.status].tone}`}
                    >
                      {STATUS_LABEL[r.status].label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <SubActions row={r} onEdit={() => setEditing(r)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <SubscriptionModal
          onClose={() => setShowNew(false)}
          cards={cardsQuery.data ?? []}
          users={usersQuery.data ?? []}
        />
      )}
      {editing && (
        <SubscriptionModal
          initial={editing}
          onClose={() => setEditing(null)}
          cards={cardsQuery.data ?? []}
          users={usersQuery.data ?? []}
        />
      )}
    </div>
  );
}

/* ---------------- row actions ---------------- */

function SubActions({ row, onEdit }: { row: SubRow; onEdit: () => void }) {
  const { user } = useSession();
  const api = getApi()!;

  const setStatus = useMutationWithToast({
    mutationFn: (status: Status) =>
      api.subscriptions.setStatus({ id: row.id, status, actorId: user!.id }),
    successMessage: '상태를 변경했습니다',
    errorMessage: '상태 변경에 실패했습니다',
    invalidates: [['subs.list', 'all'], ['subs.list', row.status], ['subs.forecast']],
  });

  const del = useMutationWithToast({
    mutationFn: () => api.subscriptions.delete({ id: row.id, actorId: user!.id }),
    successMessage: '삭제했습니다',
    errorMessage: '삭제에 실패했습니다',
    invalidates: [['subs.list', 'all'], ['subs.forecast']],
  });

  return (
    <div className="flex items-center gap-1">
      <button
        className="btn-ghost text-[10px] flex items-center gap-0.5"
        onClick={onEdit}
        title="수정"
      >
        <Edit3 size={10} /> 수정
      </button>
      {row.status !== 'active' && (
        <button
          className="btn-ghost text-[10px] flex items-center gap-0.5 text-emerald-300"
          onClick={() => setStatus.mutate('active')}
          disabled={setStatus.isPending}
          title="진행으로 전환"
        >
          <Play size={10} /> 진행
        </button>
      )}
      {row.status === 'active' && (
        <button
          className="btn-ghost text-[10px] flex items-center gap-0.5 text-amber-300"
          onClick={() => setStatus.mutate('paused')}
          disabled={setStatus.isPending}
          title="일시중지"
        >
          <Pause size={10} /> 중지
        </button>
      )}
      {row.status !== 'cancelled' && (
        <button
          className="btn-ghost text-[10px] flex items-center gap-0.5 text-rose-300"
          onClick={() => {
            if (confirm(`${row.vendor} 구독을 해지 상태로 변경할까요?`))
              setStatus.mutate('cancelled');
          }}
          disabled={setStatus.isPending}
          title="해지"
        >
          <X size={10} /> 해지
        </button>
      )}
      <button
        className="btn-ghost text-[10px] flex items-center gap-0.5 text-fg-subtle"
        onClick={() => {
          if (confirm(`${row.vendor} 구독 레코드를 영구 삭제할까요?`)) del.mutate();
        }}
        disabled={del.isPending}
        title="영구 삭제"
      >
        <Trash2 size={10} /> 삭제
      </button>
    </div>
  );
}

/* ---------------- add/edit modal ---------------- */

function SubscriptionModal({
  initial,
  onClose,
  cards,
  users,
}: {
  initial?: SubRow;
  onClose: () => void;
  cards: CardLite[];
  users: UserLite[];
}) {
  const { user } = useSession();
  const api = getApi()!;

  const [vendor, setVendor] = useState(initial?.vendor ?? '');
  const [plan, setPlan] = useState(initial?.plan ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [amount, setAmount] = useState(initial?.amount ?? 0);
  const [currency, setCurrency] = useState(initial?.currency ?? 'KRW');
  const [cadence, setCadence] = useState<Cadence>(initial?.cadence ?? 'monthly');
  const [cadenceDays, setCadenceDays] = useState<number>(initial?.cadence_days ?? 30);
  const [nextChargeAt, setNextChargeAt] = useState(initial?.next_charge_at ?? '');
  const [cardId, setCardId] = useState<number | ''>(initial?.card_id ?? '');
  const [ownerUserId, setOwnerUserId] = useState<number | ''>(initial?.owner_user_id ?? '');
  const [status, setStatus] = useState<Status>(initial?.status ?? 'active');
  const [startedAt, setStartedAt] = useState(initial?.started_at ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const errVendor = firstError<string>([required('벤더명은 필수입니다')])(vendor);
  const errAmount = firstError<number | null | undefined>([
    numberRange(0, 1_000_000_000, '0 이상 10억 이하로 입력하세요'),
  ])(amount);
  const errCadenceDays =
    cadence === 'custom'
      ? firstError<number | null | undefined>([
          numberRange(1, 365, '1 ~ 365일 사이로 입력하세요'),
        ])(cadenceDays)
      : null;

  const hasError = !!errVendor || !!errAmount || !!errCadenceDays;

  const save = useMutationWithToast({
    mutationFn: () =>
      api.subscriptions.upsert({
        id: initial?.id,
        vendor: vendor.trim(),
        plan: plan.trim() || null,
        category: category.trim() || null,
        amount: Math.max(0, Math.floor(amount)),
        currency,
        cadence,
        cadenceDays: cadence === 'custom' ? cadenceDays : null,
        nextChargeAt: nextChargeAt || null,
        cardId: cardId === '' ? null : cardId,
        ownerUserId: ownerUserId === '' ? null : ownerUserId,
        status,
        startedAt: startedAt || null,
        memo: memo.trim() || null,
        actorId: user!.id,
      }),
    successMessage: initial ? '구독이 수정되었습니다' : '새 구독을 등록했습니다',
    errorMessage: '저장에 실패했습니다',
    invalidates: [['subs.list', 'all'], ['subs.forecast']],
    onSuccess: () => onClose(),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial ? `정기결제 수정 · ${initial.vendor}` : '새 정기결제'}
      footer={
        <>
          <button className="btn-ghost text-xs" onClick={onClose}>
            취소
          </button>
          <button
            className="btn-primary text-xs flex items-center gap-1"
            onClick={() => {
              setSubmitAttempted(true);
              if (!hasError) save.mutate();
            }}
            disabled={save.isPending}
          >
            {save.isPending && <Spinner size={11} />} <Save size={11} /> 저장
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="벤더 (서비스명)"
            required
            error={submitAttempted ? errVendor : undefined}
          >
            {(slot) => (
              <TextInput
                {...slot}
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                placeholder="예) Slack, Notion, AWS"
              />
            )}
          </FormField>
          <FormField label="플랜 / 상품명">
            {(slot) => (
              <TextInput
                {...slot}
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                placeholder="예) Business Plus"
              />
            )}
          </FormField>
          <FormField label="카테고리">
            {(slot) => (
              <TextInput
                {...slot}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="예) 생산성, 인프라, 교육컨텐츠"
              />
            )}
          </FormField>
          <FormField
            label="금액"
            error={submitAttempted ? errAmount : undefined}
          >
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(amount)}
                onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
            )}
          </FormField>
          <FormField label="통화">
            {(slot) => (
              <SelectInput
                {...slot}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="KRW">KRW (원)</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="JPY">JPY</option>
              </SelectInput>
            )}
          </FormField>
          <FormField label="결제 주기">
            {(slot) => (
              <SelectInput
                {...slot}
                value={cadence}
                onChange={(e) => setCadence(e.target.value as Cadence)}
              >
                <option value="monthly">월간</option>
                <option value="yearly">연간</option>
                <option value="quarterly">분기</option>
                <option value="weekly">주간</option>
                <option value="custom">사용자 지정 (일 단위)</option>
              </SelectInput>
            )}
          </FormField>
          {cadence === 'custom' && (
            <FormField
              label="주기 (일)"
              error={submitAttempted ? errCadenceDays : undefined}
            >
              {(slot) => (
                <TextInput
                  {...slot}
                  type="number"
                  value={String(cadenceDays)}
                  onChange={(e) =>
                    setCadenceDays(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                  }
                />
              )}
            </FormField>
          )}
          <FormField label="다음 결제 예정일">
            {(slot) => (
              <TextInput
                {...slot}
                type="date"
                value={nextChargeAt}
                onChange={(e) => setNextChargeAt(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="시작일">
            {(slot) => (
              <TextInput
                {...slot}
                type="date"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="결제 카드">
            {(slot) => (
              <SelectInput
                {...slot}
                value={String(cardId)}
                onChange={(e) =>
                  setCardId(e.target.value === '' ? '' : Number(e.target.value))
                }
              >
                <option value="">(미지정)</option>
                {cards
                  .filter((c) => c.status !== 'retired')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.alias} · {c.last4}
                    </option>
                  ))}
              </SelectInput>
            )}
          </FormField>
          <FormField label="담당자">
            {(slot) => (
              <SelectInput
                {...slot}
                value={String(ownerUserId)}
                onChange={(e) =>
                  setOwnerUserId(e.target.value === '' ? '' : Number(e.target.value))
                }
              >
                <option value="">(미지정)</option>
                {users
                  .filter((u) => !!u.active)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </SelectInput>
            )}
          </FormField>
          <FormField label="상태">
            {(slot) => (
              <SelectInput
                {...slot}
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
              >
                <option value="active">진행 중</option>
                <option value="paused">일시중지</option>
                <option value="cancelled">해지</option>
              </SelectInput>
            )}
          </FormField>
        </div>
        <FormField label="메모">
          {(slot) => (
            <Textarea
              {...slot}
              rows={2}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="계정 담당자, 해지 조건, 라이선스 수 등"
            />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldAlert,
  CreditCard,
  PlusCircle,
  Edit3,
  Save,
  ReceiptText,
  CheckCircle2,
  Circle,
  Trash2,
  Snowflake,
  Power,
  Archive,
  AlertTriangle,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { LoadingPanel, Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { FormField, SelectInput, TextInput, Textarea } from '@/components/ui/FormField';
import { fmtDate, thisMonthYm, todayLocalYmd } from '@/lib/date';
import { firstError, numberRange, required, pattern } from '@/lib/validators';
import {
  fmtWon,
  type CardRow,
  type CardStatus,
  type SubLite,
  type SummaryRow,
  type TxRow,
  type UserLite,
} from './corporate-cards/types';

const STATUS_LABEL: Record<CardStatus, { label: string; tone: string; icon: React.ReactNode }> = {
  active:  { label: '활성',     tone: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: <Power size={10} /> },
  frozen:  { label: '정지',     tone: 'bg-amber-500/15 text-amber-300 border-amber-500/30',      icon: <Snowflake size={10} /> },
  retired: { label: '폐기',     tone: 'bg-rose-500/15 text-rose-300 border-rose-500/30',        icon: <Archive size={10} /> },
};

export function CorporateCardsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;
  const canManage = !!user && user.role !== 'TA';

  const [period, setPeriod] = useState<string>(() => thisMonthYm());
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [reconciledFilter, setReconciledFilter] = useState<'' | 'true' | 'false'>('');
  const [showCardNew, setShowCardNew] = useState(false);
  const [editingCard, setEditingCard] = useState<CardRow | null>(null);
  const [showTxNew, setShowTxNew] = useState(false);

  const cardsQuery = useQuery({
    queryKey: ['corpCards.list'],
    queryFn: () => api!.corpCards.list() as unknown as Promise<CardRow[]>,
    enabled: live && canManage,
  });

  const summaryQuery = useQuery({
    queryKey: ['corpCards.summary', period],
    queryFn: () =>
      api!.corpCards.monthlySummary(period) as unknown as Promise<SummaryRow[]>,
    enabled: live && canManage,
  });

  const txQuery = useQuery({
    queryKey: ['corpCards.tx', selectedCard ?? 'all', period, reconciledFilter],
    queryFn: () =>
      api!.corpCards.listTransactions({
        cardId: selectedCard ?? undefined,
        period,
        reconciled: reconciledFilter === '' ? undefined : reconciledFilter === 'true',
        limit: 500,
      }) as unknown as Promise<TxRow[]>,
    enabled: live && canManage,
  });

  const usersQuery = useQuery({
    queryKey: ['users.list'],
    queryFn: () => api!.users.list() as unknown as Promise<UserLite[]>,
    enabled: live && canManage,
  });

  const subsQuery = useQuery({
    queryKey: ['subs.list.all.for.tx'],
    queryFn: () =>
      api!.subscriptions.list() as unknown as Promise<SubLite[]>,
    enabled: live && canManage,
  });

  const cards = useMemo<CardRow[]>(() => cardsQuery.data ?? [], [cardsQuery.data]);
  const summaries = useMemo<SummaryRow[]>(
    () => summaryQuery.data ?? [],
    [summaryQuery.data],
  );
  const txs = useMemo<TxRow[]>(() => txQuery.data ?? [], [txQuery.data]);

  const summaryByCardId = useMemo(() => {
    const map = new Map<number, SummaryRow>();
    for (const s of summaries) map.set(s.card_id, s);
    return map;
  }, [summaries]);

  const totalThisMonth = useMemo(
    () => summaries.reduce((a, b) => a + (b.total_spend || 0), 0),
    [summaries],
  );
  const unreconciledTotal = useMemo(
    () => summaries.reduce((a, b) => a + (b.unreconciled_count || 0), 0),
    [summaries],
  );

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 법인 카드 기능을 사용할 수 있습니다.
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
            법인 카드 관리는 행정/CEO/운영 매니저만 열람할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <CreditCard size={20} /> 법인 카드 관리
          </h1>
          <p className="mt-1 text-xs text-fg-subtle">
            카드 인벤토리 · 월별 사용 내역 · 정산 확인을 한 곳에서 처리합니다.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            <span className="text-fg-subtle">조회 월</span>
            <input
              type="month"
              className="input text-xs"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            />
          </label>
          <button
            className="btn-outline text-xs flex items-center gap-1"
            onClick={() => setShowTxNew(true)}
          >
            <ReceiptText size={12} /> 사용내역 추가
          </button>
          <button
            className="btn-primary text-xs flex items-center gap-1"
            onClick={() => setShowCardNew(true)}
          >
            <PlusCircle size={12} /> 새 카드
          </button>
        </div>
      </header>

      {/* Top summary */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="card">
          <div className="flex items-center gap-1 text-[11px] text-fg-subtle">
            <CreditCard size={12} /> 등록 카드
          </div>
          <div className="mt-1 text-xl font-semibold">
            {cards.length}
            <span className="ml-1 text-xs text-fg-subtle">장</span>
          </div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">
            활성 {cards.filter((c) => c.status === 'active').length} ·
            정지 {cards.filter((c) => c.status === 'frozen').length} ·
            폐기 {cards.filter((c) => c.status === 'retired').length}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-1 text-[11px] text-fg-subtle">
            <ReceiptText size={12} /> 이번 월 사용액
          </div>
          <div className="mt-1 text-xl font-semibold text-sky-300">
            {fmtWon(totalThisMonth)}
          </div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">{period}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-1 text-[11px] text-fg-subtle">
            <AlertTriangle size={12} /> 미정산 건
          </div>
          <div className="mt-1 text-xl font-semibold text-amber-300">
            {unreconciledTotal}
            <span className="ml-1 text-xs text-fg-subtle">건</span>
          </div>
          <div className="mt-0.5 text-[11px] text-fg-subtle">reconciled = 0</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-1 text-[11px] text-fg-subtle">
            <ReceiptText size={12} /> 이번 월 거래 건수
          </div>
          <div className="mt-1 text-xl font-semibold">
            {summaries.reduce((a, b) => a + (b.tx_count || 0), 0)}
          </div>
        </div>
      </div>

      {/* Card inventory */}
      {cardsQuery.isLoading ? (
        <LoadingPanel label="카드 목록을 불러오는 중입니다" />
      ) : cards.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="등록된 법인 카드가 없습니다"
          hint="상단의 ‘새 카드’로 등록해 주세요."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => {
            const summary = summaryByCardId.get(c.id);
            const mtd = summary?.total_spend ?? c.mtd_spend ?? 0;
            const limit = c.monthly_limit;
            const pct = limit > 0 ? Math.min(100, Math.round((mtd / limit) * 100)) : 0;
            const overLimit = limit > 0 && mtd > limit;
            const active = selectedCard === c.id;
            return (
              <div
                key={c.id}
                className={`card ${active ? 'ring-2 ring-sky-500/50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedCard(active ? null : c.id)}
                    className="text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{c.alias}</span>
                      <span
                        className={`inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] ${STATUS_LABEL[c.status].tone}`}
                      >
                        {STATUS_LABEL[c.status].icon}
                        {STATUS_LABEL[c.status].label}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-fg-subtle">
                      {c.brand ?? '브랜드 미지정'} · {c.issuer ?? '-'} · ****{c.last4}
                    </div>
                  </button>
                  <button
                    className="btn-ghost text-[10px] flex items-center gap-0.5"
                    onClick={() => setEditingCard(c)}
                  >
                    <Edit3 size={10} /> 수정
                  </button>
                </div>

                <div className="mt-3 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-fg-subtle">이번 월 사용</span>
                    <span className={overLimit ? 'text-rose-300 font-semibold' : 'text-fg'}>
                      {fmtWon(mtd)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-fg-subtle">월 한도</span>
                    <span>{limit > 0 ? fmtWon(limit) : '무제한'}</span>
                  </div>
                  {limit > 0 && (
                    <div className="h-1.5 overflow-hidden rounded bg-bg-soft">
                      <div
                        className={`h-full ${
                          overLimit
                            ? 'bg-rose-500'
                            : pct >= 80
                            ? 'bg-amber-400'
                            : 'bg-sky-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-1 text-[11px] text-fg-muted">
                  <div>소지자: <span className="text-fg">{c.holder_name ?? '-'}</span></div>
                  <div>관리자: <span className="text-fg">{c.owner_name ?? '-'}</span></div>
                  <div>결제일: <span className="text-fg">매월 {c.statement_day}일</span></div>
                  <div>구독: <span className="text-fg">{c.active_sub_count}건</span></div>
                </div>

                {summary && summary.unreconciled_count > 0 && (
                  <div className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                    미정산 {summary.unreconciled_count}건 있음
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Transaction list */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            {selectedCard
              ? `거래 내역 · ${cards.find((c) => c.id === selectedCard)?.alias ?? '카드'}`
              : '전체 거래 내역'}
            <span className="ml-2 text-[11px] text-fg-subtle">({period})</span>
          </h2>
          <div className="flex items-center gap-2 text-xs">
            {selectedCard !== null && (
              <button
                className="btn-ghost text-xs"
                onClick={() => setSelectedCard(null)}
              >
                카드 필터 해제
              </button>
            )}
            <label className="flex items-center gap-1">
              <span className="text-fg-subtle">정산</span>
              <select
                className="input text-xs"
                value={reconciledFilter}
                onChange={(e) =>
                  setReconciledFilter(e.target.value as '' | 'true' | 'false')
                }
              >
                <option value="">전체</option>
                <option value="true">정산 완료</option>
                <option value="false">미정산</option>
              </select>
            </label>
          </div>
        </div>

        {txQuery.isLoading ? (
          <LoadingPanel label="거래 내역을 불러오는 중입니다" />
        ) : txs.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="해당 조건의 거래 내역이 없습니다"
            hint="월을 바꾸거나 필터를 조정해 보세요."
          />
        ) : (
          <div className="card overflow-x-auto p-0">
            <table className="min-w-full text-xs">
              <thead className="border-b border-border bg-bg-soft/40 text-fg-subtle">
                <tr>
                  <th className="px-3 py-2 text-left">사용일</th>
                  <th className="px-3 py-2 text-left">카드</th>
                  <th className="px-3 py-2 text-left">가맹점</th>
                  <th className="px-3 py-2 text-left">카테고리</th>
                  <th className="px-3 py-2 text-right">금액</th>
                  <th className="px-3 py-2 text-left">구독 연결</th>
                  <th className="px-3 py-2 text-left">등록자</th>
                  <th className="px-3 py-2 text-center">정산</th>
                  <th className="px-3 py-2 text-left">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {txs.map((t) => (
                  <TxRowView key={t.id} row={t} period={period} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-bg-soft/40 text-xs">
                  <td className="px-3 py-2 font-semibold" colSpan={4}>
                    합계 ({txs.length}건)
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {fmtWon(txs.reduce((a, b) => a + (b.amount || 0), 0))}
                  </td>
                  <td className="px-3 py-2" colSpan={4} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {showCardNew && (
        <CardModal
          onClose={() => setShowCardNew(false)}
          users={usersQuery.data ?? []}
        />
      )}
      {editingCard && (
        <CardModal
          initial={editingCard}
          onClose={() => setEditingCard(null)}
          users={usersQuery.data ?? []}
        />
      )}
      {showTxNew && (
        <TransactionModal
          onClose={() => setShowTxNew(false)}
          cards={cards}
          subs={subsQuery.data ?? []}
          defaultCardId={selectedCard ?? null}
        />
      )}
    </div>
  );
}

/* ---------------- transaction row ---------------- */

function TxRowView({ row, period }: { row: TxRow; period: string }) {
  const { user } = useSession();
  const api = getApi()!;

  const toggle = useMutationWithToast({
    mutationFn: () =>
      api.corpCards.setReconciled({
        id: row.id,
        reconciled: !row.reconciled,
        actorId: user!.id,
      }),
    successMessage: row.reconciled ? '미정산으로 변경했습니다' : '정산 완료로 표시했습니다',
    errorMessage: '정산 상태 변경 실패',
    invalidates: [
      ['corpCards.tx'],
      ['corpCards.summary', period],
    ],
  });

  const del = useMutationWithToast({
    mutationFn: () => api.corpCards.deleteTransaction({ id: row.id, actorId: user!.id }),
    successMessage: '거래를 삭제했습니다',
    errorMessage: '삭제에 실패했습니다',
    invalidates: [
      ['corpCards.tx'],
      ['corpCards.summary', period],
      ['corpCards.list'],
    ],
  });

  return (
    <tr className="hover:bg-bg-soft/40">
      <td className="px-3 py-2">{fmtDate(row.spent_at)}</td>
      <td className="px-3 py-2">
        {row.card_alias ? (
          <span className="inline-flex items-center gap-1">
            <CreditCard size={10} /> {row.card_alias}
            <span className="text-[10px] text-fg-subtle">·{row.card_last4}</span>
          </span>
        ) : (
          <span className="text-fg-subtle">-</span>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="font-semibold">{row.merchant}</div>
        {row.note && <div className="text-[11px] text-fg-subtle">{row.note}</div>}
      </td>
      <td className="px-3 py-2 text-fg-muted">{row.category ?? '-'}</td>
      <td className="px-3 py-2 text-right">
        {fmtWon(row.amount)}
        {row.currency !== 'KRW' && (
          <span className="ml-1 text-[10px] text-fg-subtle">{row.currency}</span>
        )}
      </td>
      <td className="px-3 py-2 text-fg-muted">
        {row.subscription_vendor ?? <span className="text-fg-subtle">-</span>}
      </td>
      <td className="px-3 py-2 text-fg-muted">{row.actor_name ?? '-'}</td>
      <td className="px-3 py-2 text-center">
        <button
          className={`inline-flex items-center gap-0.5 text-[11px] ${
            row.reconciled ? 'text-emerald-300' : 'text-fg-subtle'
          }`}
          onClick={() => toggle.mutate()}
          disabled={toggle.isPending}
          title={row.reconciled ? '정산 완료 — 클릭하여 해제' : '미정산 — 클릭하여 완료 처리'}
        >
          {row.reconciled ? <CheckCircle2 size={12} /> : <Circle size={12} />}
          {row.reconciled ? '완료' : '대기'}
        </button>
      </td>
      <td className="px-3 py-2">
        <button
          className="btn-ghost text-[10px] flex items-center gap-0.5 text-rose-300"
          onClick={() => {
            if (confirm(`${row.merchant} (${fmtWon(row.amount)}) 거래를 삭제할까요?`))
              del.mutate();
          }}
          disabled={del.isPending}
        >
          <Trash2 size={10} /> 삭제
        </button>
      </td>
    </tr>
  );
}

/* ---------------- card add/edit modal ---------------- */

function CardModal({
  initial,
  onClose,
  users,
}: {
  initial?: CardRow;
  onClose: () => void;
  users: UserLite[];
}) {
  const { user } = useSession();
  const api = getApi()!;

  const [alias, setAlias] = useState(initial?.alias ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [issuer, setIssuer] = useState(initial?.issuer ?? '');
  const [last4, setLast4] = useState(initial?.last4 ?? '');
  const [holderId, setHolderId] = useState<number | ''>(initial?.holder_user_id ?? '');
  const [ownerId, setOwnerId] = useState<number | ''>(initial?.owner_user_id ?? '');
  const [monthlyLimit, setMonthlyLimit] = useState(initial?.monthly_limit ?? 0);
  const [statementDay, setStatementDay] = useState(initial?.statement_day ?? 25);
  const [status, setStatus] = useState<CardStatus>(initial?.status ?? 'active');
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const errAlias = firstError<string>([required('카드 별칭은 필수입니다')])(alias);
  const errLast4 = firstError<string>([
    required('뒷 4자리는 필수입니다'),
    pattern(/^\d{4}$/, '숫자 4자리로 입력하세요'),
  ])(last4);
  const errStatementDay = firstError<number | null | undefined>([
    numberRange(1, 28, '1 ~ 28일 사이로 입력하세요'),
  ])(statementDay);
  const errLimit = firstError<number | null | undefined>([
    numberRange(0, 10_000_000_000, '0 이상으로 입력하세요'),
  ])(monthlyLimit);

  const hasError = !!(errAlias || errLast4 || errStatementDay || errLimit);

  const save = useMutationWithToast({
    mutationFn: () =>
      api.corpCards.upsert({
        id: initial?.id,
        alias: alias.trim(),
        brand: brand.trim() || null,
        issuer: issuer.trim() || null,
        last4,
        holderUserId: holderId === '' ? null : holderId,
        ownerUserId: ownerId === '' ? null : ownerId,
        monthlyLimit: Math.max(0, Math.floor(monthlyLimit)),
        statementDay,
        status,
        memo: memo.trim() || null,
        actorId: user!.id,
      }),
    successMessage: initial ? '카드가 수정되었습니다' : '카드를 등록했습니다',
    errorMessage: '저장에 실패했습니다',
    invalidates: [['corpCards.list'], ['corpCards.summary']],
    onSuccess: () => onClose(),
  });

  const setStatusMut = useMutationWithToast({
    mutationFn: (s: CardStatus) =>
      api.corpCards.setStatus({
        id: initial!.id,
        status: s,
        actorId: user!.id,
      }),
    successMessage: '상태를 변경했습니다',
    errorMessage: '상태 변경에 실패했습니다',
    invalidates: [['corpCards.list']],
    onSuccess: () => onClose(),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial ? `카드 수정 · ${initial.alias}` : '새 법인 카드 등록'}
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
            label="별칭"
            required
            error={submitAttempted ? errAlias : undefined}
          >
            {(slot) => (
              <TextInput
                {...slot}
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="예) 행정용 주카드"
              />
            )}
          </FormField>
          <FormField
            label="뒷 4자리"
            required
            error={submitAttempted ? errLast4 : undefined}
            hint="영수증·카드사 내역 매칭을 위한 식별용"
          >
            {(slot) => (
              <TextInput
                {...slot}
                maxLength={4}
                value={last4}
                onChange={(e) => setLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
              />
            )}
          </FormField>
          <FormField label="브랜드">
            {(slot) => (
              <TextInput
                {...slot}
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="예) VISA, Mastercard"
              />
            )}
          </FormField>
          <FormField label="발급사">
            {(slot) => (
              <TextInput
                {...slot}
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                placeholder="예) 신한카드, 하나카드"
              />
            )}
          </FormField>
          <FormField label="소지자">
            {(slot) => (
              <SelectInput
                {...slot}
                value={String(holderId)}
                onChange={(e) =>
                  setHolderId(e.target.value === '' ? '' : Number(e.target.value))
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
          <FormField label="관리자 (책임자)">
            {(slot) => (
              <SelectInput
                {...slot}
                value={String(ownerId)}
                onChange={(e) =>
                  setOwnerId(e.target.value === '' ? '' : Number(e.target.value))
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
          <FormField
            label="월 한도 (원)"
            error={submitAttempted ? errLimit : undefined}
            hint="0 입력 시 제한 없음으로 간주"
          >
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(monthlyLimit)}
                onChange={(e) =>
                  setMonthlyLimit(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                }
              />
            )}
          </FormField>
          <FormField
            label="결제일 (매월)"
            error={submitAttempted ? errStatementDay : undefined}
          >
            {(slot) => (
              <TextInput
                {...slot}
                type="number"
                value={String(statementDay)}
                onChange={(e) =>
                  setStatementDay(
                    Math.min(28, Math.max(1, Math.floor(Number(e.target.value) || 1))),
                  )
                }
              />
            )}
          </FormField>
          <FormField label="상태">
            {(slot) => (
              <SelectInput
                {...slot}
                value={status}
                onChange={(e) => setStatus(e.target.value as CardStatus)}
              >
                <option value="active">활성</option>
                <option value="frozen">정지</option>
                <option value="retired">폐기</option>
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
              placeholder="카드 발급 조건, 용도, 리워드 등"
            />
          )}
        </FormField>

        {initial && (
          <div className="rounded border border-border bg-bg-soft/40 px-3 py-2 text-[11px] text-fg-subtle">
            빠른 상태 전환:{' '}
            <button
              className="btn-ghost text-[11px] text-emerald-300"
              onClick={() => setStatusMut.mutate('active')}
              disabled={setStatusMut.isPending || initial.status === 'active'}
            >
              활성
            </button>
            {' · '}
            <button
              className="btn-ghost text-[11px] text-amber-300"
              onClick={() => setStatusMut.mutate('frozen')}
              disabled={setStatusMut.isPending || initial.status === 'frozen'}
            >
              정지
            </button>
            {' · '}
            <button
              className="btn-ghost text-[11px] text-rose-300"
              onClick={() => {
                if (confirm('이 카드를 폐기 상태로 변경하시겠습니까?'))
                  setStatusMut.mutate('retired');
              }}
              disabled={setStatusMut.isPending || initial.status === 'retired'}
            >
              폐기
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------- transaction add modal ---------------- */

function TransactionModal({
  onClose,
  cards,
  subs,
  defaultCardId,
}: {
  onClose: () => void;
  cards: CardRow[];
  subs: SubLite[];
  defaultCardId: number | null;
}) {
  const { user } = useSession();
  const api = getApi()!;

  const firstActiveCard = cards.find((c) => c.status === 'active') ?? cards[0];
  const [cardId, setCardId] = useState<number>(defaultCardId ?? firstActiveCard?.id ?? 0);
  const [spentAt, setSpentAt] = useState<string>(todayLocalYmd());
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState('KRW');
  const [subscriptionId, setSubscriptionId] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const errCard = firstError<number | null | undefined>([
    numberRange(1, 1_000_000_000, '카드를 선택하세요'),
  ])(cardId || null);
  const errMerchant = firstError<string>([required('가맹점명은 필수입니다')])(merchant);
  const errAmount = firstError<number | null | undefined>([
    numberRange(1, 1_000_000_000, '금액을 입력하세요'),
  ])(amount);

  const hasError = !!(errCard || errMerchant || errAmount);

  const save = useMutationWithToast({
    mutationFn: () =>
      api.corpCards.addTransaction({
        cardId,
        spentAt,
        merchant: merchant.trim(),
        category: category.trim() || null,
        amount: Math.max(1, Math.floor(amount)),
        currency,
        note: note.trim() || null,
        subscriptionId: subscriptionId === '' ? null : subscriptionId,
        actorId: user!.id,
      }),
    successMessage: '거래 내역을 추가했습니다',
    errorMessage: '추가에 실패했습니다',
    invalidates: [
      ['corpCards.tx'],
      ['corpCards.summary'],
      ['corpCards.list'],
    ],
    onSuccess: () => onClose(),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="법인 카드 사용내역 추가"
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
            disabled={save.isPending || cards.length === 0}
          >
            {save.isPending && <Spinner size={11} />} <Save size={11} /> 저장
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {cards.length === 0 ? (
          <div className="rounded border border-border bg-bg-soft/40 px-3 py-2 text-xs text-fg-muted">
            먼저 카드를 등록해야 거래 내역을 기록할 수 있습니다.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="카드"
              required
              error={submitAttempted ? errCard : undefined}
            >
              {(slot) => (
                <SelectInput
                  {...slot}
                  value={String(cardId || '')}
                  onChange={(e) => setCardId(Number(e.target.value) || 0)}
                >
                  <option value="">(카드 선택)</option>
                  {cards
                    .filter((c) => c.status !== 'retired')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.alias} · ****{c.last4}
                      </option>
                    ))}
                </SelectInput>
              )}
            </FormField>
            <FormField label="사용일">
              {(slot) => (
                <TextInput
                  {...slot}
                  type="date"
                  value={spentAt}
                  onChange={(e) => setSpentAt(e.target.value)}
                />
              )}
            </FormField>
            <FormField
              label="가맹점 / 용처"
              required
              error={submitAttempted ? errMerchant : undefined}
              className="col-span-2"
            >
              {(slot) => (
                <TextInput
                  {...slot}
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="예) 스타벅스, AWS, 동네 문구점"
                />
              )}
            </FormField>
            <FormField label="카테고리">
              {(slot) => (
                <TextInput
                  {...slot}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="예) 식비, 인프라, 소모품"
                />
              )}
            </FormField>
            <FormField
              label="금액"
              required
              error={submitAttempted ? errAmount : undefined}
            >
              {(slot) => (
                <TextInput
                  {...slot}
                  type="number"
                  value={String(amount)}
                  onChange={(e) =>
                    setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                  }
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
                  <option value="KRW">KRW</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="JPY">JPY</option>
                </SelectInput>
              )}
            </FormField>
            <FormField
              label="정기 결제 연결"
              hint="이 거래가 등록된 정기 결제와 매칭되면 선택"
              className="col-span-2"
            >
              {(slot) => (
                <SelectInput
                  {...slot}
                  value={String(subscriptionId)}
                  onChange={(e) =>
                    setSubscriptionId(
                      e.target.value === '' ? '' : Number(e.target.value),
                    )
                  }
                >
                  <option value="">(없음 / 일회성 지출)</option>
                  {subs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.vendor}
                    </option>
                  ))}
                </SelectInput>
              )}
            </FormField>
            <FormField label="메모" className="col-span-2">
              {(slot) => (
                <Textarea
                  {...slot}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="법인카드 영수증 번호, 참석자 등"
                />
              )}
            </FormField>
          </div>
        )}
      </div>
    </Modal>
  );
}

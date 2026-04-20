import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, ClipboardList, CheckCircle2, AlertTriangle, MessageSquare,
  Clock, Stamp, TrendingDown, TrendingUp,
} from 'lucide-react';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';
import { cn } from '@/lib/cn';

interface KpiData {
  assignmentsOpen: number;
  completedThisMonth: number;
  qaRejectRate: number;
  csOpen: number;
  csAvgMins: number;
  attendanceLate: number;
  pendingApprovals: number;
  daily: Array<{ d: string; n: number }>;
}

export function ReportsPage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;

  const kpiQuery = useQuery({
    queryKey: ['reports.kpi'],
    queryFn: () => api!.reports.kpi() as Promise<KpiData>,
    enabled: live,
    refetchInterval: 60_000,
  });

  const data = kpiQuery.data;

  if (!live) {
    return (
      <div className="p-6">
        <div className="card max-w-xl text-sm text-fg-muted">
          Electron 환경에서 실행 시 실제 KPI를 확인할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-fg flex items-center gap-2">
          <BarChart3 size={20} /> 리포트 · KPI 대시보드
        </h1>
        <p className="text-sm text-fg-subtle mt-0.5">
          과제 · QA · CS · 근태 · 결재 전반의 운영 지표 요약 (1분 단위 자동 갱신).
        </p>
      </div>

      {kpiQuery.isLoading && (
        <div className="card text-sm text-fg-subtle">집계 중…</div>
      )}

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              label="진행 중 과제"
              value={data.assignmentsOpen}
              icon={<ClipboardList size={16} />}
              tone="border-blue-500/40"
              accent="text-blue-300"
            />
            <KpiCard
              label="이번 달 완료"
              value={data.completedThisMonth}
              icon={<CheckCircle2 size={16} />}
              tone="border-emerald-500/40"
              accent="text-emerald-300"
            />
            <KpiCard
              label="QA 반려율"
              value={`${(data.qaRejectRate * 100).toFixed(1)}%`}
              icon={<AlertTriangle size={16} />}
              tone="border-rose-500/40"
              accent={data.qaRejectRate > 0.1 ? 'text-rose-300' : 'text-fg'}
              trend={data.qaRejectRate > 0.1 ? 'down' : 'up'}
            />
            <KpiCard
              label="CS 미해결"
              value={data.csOpen}
              icon={<MessageSquare size={16} />}
              tone="border-amber-500/40"
              accent="text-amber-300"
            />
            <KpiCard
              label="CS 평균 소요"
              value={formatMinutes(data.csAvgMins)}
              icon={<Clock size={16} />}
              tone="border-violet-500/40"
              accent="text-violet-300"
            />
            <KpiCard
              label="이번 달 지각"
              value={data.attendanceLate}
              icon={<AlertTriangle size={16} />}
              tone="border-amber-500/40"
              accent="text-amber-300"
            />
            <KpiCard
              label="결재 대기"
              value={data.pendingApprovals}
              icon={<Stamp size={16} />}
              tone="border-teal-500/40"
              accent="text-teal-300"
            />
            <KpiCard
              label="일 평균 완료"
              value={averageDaily(data.daily).toFixed(1)}
              icon={<TrendingUp size={16} />}
              tone="border-emerald-500/40"
              accent="text-emerald-300"
            />
          </div>

          {/* Daily trend chart */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold flex items-center gap-1.5">
                <BarChart3 size={15} /> 일별 완료 추이 (최근 30일)
              </h2>
              <span className="text-xs text-fg-subtle">
                합계 {data.daily.reduce((a, b) => a + b.n, 0)}건
              </span>
            </div>
            <DailyChart daily={data.daily} />
          </div>

          {/* Narrative panel */}
          <div className="card">
            <h2 className="text-base font-semibold mb-2">요약</h2>
            <ul className="text-sm text-fg-muted space-y-1.5 list-disc pl-5">
              <li>
                현재 진행 중인 과제 <strong className="text-fg">{data.assignmentsOpen}</strong>건,
                이번 달 완료 <strong className="text-fg">{data.completedThisMonth}</strong>건.
              </li>
              <li>
                QA 반려율은{' '}
                <strong className={cn(data.qaRejectRate > 0.1 ? 'text-rose-300' : 'text-emerald-300')}>
                  {(data.qaRejectRate * 100).toFixed(1)}%
                </strong>{' '}
                로 {data.qaRejectRate > 0.1 ? '목표(10%) 초과' : '목표 이내'}.
              </li>
              <li>
                CS 미해결 <strong className="text-fg">{data.csOpen}</strong>건 (평균 소요{' '}
                <strong>{formatMinutes(data.csAvgMins)}</strong>).
              </li>
              <li>
                이번 달 지각 <strong className="text-fg">{data.attendanceLate}</strong>회,
                결재 대기 <strong className="text-fg">{data.pendingApprovals}</strong>건.
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  tone,
  accent,
  trend,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone: string;
  accent?: string;
  trend?: 'up' | 'down';
}) {
  return (
    <div className={cn('card border-l-2 px-4 py-3', tone)}>
      <div className={cn('flex items-center gap-1 text-xs', accent ?? 'text-fg-subtle')}>
        {icon} {label}
      </div>
      <div className="flex items-end justify-between mt-1">
        <div className={cn('text-2xl font-semibold tabular-nums', accent ?? 'text-fg')}>
          {value}
        </div>
        {trend === 'up' && <TrendingUp size={14} className="text-emerald-300 mb-1" />}
        {trend === 'down' && <TrendingDown size={14} className="text-rose-300 mb-1" />}
      </div>
    </div>
  );
}

function DailyChart({ daily }: { daily: Array<{ d: string; n: number }> }) {
  // Pad to 30 days: ensure we show up to 30 entries.
  const rows = daily.slice(-30);
  const max = Math.max(1, ...rows.map((r) => r.n));
  const W = 800;
  const H = 160;
  const padL = 32;
  const padB = 26;
  const padT = 10;
  const padR = 10;
  const cw = (W - padL - padR) / Math.max(1, rows.length);

  if (rows.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-sm text-fg-subtle">
        데이터 없음
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[600px] h-40">
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const y = padT + (H - padT - padB) * (1 - r);
          return (
            <line
              key={r}
              x1={padL}
              x2={W - padR}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-border"
              strokeDasharray="2,3"
              opacity={0.4}
            />
          );
        })}
        {/* Y labels */}
        {[0, 0.5, 1].map((r) => {
          const y = padT + (H - padT - padB) * (1 - r);
          return (
            <text
              key={r}
              x={4}
              y={y + 3}
              className="fill-current text-fg-subtle"
              fontSize="9"
            >
              {Math.round(max * r)}
            </text>
          );
        })}
        {/* Bars */}
        {rows.map((row, i) => {
          const h = (row.n / max) * (H - padT - padB);
          const x = padL + i * cw + cw * 0.15;
          const y = padT + (H - padT - padB) - h;
          const bw = cw * 0.7;
          return (
            <g key={row.d}>
              <rect
                x={x}
                y={y}
                width={bw}
                height={h}
                rx={1}
                className="fill-current text-accent"
                opacity={0.85}
              />
              <title>{`${row.d}: ${row.n}건`}</title>
            </g>
          );
        })}
        {/* X labels — thin */}
        {rows.map((row, i) => {
          if (i % Math.max(1, Math.floor(rows.length / 8)) !== 0) return null;
          const x = padL + i * cw + cw / 2;
          return (
            <text
              key={`l-${row.d}`}
              x={x}
              y={H - 8}
              textAnchor="middle"
              className="fill-current text-fg-subtle"
              fontSize="9"
            >
              {row.d.slice(5)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function formatMinutes(mins: number | null | undefined): string {
  if (!mins || !Number.isFinite(mins) || mins <= 0) return '-';
  if (mins < 60) return `${Math.round(mins)}분`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

function averageDaily(daily: Array<{ d: string; n: number }>): number {
  if (!daily.length) return 0;
  const total = daily.reduce((a, b) => a + b.n, 0);
  return total / daily.length;
}

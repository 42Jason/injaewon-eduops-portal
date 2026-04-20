import type { ComponentType } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileWarning,
  Megaphone,
  RotateCcw,
  Timer,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { useSession } from '@/stores/session';
import { getApi } from '@/hooks/useApi';

interface StatCard {
  key: string;
  label: string;
  value: string | number;
  hint?: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  tone?: 'default' | 'warn' | 'danger' | 'success';
}

function toneClasses(tone: StatCard['tone']) {
  switch (tone) {
    case 'warn':    return 'text-warn';
    case 'danger':  return 'text-danger';
    case 'success': return 'text-success';
    default:        return 'text-accent';
  }
}

function stateBadge(state: string) {
  const danger = ['자료누락', '반려', '1차QA반려', '최종QA반려'];
  const warn = ['1차QA대기', '최종QA대기', '수정요청', '보류'];
  const success = ['승인완료', '완료'];
  if (danger.some((s) => state.includes(s))) return 'bg-danger/15 text-danger';
  if (success.some((s) => state.includes(s))) return 'bg-success/15 text-success';
  if (warn.some((s) => state.includes(s))) return 'bg-warn/15 text-warn';
  return 'bg-accent-soft text-accent-strong';
}

interface AssignmentRow {
  id: number;
  code: string;
  title: string;
  state: string;
  due_at: string | null;
  risk: string;
  parser_name?: string | null;
  qa1_name?: string | null;
  qa_final_name?: string | null;
}

interface NoticeRow {
  id: number;
  title: string;
  author_name?: string | null;
  published_at: string;
}

function formatDue(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const tomorrow = new Date(midnight); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(midnight); dayAfter.setDate(dayAfter.getDate() + 2);
  const hhmm = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  if (d >= midnight && d < tomorrow)   return `오늘 ${hhmm}`;
  if (d >= tomorrow && d < dayAfter)   return `내일 ${hhmm}`;
  if (d < midnight)                    return `지연 (${d.toLocaleDateString('ko-KR')})`;
  return d.toLocaleDateString('ko-KR');
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 60) return `${Math.max(diffMin, 1)}분 전`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}시간 전`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

export function HomePage() {
  const { user } = useSession();
  const api = getApi();
  const live = !!api && !!user;

  const statsQuery = useQuery({
    queryKey: ['home.stats', user?.id],
    queryFn: () => api!.home.stats(user!.id),
    enabled: live,
  });

  const assignmentsQuery = useQuery({
    queryKey: ['home.assignments', user?.id],
    queryFn: () =>
      api!.assignments.list({ assignee: user!.id }) as Promise<AssignmentRow[]>,
    enabled: live,
  });

  const noticesQuery = useQuery({
    queryKey: ['home.notices'],
    queryFn: () => api!.notices.list() as Promise<NoticeRow[]>,
    enabled: live,
  });

  // Stat cards — pull from live DB when we can, otherwise show placeholder mock.
  const s = statsQuery.data;
  const statCards: StatCard[] = [
    { key: 'today',        label: '오늘 내 업무',     value: s?.todayMine ?? 6,       hint: '할당된 과제',    icon: ClipboardList },
    { key: 'dueToday',     label: '오늘 마감',        value: s?.dueToday ?? 2,        hint: '마감 D-0',        icon: Timer,        tone: (s?.dueToday ?? 0) > 0 ? 'warn' : 'default' },
    { key: 'atRisk',       label: '지연 위험',        value: s?.atRisk ?? 3,          hint: 'SLA 임박',        icon: AlertTriangle, tone: 'warn' },
    { key: 'rejected',     label: '반려됨',           value: s?.rejected ?? 1,        hint: 'QA 반려',         icon: FileWarning,   tone: 'danger' },
    { key: 'revision',     label: '수정 요청',        value: 2,                        hint: '최종 QA',         icon: RotateCcw },
    { key: 'awaitingApp',  label: '승인 대기',        value: s?.awaitingApp ?? 0,     hint: '내 결재선',       icon: CheckCircle2 },
    { key: 'unreadNotice', label: '읽지 않은 공지',   value: s?.unreadNotice ?? 3,    hint: '최근 7일',        icon: Megaphone },
    { key: 'unreadManual', label: '읽지 않은 매뉴얼', value: 5,                        hint: '신규/업데이트',   icon: BookOpen },
    { key: 'workHours',    label: '이번달 근무시간',  value: '84h',                    hint: '목표 168h',       icon: Clock },
    { key: 'leaveLeft',    label: '잔여 휴가',        value: '9.5',                    hint: '연차 15일 기준',  icon: Calendar,      tone: 'success' },
  ];

  const myWork: AssignmentRow[] =
    assignmentsQuery.data?.slice(0, 5) ?? [
      { id: 1, code: 'A-0241', title: '중3 물리 수행평가 — 관성의 법칙', state: '1차QA대기',    due_at: null, risk: 'high' },
      { id: 2, code: 'A-0245', title: '고1 국어 — 독서 포트폴리오',       state: '파싱진행중',   due_at: null, risk: 'medium' },
      { id: 3, code: 'A-0251', title: '중2 영어 — 자기소개 에세이',        state: '최종QA진행중', due_at: null, risk: 'low' },
      { id: 4, code: 'A-0260', title: '고2 수학 — 심화 탐구',              state: '파싱완료',     due_at: null, risk: 'low' },
      { id: 5, code: 'A-0262', title: '중1 사회 — 우리 지역 조사',          state: '자료누락',     due_at: null, risk: 'medium' },
    ];

  const notices: NoticeRow[] =
    noticesQuery.data?.slice(0, 3) ?? [
      { id: 1, title: '[전사] 5월 창립기념일 휴무 안내',        author_name: '최인사', published_at: new Date().toISOString() },
      { id: 2, title: '[파싱팀] Excel 템플릿 v3 배포',           author_name: '이기술', published_at: new Date().toISOString() },
      { id: 3, title: '[QA] 최종QA 체크리스트 v1.4',             author_name: '박운영', published_at: new Date().toISOString() },
    ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">
            안녕하세요, {user?.name ?? '직원'}님 👋
          </h1>
          <p className="text-sm text-fg-muted mt-0.5">
            {live
              ? '실시간 DB 연결됨 — 오늘 할 일을 먼저 확인해 주세요.'
              : '브라우저 프리뷰 모드 (Mock 데이터 표시 중)'}
          </p>
        </div>
        <div className="text-xs text-fg-subtle">
          {new Date().toLocaleDateString('ko-KR', {
            year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {statCards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.key} className="card">
              <div className="flex items-start justify-between">
                <div className="text-xs text-fg-muted">{c.label}</div>
                <Icon size={14} className={toneClasses(c.tone)} />
              </div>
              <div className="mt-2 text-2xl font-semibold text-fg">{c.value}</div>
              {c.hint && <div className="mt-1 text-[11px] text-fg-subtle">{c.hint}</div>}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-fg">내 업무</h2>
            <button className="text-xs text-accent hover:underline">전체 보기 →</button>
          </div>
          {myWork.length === 0 ? (
            <p className="py-6 text-center text-xs text-fg-subtle">할당된 업무가 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase text-fg-subtle">
                  <th className="py-1.5 font-medium">ID</th>
                  <th className="py-1.5 font-medium">과제명</th>
                  <th className="py-1.5 font-medium">상태</th>
                  <th className="py-1.5 font-medium text-right">마감</th>
                </tr>
              </thead>
              <tbody>
                {myWork.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="py-2 font-mono text-[11px] text-fg-muted">{t.code}</td>
                    <td className="py-2 text-fg">{t.title}</td>
                    <td className="py-2">
                      <span className={cn('chip', stateBadge(t.state))}>{t.state}</span>
                    </td>
                    <td className="py-2 text-right text-fg-muted text-xs">{formatDue(t.due_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-fg">공지</h2>
            <button className="text-xs text-accent hover:underline">더 보기</button>
          </div>
          {notices.length === 0 ? (
            <p className="py-4 text-center text-xs text-fg-subtle">공지가 없습니다.</p>
          ) : (
            <ul className="space-y-3">
              {notices.map((n) => (
                <li key={n.id} className="text-sm">
                  <div className="text-fg">{n.title}</div>
                  <div className="text-[11px] text-fg-subtle mt-0.5">
                    {n.author_name ?? '—'} · {relativeTime(n.published_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">팀 휴가 캘린더</h2>
            <button className="text-xs text-accent hover:underline">열기</button>
          </div>
          <ul className="space-y-2.5">
            <li className="flex items-center justify-between text-sm">
              <span className="text-fg-muted">4/22 (수)</span>
              <span className="text-fg text-xs">김대표, 정파싱</span>
            </li>
            <li className="flex items-center justify-between text-sm">
              <span className="text-fg-muted">4/24 (금)</span>
              <span className="text-fg text-xs">강QA1</span>
            </li>
            <li className="flex items-center justify-between text-sm">
              <span className="text-fg-muted">4/28 (화)</span>
              <span className="text-fg text-xs">최인사, 한직원</span>
            </li>
          </ul>
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">마감 임박</h2>
          </div>
          <ul className="space-y-2.5">
            {myWork.filter((w) => w.due_at).slice(0, 3).map((w) => (
              <li key={w.id} className="flex items-center justify-between text-sm">
                <span className="text-fg truncate pr-2">{w.title}</span>
                <span className="text-xs text-warn whitespace-nowrap">{formatDue(w.due_at)}</span>
              </li>
            ))}
            {myWork.filter((w) => w.due_at).length === 0 && (
              <li className="text-xs text-fg-subtle">임박한 마감이 없습니다.</li>
            )}
          </ul>
        </section>

        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">최근 매뉴얼</h2>
          </div>
          <ul className="space-y-2.5 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-fg truncate pr-2">파싱 SOP — 안내문 누락 대응</span>
              <span className="text-[11px] text-fg-subtle whitespace-nowrap">어제</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-fg truncate pr-2">1차 QA 체크리스트 (v1.3)</span>
              <span className="text-[11px] text-fg-subtle whitespace-nowrap">3일 전</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-fg truncate pr-2">휴가 신청 절차</span>
              <span className="text-[11px] text-fg-subtle whitespace-nowrap">1주 전</span>
            </li>
          </ul>
        </section>

        <section className="card lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">활동 로그</h2>
            <button className="text-xs text-accent hover:underline">감사 로그 →</button>
          </div>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-fg-subtle w-12">11:42</span>
              <span className="text-fg-muted w-20 text-xs">박운영</span>
              <span className="text-fg">과제 A-0241 담당자 배정 → 강QA1</span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-fg-subtle w-12">11:30</span>
              <span className="text-fg-muted w-20 text-xs">정파싱</span>
              <span className="text-fg">A-0245 파싱 초안 업로드</span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-fg-subtle w-12">10:55</span>
              <span className="text-fg-muted w-20 text-xs">윤최종</span>
              <span className="text-fg">A-0238 최종 승인</span>
            </li>
            <li className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-fg-subtle w-12">10:10</span>
              <span className="text-fg-muted w-20 text-xs">CTO자동화</span>
              <span className="text-fg">Excel 템플릿 검증: 2건 통과, 1건 반려</span>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

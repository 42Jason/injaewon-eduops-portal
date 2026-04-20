/**
 * Shared assignment-state / risk styling helpers.
 * Keep this renderer-only so we can tweak colours without touching the schema.
 */
import type { AssignmentState, Risk } from '@shared/types/assignment';

/** Compact pill colour per assignment state. */
export function stateChipClass(state: AssignmentState): string {
  // 신규 / 접수 계열 — 중립 회색
  if (state === '신규접수' || state === '자료누락') {
    return 'bg-bg-soft text-fg-muted border border-border';
  }
  // 파싱 계열 — 파랑
  if (state === '파싱대기' || state === '파싱진행중' || state === '파싱완료' || state === '파싱확인필요') {
    return 'bg-blue-500/15 text-blue-300 border border-blue-500/30';
  }
  // 1차 QA 계열 — 보라
  if (state === '1차QA대기' || state === '1차QA진행중') {
    return 'bg-violet-500/15 text-violet-300 border border-violet-500/30';
  }
  if (state === '1차QA반려') {
    return 'bg-rose-500/15 text-rose-300 border border-rose-500/30';
  }
  // 최종 QA 계열 — 티얼
  if (state === '최종QA대기' || state === '최종QA진행중') {
    return 'bg-teal-500/15 text-teal-300 border border-teal-500/30';
  }
  if (state === '최종QA반려') {
    return 'bg-rose-500/15 text-rose-300 border border-rose-500/30';
  }
  // 완료 계열 — 초록
  if (state === '승인완료' || state === '완료') {
    return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
  }
  if (state === '수정요청') {
    return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
  }
  if (state === '보류') {
    return 'bg-bg-soft text-fg-subtle border border-border';
  }
  return 'bg-bg-soft text-fg-muted border border-border';
}

export function riskLabel(risk: Risk): string {
  return risk === 'high' ? '높음' : risk === 'medium' ? '보통' : '낮음';
}

export function riskChipClass(risk: Risk): string {
  if (risk === 'high')   return 'bg-rose-500/15   text-rose-300   border border-rose-500/30';
  if (risk === 'medium') return 'bg-amber-500/15  text-amber-300  border border-amber-500/30';
  return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
}

/** Format a due-at ISO string into a short Korean label. */
export function formatDueLabel(iso: string | null): { label: string; tone: 'danger' | 'warning' | 'ok' | 'muted' } {
  if (!iso) return { label: '-', tone: 'muted' };
  const due = new Date(iso);
  const now = new Date();
  const diffMs = due.getTime() - now.getTime();
  const diffDay = Math.ceil(diffMs / 86400000);
  if (diffDay < 0)   return { label: `${Math.abs(diffDay)}일 지연`, tone: 'danger' };
  if (diffDay === 0) return { label: '오늘', tone: 'warning' };
  if (diffDay === 1) return { label: '내일', tone: 'warning' };
  if (diffDay <= 3)  return { label: `D-${diffDay}`, tone: 'warning' };
  return { label: `D-${diffDay}`, tone: 'ok' };
}

/** 16 단계 중 대략적 진행률 (0-100). */
export function stateProgress(state: AssignmentState): number {
  const order: AssignmentState[] = [
    '신규접수', '자료누락', '파싱대기', '파싱진행중', '파싱완료', '파싱확인필요',
    '1차QA대기', '1차QA진행중', '1차QA반려', '최종QA대기', '최종QA진행중', '최종QA반려',
    '승인완료', '수정요청', '완료', '보류',
  ];
  const idx = order.indexOf(state);
  if (state === '완료' || state === '승인완료') return 100;
  if (state === '보류') return 40;
  if (idx < 0) return 0;
  return Math.round((idx / (order.length - 2)) * 100);
}

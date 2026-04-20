import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

/**
 * Shared "nothing here yet" panel. Mirrors the tone already used on
 * WorkLogsPage: round icon chip + short Korean description + optional action.
 *
 *   <EmptyState
 *     icon={NotebookPen}
 *     title="이 기간에 작성된 업무 일지가 없습니다"
 *     hint="위 입력창에 한 줄만 적어도 저장됩니다."
 *     action={<button className="btn-primary">새로 작성</button>}
 *   />
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  action,
  className,
  tone = 'neutral',
}: {
  icon?: LucideIcon;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: 'neutral' | 'error';
}) {
  const isErr = tone === 'error';
  return (
    <div
      className={cn('card flex flex-col items-center py-10 text-center', className)}
      role={isErr ? 'alert' : 'status'}
    >
      <div
        className={cn(
          'mb-2 grid h-10 w-10 place-items-center rounded-full',
          isErr ? 'bg-danger/10 text-danger' : 'bg-bg-soft text-fg-subtle',
        )}
      >
        <Icon size={18} />
      </div>
      <p className={cn('text-sm', isErr ? 'text-danger' : 'text-fg-muted')}>{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-fg-subtle">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

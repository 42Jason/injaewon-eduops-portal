import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Small indeterminate spinner. Defaults to currentColor so it inherits the
 * surrounding text color — drop it inside a button label without styling.
 *
 *   <button className="btn-primary" disabled={mut.isPending}>
 *     {mut.isPending && <Spinner size={12} />} 저장
 *   </button>
 */
export function Spinner({
  size = 14,
  className,
  label,
}: {
  size?: number;
  className?: string;
  /** Screen-reader label. Set explicitly when the spinner isn't adjacent to visible text. */
  label?: string;
}) {
  return (
    <Loader2
      size={size}
      className={cn('animate-spin', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/**
 * Full-panel loading fallback for data-heavy pages.
 * Centers a spinner with an optional Korean caption.
 */
export function LoadingPanel({
  label = '불러오는 중…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-[120px] flex-col items-center justify-center gap-2 text-xs text-fg-subtle',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Spinner size={18} />
      <span>{label}</span>
    </div>
  );
}

import { cn } from '@/lib/cn';

/**
 * Placeholder block with a subtle pulse animation. Use while a page's primary
 * data is loading — feels faster than an indeterminate spinner for known-shape
 * lists and cards.
 *
 *   <Skeleton className="h-4 w-24" />
 *   <SkeletonTable rows={6} cols={5} />
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-bg-soft/80', className)}
    />
  );
}

/** N lines of varying widths — useful for a card's body copy while loading. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-3',
            i === lines - 1 ? 'w-1/2' : i % 2 ? 'w-5/6' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}

/** Placeholder table rows matching the final table's column count. */
export function SkeletonTable({
  rows = 5,
  cols = 4,
  className,
}: {
  rows?: number;
  cols?: number;
  className?: string;
}) {
  return (
    <div className={cn('divide-y divide-border', className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex gap-3 px-3 py-2.5">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton
              key={c}
              className={cn(
                'h-3.5 flex-1',
                c === 0 && 'max-w-[140px]',
                c === cols - 1 && 'max-w-[80px]',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Generic card skeleton — one title line + a few body lines. */
export function SkeletonCard({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('card space-y-2', className)} aria-hidden="true">
      <Skeleton className="h-4 w-1/3" />
      <SkeletonText lines={lines} />
    </div>
  );
}

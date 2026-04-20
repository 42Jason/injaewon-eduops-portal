import { CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useToastStore } from '@/stores/toast';
import type { ToastItem } from '@/stores/toast';

function iconFor(kind: ToastItem['kind']) {
  if (kind === 'ok') return <CheckCircle2 size={14} />;
  if (kind === 'err') return <AlertTriangle size={14} />;
  return <Info size={14} />;
}

function styleFor(kind: ToastItem['kind']) {
  if (kind === 'ok') return 'bg-success/15 text-success border-success/30';
  if (kind === 'err') return 'bg-danger/15 text-danger border-danger/30';
  return 'bg-accent-soft text-accent-strong border-accent/30';
}

/**
 * Pinned to the bottom-right. Stacks vertically. Each toast auto-dismisses
 * per its ttl; user can also click the X.
 */
export function ToastStack() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'err' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex max-w-sm items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-lg shadow-black/20 animate-[fadeIn_0.15s_ease-out]',
            styleFor(t.kind),
          )}
        >
          <span className="mt-0.5 shrink-0">{iconFor(t.kind)}</span>
          <span className="flex-1 whitespace-pre-wrap leading-relaxed">{t.msg}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded p-0.5 text-current opacity-60 hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-current"
            aria-label="닫기"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

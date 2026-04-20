import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Accessible modal dialog with:
 *   - ESC to close (unless `closeOnEsc={false}`)
 *   - click-outside to close (unless `closeOnBackdrop={false}`)
 *   - initial focus on the first focusable element inside the panel
 *   - focus trap (Tab / Shift-Tab cycle inside the panel)
 *   - body scroll lock while open
 *   - aria-modal + labelled-by wiring
 *
 * The visual design intentionally mirrors the ad-hoc modal already used on
 * AnnouncementsPage so retrofits stay low-risk.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  closeOnEsc = true,
  closeOnBackdrop = true,
  hideCloseButton = false,
  className,
  /** ARIA role override — use 'alertdialog' for destructive confirms. */
  role = 'dialog',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  closeOnEsc?: boolean;
  closeOnBackdrop?: boolean;
  hideCloseButton?: boolean;
  className?: string;
  role?: 'dialog' | 'alertdialog';
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  // Body scroll lock + focus management
  useEffect(() => {
    if (!open) return;
    lastActiveRef.current = (document.activeElement as HTMLElement) ?? null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first focusable inside the panel (after the browser paints).
    const raf = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(
        'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? panel).focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      // Restore focus to whatever opened us.
      lastActiveRef.current?.focus?.();
    };
  }, [open]);

  // Keyboard: ESC + focus trap
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && closeOnEsc) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('data-focus-guard'));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, closeOnEsc, onClose]);

  if (!open) return null;

  const sizeClass =
    size === 'sm' ? 'max-w-sm' :
    size === 'md' ? 'max-w-lg' :
    size === 'lg' ? 'max-w-2xl' :
    'max-w-4xl';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-[fadeIn_0.12s_ease-out]"
      onMouseDown={(e) => {
        // Only close when the backdrop itself was the mousedown target — so
        // dragging a text selection out of the panel doesn't dismiss the modal.
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'w-full rounded-lg border border-border bg-bg-card shadow-xl outline-none',
          'max-h-[90vh] overflow-y-auto',
          sizeClass,
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {!hideCloseButton && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-fg-subtle hover:bg-bg-soft hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="닫기"
            >
              <X size={16} />
            </button>
          )}
        </div>
        <div className="px-5 py-4 text-sm text-fg">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-bg-soft/30 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, HelpCircle, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';

export type ConfirmTone = 'default' | 'danger' | 'warn';

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  /** Optional async action to run on confirm; dialog stays open (with spinner) until it resolves. */
  onConfirm?: () => void | Promise<void>;
  /** If true, ESC / backdrop cannot dismiss — forces explicit cancel. */
  requireAction?: boolean;
}

type OpenState = (ConfirmOptions & {
  resolve: (ok: boolean) => void;
}) | null;

interface ConfirmCtx {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const Ctx = createContext<ConfirmCtx | null>(null);

/**
 * Provides imperative confirm() to the app tree. Mount once near the root
 * (see AppLayout). Pages call:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: '삭제할까요?', tone: 'danger' })) { ... }
 *
 * This replaces `window.confirm(...)` which doesn't match the app theme and
 * can't run async side-effects while blocking.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState>(null);
  const [busy, setBusy] = useState(false);
  // Keep latest reject fn in a ref so we can cancel hanging dialogs on unmount.
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setState({ ...opts, resolve });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setState(null);
    setBusy(false);
    resolver?.(ok);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!state) return;
    if (state.onConfirm) {
      try {
        setBusy(true);
        await state.onConfirm();
        close(true);
      } catch {
        // Caller's onConfirm is responsible for its own error UX (toast, etc).
        // We still resolve `false` so the awaiting caller knows it didn't commit.
        close(false);
      }
    } else {
      close(true);
    }
  }, [state, close]);

  const ctxValue = useMemo<ConfirmCtx>(() => ({ confirm }), [confirm]);

  const open = state !== null;
  const tone: ConfirmTone = state?.tone ?? 'default';
  const Icon = tone === 'danger' ? Trash2 : tone === 'warn' ? AlertTriangle : HelpCircle;

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      <Modal
        open={open}
        onClose={() => !busy && !state?.requireAction && close(false)}
        title={
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'grid h-6 w-6 place-items-center rounded-full',
                tone === 'danger' && 'bg-danger/15 text-danger',
                tone === 'warn' && 'bg-warn/15 text-warn',
                tone === 'default' && 'bg-accent-soft text-accent-strong',
              )}
            >
              <Icon size={13} />
            </span>
            <span>{state?.title}</span>
          </span>
        }
        size="sm"
        role="alertdialog"
        closeOnEsc={!state?.requireAction && !busy}
        closeOnBackdrop={!state?.requireAction && !busy}
        hideCloseButton={busy}
        footer={
          <>
            <button
              type="button"
              onClick={() => close(false)}
              disabled={busy}
              className="btn-ghost text-sm"
            >
              {state?.cancelLabel ?? '취소'}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy}
              autoFocus
              className={cn(
                'btn text-sm font-medium',
                tone === 'danger'
                  ? 'bg-danger text-white hover:bg-danger/90'
                  : tone === 'warn'
                    ? 'bg-warn text-white hover:bg-warn/90'
                    : 'bg-accent text-white hover:bg-accent-strong',
              )}
            >
              {busy && <Spinner size={12} />}
              {state?.confirmLabel ?? (tone === 'danger' ? '삭제' : '확인')}
            </button>
          </>
        }
      >
        {state?.description && (
          <div className="text-sm leading-relaxed text-fg-muted">{state.description}</div>
        )}
      </Modal>
    </Ctx.Provider>
  );
}

/**
 * Hook form. Throws outside of <ConfirmProvider> so misuse fails loudly.
 * Always returns the same function reference.
 */
export function useConfirm(): ConfirmCtx['confirm'] {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>');
  }
  return ctx.confirm;
}

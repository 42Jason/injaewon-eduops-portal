import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/stores/toast';

/**
 * Thin wrapper around `useMutation` that wires up the three things every
 * page was re-implementing:
 *
 *   1. A success toast (default: "저장되었습니다").
 *   2. A failure toast that reads `error.message` — or the `{ ok, error }`
 *      shape the Electron IPC uses — so a thrown error OR a `{ ok:false }`
 *      response both produce the same red toast.
 *   3. Optional automatic `invalidateQueries` on success, so list caches
 *      refresh without every caller repeating the same 3-line boilerplate.
 *
 * Example:
 *
 *   const save = useMutationWithToast({
 *     mutationFn: (v: FormValues) => api!.notices.create(v),
 *     successMessage: '공지가 게시되었습니다',
 *     errorMessage: '공지 게시에 실패했습니다',
 *     invalidates: [['notices.list']],
 *     onSuccess: () => closeModal(),
 *   });
 *   save.mutate(values);
 */
export type TypedIpcResult = { ok: boolean; error?: string };

export interface UseMutationWithToastOptions<TData, TError, TVars, TCtx>
  extends Omit<UseMutationOptions<TData, TError, TVars, TCtx>, 'onSuccess' | 'onError'> {
  /** Toast shown on success. Pass `false` to suppress. Defaults to a generic "저장되었습니다". */
  successMessage?: string | false;
  /**
   * Toast shown on failure. If omitted, falls back to the thrown error's
   * `.message`, the IPC response's `.error`, or "오류가 발생했습니다".
   * Pass `false` to suppress the toast entirely (caller handles it).
   */
  errorMessage?: string | false;
  /**
   * Query keys to `invalidateQueries` after a successful mutation.
   * Shorthand for the most common onSuccess body across the codebase.
   */
  invalidates?: Array<readonly unknown[]>;
  /** Called after toasts + invalidations. Receives the resolved data. */
  onSuccess?: (data: TData, vars: TVars, ctx: TCtx | undefined) => void;
  /** Called after the error toast. */
  onError?: (err: TError, vars: TVars, ctx: TCtx | undefined) => void;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'error' in err) {
    const v = (err as { error?: unknown }).error;
    if (typeof v === 'string' && v) return v;
  }
  return fallback;
}

function isOkFalse(data: unknown): data is TypedIpcResult & { ok: false } {
  return (
    !!data &&
    typeof data === 'object' &&
    'ok' in data &&
    (data as TypedIpcResult).ok === false
  );
}

export function useMutationWithToast<
  TData = unknown,
  TError = Error,
  TVars = void,
  TCtx = unknown,
>(options: UseMutationWithToastOptions<TData, TError, TVars, TCtx>) {
  const toast = useToast();
  const qc = useQueryClient();
  const {
    successMessage = '저장되었습니다',
    errorMessage,
    invalidates,
    onSuccess,
    onError,
    ...rest
  } = options;

  return useMutation<TData, TError, TVars, TCtx>({
    ...rest,
    onSuccess: (data, vars, ctx) => {
      // Treat `{ ok: false, error: '...' }` as an error even though it resolved.
      // Many Electron IPC handlers return this instead of throwing.
      if (isOkFalse(data)) {
        const msg = errorMessage !== false
          ? (errorMessage || data.error || '오류가 발생했습니다')
          : null;
        if (msg) toast.err(msg);
        onError?.(data as unknown as TError, vars, ctx);
        return;
      }
      if (successMessage !== false) {
        toast.ok(successMessage);
      }
      if (invalidates?.length) {
        for (const key of invalidates) {
          qc.invalidateQueries({ queryKey: key as unknown[] });
        }
      }
      onSuccess?.(data, vars, ctx);
    },
    onError: (err, vars, ctx) => {
      if (errorMessage !== false) {
        toast.err(extractErrorMessage(err, errorMessage || '오류가 발생했습니다'));
      }
      onError?.(err, vars, ctx);
    },
  });
}

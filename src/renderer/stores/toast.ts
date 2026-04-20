import { create } from 'zustand';

export type ToastKind = 'ok' | 'err' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  msg: string;
  /** ms until auto-dismiss; 0 = stay until user closes */
  ttl: number;
}

interface ToastState {
  items: ToastItem[];
  push: (kind: ToastKind, msg: string, ttl?: number) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let seq = 1;

/**
 * Tiny global toast store. Pages/components call `useToast().ok('...')` etc.
 * Renders live in AppLayout via <ToastStack />.
 */
export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (kind, msg, ttl = 3500) => {
    const id = seq++;
    set((s) => ({ items: [...s.items, { id, kind, msg, ttl }] }));
    if (ttl > 0) {
      setTimeout(() => get().dismiss(id), ttl);
    }
    return id;
  },
  dismiss: (id) => {
    set((s) => ({ items: s.items.filter((t) => t.id !== id) }));
  },
  clear: () => set({ items: [] }),
}));

/**
 * Convenience hook — stable reference, call from anywhere.
 *   const toast = useToast();
 *   toast.ok('저장되었습니다');
 *   toast.err('실패: 네트워크 오류');
 */
export function useToast() {
  const push = useToastStore((s) => s.push);
  return {
    ok: (msg: string, ttl?: number) => push('ok', msg, ttl),
    err: (msg: string, ttl?: number) => push('err', msg, ttl ?? 5000),
    info: (msg: string, ttl?: number) => push('info', msg, ttl),
  };
}

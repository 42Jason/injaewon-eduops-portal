import { Construction } from 'lucide-react';

export function Placeholder({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center">
      <Construction size={32} className="text-fg-subtle mb-3" />
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      <p className="mt-1 max-w-md text-center text-sm text-fg-muted">
        {subtitle ?? '해당 모듈은 후속 세션에서 구현됩니다. Phase 0 에서는 뼈대만 준비되어 있습니다.'}
      </p>
    </div>
  );
}

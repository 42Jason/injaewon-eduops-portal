import { useState } from 'react';
import { Bell, Coffee, LogIn, LogOut, Search } from 'lucide-react';
import { cn } from '@/lib/cn';

type AttendanceState = 'off' | 'working' | 'break';

export function TopBar() {
  const [state, setState] = useState<AttendanceState>('off');
  const [since, setSince] = useState<string | null>(null);

  function mark(next: AttendanceState) {
    setState(next);
    setSince(next === 'off' ? null : new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-bg-card px-4">
      <div className="flex items-center gap-2 max-w-md flex-1">
        <div className="relative w-full">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            placeholder="과제, 학생, 공지, 매뉴얼 검색..."
            className="input pl-8 h-9"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-1 text-xs text-fg-muted mr-2">
          {since && (
            <span>
              <span
                className={cn(
                  'inline-block h-2 w-2 rounded-full mr-1.5',
                  state === 'working' && 'bg-success',
                  state === 'break' && 'bg-warn',
                )}
              />
              {state === 'working' ? '근무 중' : '휴게 중'} · {since} 부터
            </span>
          )}
        </div>

        <button
          onClick={() => mark('working')}
          disabled={state === 'working'}
          className={cn(
            'btn h-9',
            state === 'working'
              ? 'bg-success/20 text-success border border-success/30'
              : 'btn-outline',
          )}
        >
          <LogIn size={14} /> 출근
        </button>
        <button
          onClick={() => mark('break')}
          disabled={state === 'off'}
          className={cn(
            'btn h-9',
            state === 'break'
              ? 'bg-warn/20 text-warn border border-warn/30'
              : 'btn-outline',
          )}
        >
          <Coffee size={14} /> 휴게
        </button>
        <button
          onClick={() => mark('off')}
          disabled={state === 'off'}
          className="btn-outline h-9"
        >
          <LogOut size={14} /> 퇴근
        </button>

        <button className="btn-ghost h-9 w-9 p-0 relative ml-2" title="알림">
          <Bell size={16} />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-danger" />
        </button>
      </div>
    </header>
  );
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

// Default to dark theme — feels right for an ops/console tool.
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark');
}

// 렌더러 최후 방어선. ErrorBoundary 가 잡지 못하는 비동기 에러(예: setTimeout
// 안의 throw, 이벤트 핸들러 바깥의 Promise rejection) 를 콘솔에 남긴다. 프로덕션
// 빌드는 DevTools 가 비활성화되어 있어 이 로그는 보이지 않지만, 최소한 uncaught
// 로 렌더러 프로세스가 죽는 것은 막아 메인 프로세스의 `render-process-gone` 쪽
// 로그와 상관시켜 원인을 잡을 수 있다.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => {
    // eslint-disable-next-line no-console
    console.error('[renderer] window.onerror:', ev.error ?? ev.message, ev);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    // eslint-disable-next-line no-console
    console.error('[renderer] unhandledrejection:', ev.reason);
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <HashRouter>
          <App />
        </HashRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

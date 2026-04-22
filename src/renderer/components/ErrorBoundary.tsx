import React from 'react';

/**
 * 렌더러 최상단 방어선. React 트리 안 어디서 throw 가 발생해도 흰 화면 대신
 * 오류 메시지와 새로고침 버튼을 보여준다.
 *
 * v0.1.12 에서 `ParsingCenterPage` 의 Rule of Hooks 위반으로 렌더러가 죽은 것이
 * 확인되면서 추가 — 앞으로 이런 종류의 크래시가 생겨도 사용자는 "창이 1초 뒤에
 * 닫힌 듯 보인다" 대신 뭐가 터졌는지 읽을 수 있다.
 */
type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
  info: React.ErrorInfo | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // DevTools 가 열려있으면 여기서 스택을 볼 수 있다. 프로덕션 빌드에서는
    // DevTools 가 비활성화되어 있으므로 화면 상의 fallback UI 에서 확인한다.
    // eslint-disable-next-line no-console
    console.error('[renderer] ErrorBoundary caught:', error, info);
    this.setState({ info });
  }

  private handleReload = () => {
    try {
      window.location.reload();
    } catch {
      /* noop */
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const stack = this.state.error.stack ?? String(this.state.error);
    const componentStack = this.state.info?.componentStack ?? '';

    return (
      <div className="min-h-screen bg-bg text-fg p-8 overflow-auto">
        <div className="mx-auto max-w-3xl space-y-4">
          <div>
            <h1 className="text-xl font-semibold">화면 렌더링 중 오류가 발생했습니다</h1>
            <p className="mt-1 text-sm text-fg-subtle">
              아래 내용을 캡처해 개발팀에 전달하면 원인 분석에 큰 도움이 됩니다.
            </p>
          </div>

          <div className="space-y-2">
            <div className="rounded border border-border bg-bg-card p-3 text-sm">
              <div className="font-medium text-fg">{this.state.error.name}: {this.state.error.message}</div>
            </div>

            <details className="rounded border border-border bg-bg-card p-3 text-xs" open>
              <summary className="cursor-pointer text-fg-subtle">스택 추적</summary>
              <pre className="mt-2 whitespace-pre-wrap break-all text-fg-subtle">{stack}</pre>
            </details>

            {componentStack && (
              <details className="rounded border border-border bg-bg-card p-3 text-xs">
                <summary className="cursor-pointer text-fg-subtle">컴포넌트 스택</summary>
                <pre className="mt-2 whitespace-pre-wrap break-all text-fg-subtle">{componentStack}</pre>
              </details>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null, info: null })}
              className="rounded border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg-card"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }
}

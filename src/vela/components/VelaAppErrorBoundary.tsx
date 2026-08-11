import { Component, type ErrorInfo, type ReactNode } from 'react';

interface VelaAppErrorBoundaryProps {
  children: ReactNode;
}

interface VelaAppErrorBoundaryState {
  error: Error | null;
}

export class VelaAppErrorBoundary extends Component<VelaAppErrorBoundaryProps, VelaAppErrorBoundaryState> {
  state: VelaAppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): VelaAppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Vela] 页面渲染失败', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="vela-fatal-error" role="alert">
        <div className="vela-fatal-error__card">
          <span>页面遇到异常</span>
          <h1>界面加载失败</h1>
          <p>{this.state.error.message || '页面数据不完整，请重新加载。'}</p>
          <button type="button" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </main>
    );
  }
}

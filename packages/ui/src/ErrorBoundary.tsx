/**
 * React error boundary — catches render/lifecycle throws in the subtree and
 * shows the shared fatal-error screen instead of a white popup (resilience.md
 * §1). Reuses the pure-DOM `renderErrorScreen` so the fallback markup lives in
 * exactly one place and does not depend on the (crashed) app tree.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { renderErrorScreen, type ErrorScreenOptions } from './errscreen.js';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Fatal-error screen copy (English fallback strings — see errscreen.ts). */
  screen: Omit<ErrorScreenOptions, 'onRetry'>;
  /** Report each caught error (e.g. to the local errlog ring buffer). */
  onError?: (error: unknown, componentStack: string) => void;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      this.props.onError?.(error, info.componentStack ?? '');
    } catch {
      /* logging must never re-throw out of the boundary */
    }
  }

  private readonly mountFallback = (el: HTMLDivElement | null): void => {
    if (!el) return;
    renderErrorScreen(el, {
      ...this.props.screen,
      // Retry clears the failed state so React re-renders the subtree; a full
      // reload is the caller's responsibility if they wire onRetry differently.
      onRetry: () => this.setState({ failed: false }),
    });
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return <div ref={this.mountFallback} style={{ minHeight: '100%' }} />;
    }
    return this.props.children;
  }
}

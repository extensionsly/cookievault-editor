/**
 * Shared UI-entrypoint bootstrap with white-screen prevention (resilience.md
 * §1). Every popup/options/onboarding `main.tsx` goes through here so the
 * three failure modes are all covered in one place:
 *
 *   1. bootstrap throws (initTheme / initI18n / createRoot) → pure-DOM screen
 *   2. React render throws                                  → ErrorBoundary
 *   3. uncaught error / rejection outside React             → logged; and if
 *      the app never mounted, the pure-DOM screen (never clobbers a live UI)
 *
 * The fatal screen copy is English-only by design — it must render even when
 * i18n bootstrap itself failed (see errscreen.ts).
 */
import { StrictMode, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary.js';
import { renderErrorScreen, type ErrorScreenOptions } from './errscreen.js';

export interface MountOptions {
  /** `id` of the mount element (e.g. "root"). */
  rootId: string;
  /** The app element to render inside the error boundary. */
  app: ReactElement;
  /** Async pre-render step (initI18n, etc). Run inside try/catch. */
  prepare?: () => Promise<void> | void;
  /**
   * Report an error to a durable, offline sink (the app's errlog). Called for
   * bootstrap failures, boundary catches, and global errors. Must not throw.
   */
  onError?: (error: unknown, context: string) => void;
  /** Fatal-error screen copy (English fallback strings). */
  screen: Omit<ErrorScreenOptions, 'onRetry'>;
}

const DEFAULT_SCREEN: Omit<ErrorScreenOptions, 'onRetry' | 'reportHref'> = {
  title: 'Something went wrong',
  body: 'This view failed to load. Reloading usually fixes it. Your saved data is safe.',
  retryLabel: 'Reload',
  reportLabel: 'Report a problem',
};

function report(onError: MountOptions['onError'], error: unknown, context: string): void {
  try {
    onError?.(error, context);
  } catch {
    /* the logger failing must never escalate the original failure */
  }
}

export async function mountApp(opts: MountOptions): Promise<void> {
  const screen: Omit<ErrorScreenOptions, 'onRetry'> = { ...DEFAULT_SCREEN, ...opts.screen };
  const rootEl = document.getElementById(opts.rootId);

  let mounted = false;

  // Global safety net. Primary job is logging; it only paints the fatal screen
  // when the app never mounted, so a benign late rejection can't wipe a working
  // popup.
  const onGlobalError = (err: unknown, context: string): void => {
    report(opts.onError, err, context);
    if (!mounted && rootEl) {
      renderErrorScreen(rootEl, { ...screen, onRetry: () => location.reload() });
    }
  };
  window.addEventListener('error', (e) => onGlobalError(e.error ?? e.message, 'window.error'));
  window.addEventListener('unhandledrejection', (e) =>
    onGlobalError(e.reason, 'unhandledrejection'),
  );

  try {
    if (!rootEl) throw new Error(`mountApp: #${opts.rootId} not found`);
    await opts.prepare?.();
    createRoot(rootEl).render(
      <StrictMode>
        <ErrorBoundary screen={screen} onError={(err, stack) => report(opts.onError, err, stack)}>
          {opts.app}
        </ErrorBoundary>
      </StrictMode>,
    );
    mounted = true;
  } catch (err) {
    report(opts.onError, err, 'bootstrap');
    if (rootEl) renderErrorScreen(rootEl, { ...screen, onRetry: () => location.reload() });
  }
}

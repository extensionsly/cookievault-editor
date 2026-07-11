/**
 * Last-resort fatal-error screen — pure DOM, zero dependencies.
 *
 * Per the resilience standard (resilience.md §1): the error state must NOT
 * depend on possibly-crashed app state — no React, no i18n runtime, no
 * tokens.css (which may have failed to load). Everything here is inline so
 * it renders even when the rest of the world is on fire. Copy is English-only
 * on purpose: this is the fallback shown when even i18n bootstrap may have
 * thrown, so it cannot route through the (possibly broken) locale layer.
 *
 * Recoverable, in-flow errors stay in the app's own i18n'd toasts/banners;
 * this is only for white-screen prevention (README red line 17).
 */

export interface ErrorScreenOptions {
  /** Short heading, e.g. "Something went wrong". */
  title: string;
  /** One or two sentences telling the user what they can do. */
  body: string;
  /** Retry button label; button hidden when onRetry is omitted. */
  retryLabel?: string;
  /** Called when the user clicks Retry (e.g. `() => location.reload()`). */
  onRetry?: () => void;
  /** "Report a problem" link label; link hidden when reportHref is omitted. */
  reportLabel?: string;
  /** Absolute URL for the report link (opens in a new tab). */
  reportHref?: string;
}

/**
 * Replace the contents of `el` with a centered error card. Idempotent:
 * calling it again fully re-renders. Safe to call from a global error
 * handler or a React error boundary's fallback.
 */
export function renderErrorScreen(el: HTMLElement, opts: ErrorScreenOptions): void {
  // Detect dark mode without touching app state; fall back to light.
  let dark = false;
  try {
    dark =
      document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') &&
        window.matchMedia?.('(prefers-color-scheme: dark)').matches) ||
      false;
  } catch {
    dark = false;
  }
  const c = dark
    ? {
        bg: '#101118',
        card: '#181922',
        fg: '#f1f1f5',
        fg2: '#b6b7be',
        line: '#2b2c38',
        accent: '#8ab4ff',
      }
    : {
        bg: '#ffffff',
        card: '#f6f6fa',
        fg: '#20212b',
        fg2: '#53555e',
        line: '#e4e4ee',
        accent: '#2f6fed',
      };

  el.textContent = '';
  el.setAttribute('role', 'alert');

  const wrap = document.createElement('div');
  wrap.style.cssText = `min-height:100%;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:${c.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;`;

  const card = document.createElement('div');
  card.style.cssText = `max-width:340px;width:100%;background:${c.card};border:1px solid ${c.line};border-radius:12px;padding:20px;text-align:center;`;

  const h = document.createElement('div');
  h.textContent = opts.title;
  h.style.cssText = `font-size:15px;font-weight:600;color:${c.fg};margin:0 0 8px;`;

  const p = document.createElement('div');
  p.textContent = opts.body;
  p.style.cssText = `font-size:13px;line-height:1.6;color:${c.fg2};margin:0 0 16px;`;

  card.append(h, p);

  if (opts.retryLabel && opts.onRetry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = opts.retryLabel;
    btn.style.cssText = `appearance:none;border:0;border-radius:8px;background:${c.accent};color:#fff;font-size:13px;font-weight:600;padding:8px 16px;cursor:pointer;margin:0 0 12px;`;
    btn.addEventListener('click', () => {
      try {
        opts.onRetry?.();
      } catch {
        /* retry itself failing must not throw out of the handler */
      }
    });
    card.append(btn);
  }

  if (opts.reportLabel && opts.reportHref) {
    const line = document.createElement('div');
    const a = document.createElement('a');
    a.href = opts.reportHref;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = opts.reportLabel;
    a.style.cssText = `font-size:12px;color:${c.accent};text-decoration:none;`;
    line.append(a);
    card.append(line);
  }

  wrap.append(card);
  el.append(wrap);
}

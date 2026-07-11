/**
 * Manual light/dark theme support for the extension UIs.
 *
 * The popup/options pages render light by default (`:root` tokens in
 * theme.css) and dark when the root element carries `data-theme="dark"`.
 * `initTheme()` resolves the effective theme — a persisted user choice if one
 * exists, otherwise the OS preference — and applies it before React renders so
 * there's no flash. `toggleTheme()` flips and persists the choice.
 *
 * The choice is stored in localStorage (a non-sensitive UI preference), which
 * is synchronous, so the applied theme is correct on first paint. It is scoped
 * per extension origin and shared between that extension's popup and options
 * pages.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'cv-theme';

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

/** The OS-level preference, defaulting to light when unavailable. */
export function systemTheme(): Theme {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Effective theme: the persisted choice if any, otherwise the OS preference. */
export function currentTheme(): Theme {
  return readStored() ?? systemTheme();
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/** Apply the effective theme to the document. Call before the first render. */
export function initTheme(): Theme {
  const theme = currentTheme();
  applyTheme(theme);
  return theme;
}

/** Flip light↔dark, persist the choice, apply it, and return the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore — theme just won't persist */
  }
  applyTheme(next);
  return next;
}

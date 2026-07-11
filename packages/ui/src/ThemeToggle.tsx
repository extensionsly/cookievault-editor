import { useState } from 'react';
import { currentTheme, toggleTheme, type Theme } from './theme.js';

/**
 * Header icon button that flips the popup between light and dark. Shows a moon
 * in light mode (click → dark) and a sun in dark mode (click → light), matching
 * the design. Self-contained styling (inline) so it drops into either
 * extension's header without extra CSS; colors come from the shared `--muted`
 * token. Pass a localized `label` for the accessible name.
 */
export function ThemeToggle({ label }: { label: string }) {
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setTheme(toggleTheme())}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        padding: 4,
        background: 'none',
        border: 'none',
        color: 'var(--muted)',
        cursor: 'pointer',
      }}
    >
      {theme === 'dark' ? (
        // Sun — currently dark, click to go light.
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // Moon — currently light, click to go dark.
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      )}
    </button>
  );
}

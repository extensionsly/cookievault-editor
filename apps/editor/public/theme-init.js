/*
 * Synchronous theme bootstrap — runs before first paint to kill the
 * dark-mode flash (audit F12). Loaded as a classic <script> in <head>, so
 * it blocks parsing (unlike the deferred module that renders React).
 *
 * A separate same-origin file rather than an inline <script>: the MV3
 * extension CSP is `script-src 'self'`, which forbids inline script. Keep
 * this in sync with packages/ui/src/theme.ts (STORAGE_KEY = 'cv-theme').
 */
(function () {
  try {
    var t = localStorage.getItem('cv-theme');
    if (t !== 'dark' && t !== 'light') {
      t =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    /* localStorage/matchMedia unavailable — fall back to CSS default */
  }
})();

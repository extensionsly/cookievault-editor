import { initTheme, mountApp } from '@cookievault/ui';
import { initI18n } from '../../lib/i18n.js';
import { logError, reportUrl } from '../../lib/errlog.js';
import { App } from './App.js';

initTheme();

// White-screen prevention + error logging is centralised in mountApp
// (resilience.md §1): bootstrap failures, render throws, and uncaught errors
// all land in the local errlog and show a friendly, retryable screen. A locale
// fetch failure must NOT block render — English is the synchronous fallback, so
// initI18n's rejection is logged and swallowed here (matches the old .finally).
void mountApp({
  rootId: 'root',
  app: <App />,
  prepare: async () => {
    await initI18n().catch((e) => logError(e, 'initI18n'));
  },
  onError: (err, ctx) => void logError(err, ctx),
  screen: {
    title: 'Something went wrong',
    body: 'The cookie list failed to load. Reload usually fixes it — your cookies are untouched.',
    retryLabel: 'Reload',
    reportLabel: 'Report a problem',
    reportHref: reportUrl(),
  },
});

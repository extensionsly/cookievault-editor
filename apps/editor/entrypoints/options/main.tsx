import { initTheme, mountApp } from '@cookievault/ui';
import { initI18n } from '../../lib/i18n.js';
import { logError, reportUrl } from '../../lib/errlog.js';
import { App } from './App.js';
import './styles.css';

initTheme();

// See popup/main.tsx for the mountApp rationale (resilience.md §1).
void mountApp({
  rootId: 'root',
  app: <App />,
  prepare: async () => {
    await initI18n().catch((e) => logError(e, 'initI18n'));
  },
  onError: (err, ctx) => void logError(err, ctx),
  screen: {
    title: 'Something went wrong',
    body: 'This page failed to load. Reload usually fixes it — your profiles stay encrypted and safe.',
    retryLabel: 'Reload',
    reportLabel: 'Report a problem',
    reportHref: reportUrl(),
  },
});

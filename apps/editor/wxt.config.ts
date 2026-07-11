import { defineConfig } from 'wxt';

/**
 * Resolve the worker base URL baked into the build. Dev builds default to
 * localhost; release builds MUST pass `COOKIEVAULT_WORKER_URL` and it must
 * be an https:// non-localhost URL — otherwise a shipped extension would
 * silently talk to localhost over plaintext (audit F11a).
 *
 * Called at MODULE TOP-LEVEL (below), not inside the `vite()` callback:
 * WXT swallows exceptions thrown from `vite()`, so an assertion there would
 * silently fall back. At config-load a bad value fails the build loudly.
 */
function resolveWorkerUrl(): string {
  const url = process.env.COOKIEVAULT_WORKER_URL;
  if (!url) return 'http://localhost:8787';
  if (!url.startsWith('https://') || url.includes('localhost')) {
    throw new Error(
      `COOKIEVAULT_WORKER_URL must be an https:// non-localhost URL for release builds, got: ${url}`,
    );
  }
  return url;
}

const WORKER_BASE_URL = resolveWorkerUrl();

// WXT auto-derives manifest fields from package.json + present entrypoints.
// We only override what we *must* control explicitly.
//
// Manifest hygiene rules (see docs/security-model.md §4):
//   - Only the minimum permissions required for the *Editor's* job.
//   - `<all_urls>` host_permissions is the unavoidable cost of cross-domain
//     cookie editing; we declare it once here, document it in the CWS
//     listing, and never expand the list silently.
//   - CSP is declared explicitly (not just the MV3 default) so store review
//     can self-verify no remote code / eval is allowed.
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: ({ browser }) => ({
    // Localized via public/_locales/<lang>/messages.json (default en).
    name: '__MSG_appName__',
    description: '__MSG_appExtDescription__',
    default_locale: 'en',
    permissions: ['cookies', 'storage'],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
    action: {
      default_title: 'CookieVault Editor',
    },
    // AMO needs a stable add-on id for signing, an API floor
    // (storage.session → Firefox 115), and a data-collection declaration
    // (mandatory for new AMO submissions). Baseline: nothing collected by
    // default; telemetry and the sync account (email) are both opt-in.
    // Re-verify against docs/legal-checklist.md at submission (W6-17).
    // See docs/browser-compatibility.md §AMO.
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          id: 'editor@cookievault.net',
          strict_min_version: '115.0',
          data_collection_permissions: {
            required: ['none'],
            optional: ['technicalAndInteraction', 'authenticationInfo'],
          },
        },
      },
    }),
  }),
  vite: () => ({
    define: {
      __COOKIEVAULT_WORKER_URL__: JSON.stringify(WORKER_BASE_URL),
    },
  }),
  zip: { name: 'cookievault-editor' },
  alias: {},
});

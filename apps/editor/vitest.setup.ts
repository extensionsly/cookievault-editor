// jsdom doesn't implement HTMLDialogElement.showModal/close — polyfill it for
// the <dialog>-based EditDialog / ConfirmDialog.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

import enMessages from './public/_locales/en/messages.json';

// Resolve i18n keys against the real en bundle so component assertions see the
// shipped English copy. Supports positional $1.. substitutions.
function i18nGet(key: string, subs?: string | string[]): string {
  const entry = (enMessages as Record<string, { message: string }>)[key];
  if (!entry) return '';
  let msg = entry.message;
  const arr = Array.isArray(subs) ? subs : subs ? [subs] : [];
  arr.forEach((s, i) => {
    msg = msg.replace(new RegExp('\\$' + (i + 1), 'g'), s);
  });
  return msg;
}

const noopEvent = () => ({ addListener: () => {}, removeListener: () => {} });

// Minimal chrome stub. Components touch chrome.* directly only for
// getManifest / event listeners / tabs.query; lib wrappers are mocked
// per-test, so this surface stays small.
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    getManifest: () => ({ version: '1.2.3' }),
    openOptionsPage: () => {},
    getURL: (p: string) => p,
  },
  storage: {
    local: {
      onChanged: noopEvent(),
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
    session: { get: async () => ({}), set: async () => {} },
    onChanged: noopEvent(),
  },
  cookies: { onChanged: noopEvent() },
  tabs: { query: async () => [] },
  permissions: { contains: async () => false },
  i18n: { getMessage: i18nGet },
};

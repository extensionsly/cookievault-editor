/**
 * Editor runtime i18n — a thin wrapper over the shared `createI18n` factory
 * (@cookievault/ui). This file supplies the chrome-backed adapters, the
 * bundled English fallback, and the Editor's locale-storage key; all logic
 * lives in packages/ui. See that module for the design rationale.
 */
import { browser } from 'wxt/browser';
import { createI18n, LOCALES, type MessageBundle } from '@cookievault/ui';
import enMessages from '../public/_locales/en/messages.json';

const runtime = createI18n({
  enMessages: enMessages as MessageBundle,
  localeKey: 'cookievault.editor.locale.v1',
  storage: {
    get: async (key) => {
      const v = (await browser.storage.local.get(key))[key];
      return typeof v === 'string' ? v : null;
    },
    set: async (key, value) => browser.storage.local.set({ [key]: value }),
    remove: async (key) => browser.storage.local.remove(key),
  },
  loadBundle: async (code) => {
    const res = await fetch(
      browser.runtime.getURL(`/_locales/${code}/messages.json` as import('wxt/browser').PublicPath),
    );
    if (!res.ok) throw new Error(`i18n: cannot load ${code}`);
    return (await res.json()) as MessageBundle;
  },
  uiLanguage: () => browser.i18n.getUILanguage?.() ?? 'en',
});

export const { t, initI18n, getStoredLocale, setLocale } = runtime;
export { LOCALES };

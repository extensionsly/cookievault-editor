/**
 * Shared runtime-i18n factory for the extensions.
 *
 * `chrome.i18n.getMessage` is locked to the browser UI language and can't be
 * overridden at runtime, so a manual language picker needs a small custom
 * layer. Each extension bundles its own English `messages.json` as the
 * synchronous fallback and fetches the effective locale's bundle before first
 * render, overlaying it on top.
 *
 * This module stays chrome-agnostic (packages/ui has no chrome types): the
 * host app injects the storage / fetch / browser-language accessors. Each
 * app's `lib/i18n.ts` is a thin wrapper that calls {@link createI18n} with its
 * own English bundle, locale-storage key, and chrome-backed adapters.
 */

export type MessageBundle = Record<string, { message: string }>;

export interface I18nAdapters {
  /** The extension's bundled English messages (synchronous fallback). */
  enMessages: MessageBundle;
  /** `chrome.storage.local` key the manual choice is persisted under. */
  localeKey: string;
  /** Read/write/clear the persisted locale choice. */
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
  /** Fetch a locale's messages.json (app maps code → packaged URL + fetch). */
  loadBundle(code: string): Promise<MessageBundle>;
  /** The browser UI language, e.g. `'zh-CN'` (from chrome.i18n.getUILanguage). */
  uiLanguage(): string;
}

export interface I18nRuntime {
  /** Resolve a key against the active locale, English fallback, `$1` subs. */
  t(key: string, subs?: string | string[]): string;
  /** Load the effective locale's messages. Call before the first render. */
  initI18n(): Promise<string>;
  /** The stored manual choice, or null when following the browser language. */
  getStoredLocale(): Promise<string | null>;
  /** Persist a choice; `'system'` clears it back to following the browser. */
  setLocale(code: string): Promise<void>;
}

/** Locales bundled under each app's public/_locales (kept in sync with them). */
export const LOCALES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'es', label: 'Español' },
  { code: 'pt-BR', label: 'Português (BR)' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'ru', label: 'Русский' },
  { code: 'uk', label: 'Українська' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'th', label: 'ไทย' },
  { code: 'vi', label: 'Tiếng Việt' },
];

const isKnown = (code: string): boolean => LOCALES.some((l) => l.code === code);

export function createI18n(cfg: I18nAdapters): I18nRuntime {
  const en = cfg.enMessages;
  let active: MessageBundle = en;

  const t: I18nRuntime['t'] = (key, subs) => {
    const entry = active[key] ?? en[key];
    if (!entry) return '';
    const arr = Array.isArray(subs) ? subs : subs != null ? [subs] : [];
    return entry.message.replace(/\$(\d+)/g, (_, n: string) => arr[Number(n) - 1] ?? '');
  };

  const getStoredLocale: I18nRuntime['getStoredLocale'] = async () => {
    const v = await cfg.storage.get(cfg.localeKey);
    return v && isKnown(v) ? v : null;
  };

  const resolveLocale = async (): Promise<string> => {
    const stored = await getStoredLocale();
    if (stored) return stored;
    const ui = (cfg.uiLanguage() || 'en').replace('_', '-');
    if (isKnown(ui)) return ui;
    const base = ui.split('-')[0];
    const match = LOCALES.find((l) => l.code.split('-')[0] === base);
    return match ? match.code : 'en';
  };

  const initI18n: I18nRuntime['initI18n'] = async () => {
    const code = await resolveLocale();
    active = code === 'en' ? en : await cfg.loadBundle(code).catch(() => en);
    return code;
  };

  const setLocale: I18nRuntime['setLocale'] = async (code) => {
    if (code === 'system') await cfg.storage.remove(cfg.localeKey);
    else await cfg.storage.set(cfg.localeKey, code);
  };

  return { t, initI18n, getStoredLocale, setLocale };
}

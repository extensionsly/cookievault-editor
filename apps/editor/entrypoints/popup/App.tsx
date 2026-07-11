import { browser } from 'wxt/browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../lib/i18n.js';
import type { Cookie } from '@cookievault/shared/schema';
import {
  downloadExport,
  importCookies,
  listCookies,
  removeCookie,
  saveCookie,
} from '../../lib/cookies.js';
import { getActiveTabHost, hostMatchesDomain } from '../../lib/tabs.js';
import { EditDialog } from './EditDialog.js';
import { ConfirmDialog, Toast, ThemeToggle, type ToastData } from '@cookievault/ui';
import { ProfileBar } from './ProfileBar.js';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; cookies: Cookie[] }
  | { kind: 'error'; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Cookie | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Cookie | null>(null);
  const [pendingDeleteDomain, setPendingDeleteDomain] = useState<{
    domain: string;
    cookies: Cookie[];
  } | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [activeHost, setActiveHost] = useState<string | null>(null);
  // Default to the active site — the first thing a cookie-manager user
  // looks for (matches EditThisCookie / Cookie-Editor). Falls back to "all"
  // when there's no http(s) tab in focus.
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Inline quick-edit: which row is expanded, and its editable draft of the
  // common fields (value / SameSite / Secure / HttpOnly). Full-field editing
  // (domain/path/expiry + __Host- validation) stays in the EditDialog modal,
  // reachable via "More fields…".
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState<{
    value: string;
    sameSite: Cookie['sameSite'];
    secure: boolean;
    httpOnly: boolean;
  } | null>(null);
  // While an import or bulk delete runs, cookies.onChanged fires once per
  // write. Suppress the per-event refresh and do a single one at the end.
  const importingRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const cookies = await listCookies();
      setState({ kind: 'ready', cookies });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void refresh();
    void getActiveTabHost().then(setActiveHost);
    // External changes (any source: us, the browser, another extension)
    // keep the list fresh. Debounced + import-aware: a burst of changes
    // collapses into a single trailing re-fetch instead of one full
    // re-fetch + re-render per event. We re-fetch the whole list rather
    // than diff, keeping CHIPS / partitionKey semantics correct.
    const handler = () => {
      if (importingRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void refresh(), 250);
    };
    browser.cookies.onChanged.addListener(handler);
    return () => {
      browser.cookies.onChanged.removeListener(handler);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const useCurrentScope = scope === 'current' && activeHost !== null;

  const grouped = useMemo(() => {
    if (state.kind !== 'ready') return [] as Array<[string, Cookie[]]>;
    const q = query.trim().toLowerCase();
    const filtered = state.cookies.filter((c) => {
      if (useCurrentScope && !hostMatchesDomain(activeHost!, c.domain)) return false;
      if (!q) return true;
      return c.domain.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
    });
    const m = new Map<string, Cookie[]>();
    for (const c of filtered) {
      const key = c.domain.replace(/^\./, '');
      const bucket = m.get(key);
      if (bucket) bucket.push(c);
      else m.set(key, [c]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state, query, useCurrentScope, activeHost]);

  const confirmDelete = useCallback(async () => {
    const c = pendingDelete;
    setPendingDelete(null);
    if (!c) return;
    try {
      await removeCookie(c);
      setToast({ kind: 'success', message: t('toastDeleted', c.name) });
    } catch (err) {
      setToast({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [pendingDelete]);

  const confirmDeleteDomain = useCallback(async () => {
    const batch = pendingDeleteDomain;
    setPendingDeleteDomain(null);
    if (!batch) return;
    importingRef.current = true; // suppress the per-delete onChanged storm
    let failed = 0;
    for (const c of batch.cookies) {
      await removeCookie(c).catch(() => {
        failed += 1;
      });
    }
    importingRef.current = false;
    await refresh();
    setToast(
      failed > 0
        ? {
            kind: 'error',
            message: t('toastImportedPartial', [
              String(batch.cookies.length - failed),
              String(batch.cookies.length),
              String(failed),
            ]),
          }
        : { kind: 'success', message: t('toastDeleted', batch.domain) },
    );
  }, [pendingDeleteDomain, refresh]);

  const handleCopy = useCallback(async (c: Cookie) => {
    try {
      await navigator.clipboard.writeText(c.value);
      setToast({ kind: 'info', message: t('toastCopied') });
    } catch {
      /* clipboard denied — no-op */
    }
  }, []);

  const toggleInline = useCallback(
    (c: Cookie, key: string) => {
      if (expandedKey === key) {
        setExpandedKey(null);
        setInlineDraft(null);
      } else {
        setExpandedKey(key);
        setInlineDraft({
          value: c.value,
          sameSite: c.sameSite,
          secure: c.secure,
          httpOnly: c.httpOnly,
        });
      }
    },
    [expandedKey],
  );

  const saveInline = useCallback(
    async (c: Cookie) => {
      if (!inlineDraft) return;
      try {
        await saveCookie(c, { ...c, ...inlineDraft });
        setExpandedKey(null);
        setInlineDraft(null);
        setToast({ kind: 'success', message: t('toastSaved', c.name) });
      } catch (err) {
        setToast({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    },
    [inlineDraft],
  );

  const handleSave = useCallback(
    async (updated: Cookie) => {
      // Capture `editing` value before the dialog clears it.
      const original = editing;
      await saveCookie(original, updated);
      setEditing(null);
      setToast({ kind: 'success', message: t('toastSaved', updated.name) });
    },
    [editing],
  );

  const handleExport = useCallback(() => {
    if (state.kind !== 'ready') return;
    downloadExport(state.cookies);
    setToast({ kind: 'info', message: t('toastExported', String(state.cookies.length)) });
  }, [state]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleAddClick = useCallback(async () => {
    // Seed a new cookie from the active tab's host + scheme. Falls back
    // to an empty domain when the user is on a non-http page so they can
    // type one in. The EditDialog handles validation; saveCookie treats
    // a seed with no real-browser counterpart as a pure create.
    const seed = await buildSeedCookie();
    setEditing(seed);
  }, []);

  const handleImportFile = useCallback(
    async (file: File) => {
      importingRef.current = true;
      try {
        const text = await file.text();
        const summary = await importCookies(text);
        await refresh();
        const msg =
          summary.failed.length > 0
            ? t('toastImportedPartial', [
                String(summary.ok),
                String(summary.total),
                String(summary.failed.length),
              ])
            : t('toastImported', [String(summary.ok), summary.source]);
        setToast({ kind: summary.failed.length > 0 ? 'error' : 'success', message: msg });
      } catch (err) {
        setToast({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        importingRef.current = false;
      }
    },
    [refresh],
  );

  if (state.kind === 'loading') {
    return <main className="status">{t('loadingCookies')}</main>;
  }
  if (state.kind === 'error') {
    return (
      <main className="status error">
        <p>{t('errorReadCookies')}</p>
        <code>{state.message}</code>
      </main>
    );
  }

  const total = state.cookies.length;
  const visible = grouped.reduce((n, [, list]) => n + list.length, 0);

  return (
    <main>
      <ProfileBar onToast={setToast} />
      <header>
        <div className="header-top">
          <div className="brand">
            <span className="brand-logo" aria-hidden="true">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m18 13-1.5-7.5L9 4 7.5 11.5 15 13Z" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </span>
            <span className="brand-name">{t('appShortName')}</span>
          </div>
          <span className="header-spacer" />
          <ThemeToggle label={t('themeToggle')} />
          <button
            type="button"
            className="icon settings-btn"
            onClick={() => browser.runtime.openOptionsPage()}
            aria-label={t('optionsButton')}
            title={t('optionsButton')}
          >
            ⚙
          </button>
        </div>
        <div className="search-pill">
          <span className="search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            placeholder={t('filterPlaceholder')}
            aria-label={t('filterAriaLabel')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query ? (
            <button
              type="button"
              className="search-clear"
              onClick={() => setQuery('')}
              aria-label={t('clearSearch')}
            >
              ✕
            </button>
          ) : null}
        </div>
        {activeHost ? (
          <div className="scope-toggle" role="group" aria-label={t('scopeCurrent')}>
            <button
              type="button"
              className={scope === 'current' ? 'active' : ''}
              aria-pressed={scope === 'current'}
              onClick={() => setScope('current')}
              title={activeHost}
            >
              {t('scopeCurrent')}
            </button>
            <button
              type="button"
              className={scope === 'all' ? 'active' : ''}
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              {t('scopeAll')}
            </button>
          </div>
        ) : null}
        <div className="toolbar">
          <button type="button" onClick={() => void handleAddClick()}>
            {t('buttonAdd')}
          </button>
          <button type="button" onClick={handleImportClick}>
            {t('buttonImport')}
          </button>
          <button type="button" onClick={handleExport} disabled={total === 0}>
            {t('buttonExport')}
          </button>
          <span className="stats">
            {query
              ? t('statsFiltered', [String(visible), String(total), String(grouped.length)])
              : t('statsAll', [String(total), String(grouped.length)])}
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImportFile(f);
            e.target.value = '';
          }}
        />
      </header>
      <ul className="domain-list">
        {grouped.map(([domain, list]) => (
          <li key={domain}>
            <details>
              <summary>
                <span className="domain">{domain}</span>
                <span className="count">{list.length}</span>
                <button
                  type="button"
                  className="icon danger domain-delete"
                  onClick={(e) => {
                    e.preventDefault();
                    setPendingDeleteDomain({ domain, cookies: list });
                  }}
                  aria-label={t('deleteDomain')}
                  title={t('deleteDomain')}
                >
                  🗑
                </button>
              </summary>
              <ul className="cookie-list">
                {list.map((c) => {
                  const key = `${c.domain}|${c.path}|${c.name}`;
                  const expanded = expandedKey === key;
                  return (
                    <li key={key} className={expanded ? 'expanded' : ''}>
                      <div className="cookie-row">
                        <button
                          type="button"
                          className="row-main"
                          onClick={() => toggleInline(c, key)}
                          aria-expanded={expanded}
                          aria-label={t('editAria', c.name)}
                        >
                          <span className="name" title={c.name}>
                            {c.name}
                          </span>
                          <span className="value" title={c.value}>
                            {c.value.length > 48
                              ? `${c.value.slice(0, 48)}…`
                              : c.value || <em>{t('emptyValue')}</em>}
                          </span>
                          <span className="flags" aria-label={t('cookieFlagsAria')}>
                            {c.secure ? <span title={t('flagSecure')}>Secure</span> : null}
                            {c.httpOnly ? <span title={t('flagHttpOnly')}>HttpOnly</span> : null}
                            {c.partitionKey ? (
                              <span className="vault" title={t('flagPartitioned')}>
                                P
                              </span>
                            ) : null}
                            {!c.secure &&
                            !c.httpOnly &&
                            !c.partitionKey &&
                            c.sameSite !== 'unspecified' ? (
                              <span className="neutral">
                                {c.sameSite === 'no_restriction' ? 'None' : c.sameSite}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <span className="actions">
                          <button
                            type="button"
                            className="icon"
                            onClick={() => void handleCopy(c)}
                            aria-label={t('copyValue')}
                            title={t('copyValue')}
                          >
                            ⎘
                          </button>
                          <button
                            type="button"
                            className="icon danger"
                            onClick={() => setPendingDelete(c)}
                            aria-label={t('deleteAria', c.name)}
                            title={t('deleteTitle')}
                          >
                            ✕
                          </button>
                        </span>
                      </div>
                      {expanded && inlineDraft ? (
                        <div className="cookie-inline">
                          <div className="field">
                            <label className="field-label">{t('fieldValue')}</label>
                            <input
                              type="text"
                              className="mono"
                              value={inlineDraft.value}
                              onChange={(e) =>
                                setInlineDraft({ ...inlineDraft, value: e.target.value })
                              }
                            />
                          </div>
                          <div className="inline-row2">
                            <div className="field">
                              <label className="field-label">{t('fieldSameSite')}</label>
                              <select
                                value={inlineDraft.sameSite}
                                onChange={(e) =>
                                  setInlineDraft({
                                    ...inlineDraft,
                                    sameSite: e.target.value as Cookie['sameSite'],
                                  })
                                }
                              >
                                <option value="unspecified">unspecified</option>
                                <option value="no_restriction">None</option>
                                <option value="lax">Lax</option>
                                <option value="strict">Strict</option>
                              </select>
                            </div>
                            <div className="chip-group">
                              <button
                                type="button"
                                className={`chip ${inlineDraft.secure ? 'on' : ''}`}
                                aria-pressed={inlineDraft.secure}
                                onClick={() =>
                                  setInlineDraft({ ...inlineDraft, secure: !inlineDraft.secure })
                                }
                              >
                                {t('checkSecure')}
                              </button>
                              <button
                                type="button"
                                className={`chip ${inlineDraft.httpOnly ? 'on' : ''}`}
                                aria-pressed={inlineDraft.httpOnly}
                                onClick={() =>
                                  setInlineDraft({
                                    ...inlineDraft,
                                    httpOnly: !inlineDraft.httpOnly,
                                  })
                                }
                              >
                                {t('checkHttpOnly')}
                              </button>
                            </div>
                          </div>
                          <div className="inline-actions">
                            <button
                              type="button"
                              className="primary"
                              onClick={() => void saveInline(c)}
                            >
                              {t('buttonSave')}
                            </button>
                            <button type="button" onClick={() => setEditing(c)}>
                              {t('moreFields')}
                            </button>
                            <span className="spacer" />
                            <button
                              type="button"
                              className="danger-text"
                              onClick={() => setPendingDelete(c)}
                            >
                              {t('buttonDelete')}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </details>
          </li>
        ))}
        {grouped.length === 0 ? (
          <li className="empty">
            {query ? (
              <>
                {t('noCookiesMatch', query)}{' '}
                <button type="button" className="link" onClick={() => setQuery('')}>
                  {t('clearFilter')}
                </button>
              </>
            ) : useCurrentScope ? (
              <>
                {t('noCookiesThisSite')}{' '}
                <button type="button" className="link" onClick={() => setScope('all')}>
                  {t('scopeAll')}
                </button>
              </>
            ) : (
              t('noCookiesYet')
            )}
          </li>
        ) : null}
      </ul>
      <footer>
        <span>v{browser.runtime.getManifest().version}</span>
        <button type="button" onClick={() => browser.runtime.openOptionsPage()}>
          {t('optionsButton')}
        </button>
      </footer>
      <Toast toast={toast} onDismiss={() => setToast(null)} dismissTitle={t('dismiss')} />
      <EditDialog cookie={editing} onCancel={() => setEditing(null)} onSave={handleSave} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('deleteCookieTitle')}
        message={
          pendingDelete ? t('deleteCookieMessage', [pendingDelete.name, pendingDelete.domain]) : ''
        }
        confirmLabel={t('buttonDelete')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={pendingDeleteDomain !== null}
        title={t('confirmDeleteDomainTitle')}
        message={
          pendingDeleteDomain ? t('confirmDeleteDomainMessage', pendingDeleteDomain.domain) : ''
        }
        confirmLabel={t('buttonDelete')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => void confirmDeleteDomain()}
        onCancel={() => setPendingDeleteDomain(null)}
      />
    </main>
  );
}

/**
 * Seed a new Cookie from the active tab's host and scheme. Falls back to
 * an empty domain when the user is on a non-http page (e.g. chrome://newtab);
 * the EditDialog then prompts them to type one. 30-day expiry by default;
 * users that want a session cookie flip the radio in the dialog.
 */
async function buildSeedCookie(): Promise<Cookie> {
  const thirtyDays = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  let host = '';
  let secure = true;
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      const u = new URL(tab.url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        host = u.hostname;
        secure = u.protocol === 'https:';
      }
    }
  } catch {
    // Non-http page or missing tabs permission — leave host blank.
  }
  return {
    name: '',
    value: '',
    domain: host,
    hostOnly: true,
    path: '/',
    secure,
    httpOnly: false,
    sameSite: 'lax',
    session: false,
    expirationDate: thirtyDays,
  };
}

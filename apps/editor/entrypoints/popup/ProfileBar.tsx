import { browser, type Browser } from 'wxt/browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '../../lib/i18n.js';
import {
  BUILT_IN_SCOPES,
  FACEBOOK_SCOPE,
  type Profile,
  type Scope,
  cookieInScope,
  findScope,
  hostMatchesBase,
} from '@cookievault/shared';
import { getSessionKey, loadVault, lock, readProfiles } from '../../lib/profile-store.js';
import { reloadScopeTabs, switchProfile } from '../../lib/profile.js';
import { ConfirmDialog } from '@cookievault/ui';
import { requireFeature } from '../../lib/gating.js';

/**
 * Toast contract — popup-local, duplicated from App.tsx so this
 * component doesn't reach back into its parent's type. A one-line
 * type is cheaper to duplicate than to refactor through a barrel.
 */
export type ProfileBarToast = {
  kind: 'info' | 'success' | 'error';
  message: string;
};

interface Props {
  onToast: (t: ProfileBarToast) => void;
}

type VaultView =
  | { kind: 'loading' }
  | { kind: 'init' }
  | { kind: 'locked' }
  | { kind: 'unlocked'; profiles: Profile[] };

/**
 * UI-only preference: last scope the user picked in the popup. Lives
 * in `storage.session` (RAM-only, resets on browser restart) — not
 * business data, so it sidesteps the red-line rule that puts business
 * data behind the `profile-store` facade.
 */
const SCOPE_PREF_KEY = 'cookievault.editor.popupScope.v1';
const VAULT_SESSION_KEY = 'cookievault.profileVault.session';
const VAULT_LOCAL_KEY = 'cookievault.profileVault.v1';

async function detectCurrentTabScope(): Promise<Scope | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const host = new URL(tab.url).hostname;
    for (const s of BUILT_IN_SCOPES) {
      for (const base of s.hosts) {
        if (hostMatchesBase(host, base)) return s;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function loadPersistedScope(): Promise<Scope | null> {
  try {
    const r = await browser.storage.session.get(SCOPE_PREF_KEY);
    const id = r[SCOPE_PREF_KEY] as string | undefined;
    if (!id) return null;
    return findScope(id) ?? null;
  } catch {
    return null;
  }
}

async function persistScope(scope: Scope): Promise<void> {
  await browser.storage.session.set({ [SCOPE_PREF_KEY]: scope.id });
}

export function ProfileBar({ onToast }: Props) {
  const [view, setView] = useState<VaultView>({ kind: 'loading' });
  const [scope, setScope] = useState<Scope>(FACEBOOK_SCOPE);
  const [scopeResolved, setScopeResolved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ affectedTabs: number; scopeId: string } | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<Profile | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Priority: current tab > last persisted > Facebook fallback.
      const tabScope = await detectCurrentTabScope();
      const fallback = tabScope ?? (await loadPersistedScope()) ?? FACEBOOK_SCOPE;
      if (!alive) return;
      setScope(fallback);
      setScopeResolved(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    // Skip the initial mount write — we only want to persist user
    // changes, not echo back the resolved default.
    if (!scopeResolved) return;
    void persistScope(scope);
    // Clear stale "tabs need refresh" prompt if scope changed.
    setPending((prev) => (prev && prev.scopeId !== scope.id ? null : prev));
  }, [scope, scopeResolved]);

  const reload = useCallback(async () => {
    try {
      const vault = await loadVault();
      if (!vault) {
        setView({ kind: 'init' });
        return;
      }
      const key = await getSessionKey();
      if (!key) {
        setView({ kind: 'locked' });
        return;
      }
      const profiles = await readProfiles(key);
      setView({ kind: 'unlocked', profiles });
    } catch (err) {
      onToast({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      setView({ kind: 'locked' });
    }
  }, [onToast]);

  useEffect(() => {
    void reload();
    const handler = (
      changes: { [k: string]: Browser.storage.StorageChange },
      area: Browser.storage.AreaName,
    ) => {
      if (area !== 'local' && area !== 'session') return;
      // Fast-path: if the session key was cleared, jump to locked
      // immediately — calling readProfiles with a stale in-memory key
      // would surface a confusing decrypt error before the next reload.
      const sessionChange = changes[VAULT_SESSION_KEY];
      if (area === 'session' && sessionChange && sessionChange.newValue === undefined) {
        setView({ kind: 'locked' });
        return;
      }
      // Only the vault's own keys should trigger a full re-decrypt. Auth,
      // sync-state, telemetry and entitlement writes share storage.local
      // but are irrelevant here — reacting to them re-ran an AES-GCM
      // decrypt of the whole vault on every unrelated write (audit F13c).
      if (!changes[VAULT_LOCAL_KEY] && !changes[VAULT_SESSION_KEY]) return;
      void reload();
    };
    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  }, [reload]);

  const handleOpenOptions = useCallback(() => {
    browser.runtime.openOptionsPage();
  }, []);

  const handleLock = useCallback(async () => {
    await lock();
    setView({ kind: 'locked' });
  }, []);

  const performSwitch = useCallback(
    async (p: Profile) => {
      setBusy(p.id);
      setPending(null);
      try {
        const gate = await requireFeature('profile-switching');
        if (!gate.allowed) {
          onToast({ kind: 'error', message: t('proSwitchRequired') });
          return;
        }
        const out = await switchProfile(p, scope);
        if (out.rolledBack) {
          onToast({
            kind: 'error',
            message: t('toastSwitchFailed', String(out.attempted)),
          });
        } else {
          onToast({
            kind: 'success',
            message:
              out.failures.length === 0
                ? t('toastSwitched', [p.name, String(out.applied)])
                : t('toastSwitchedPartial', [String(out.applied), String(out.failures.length)]),
          });
          if (out.affectedTabs > 0) {
            setPending({ affectedTabs: out.affectedTabs, scopeId: scope.id });
          }
        }
      } catch (err) {
        onToast({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(null);
      }
    },
    [scope, onToast],
  );

  const handleReloadTabs = useCallback(async () => {
    setBusy('reload');
    try {
      const n = await reloadScopeTabs(scope);
      onToast({
        kind: 'info',
        message: t('toastReloaded', [String(n), scope.label]),
      });
      setPending(null);
    } catch (err) {
      onToast({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }, [scope, onToast]);

  const visibleProfiles = useMemo(() => {
    if (view.kind !== 'unlocked') return [];
    // Mirror options/App.tsx filter: keep profiles that either match
    // the scope or are empty (newly created, not yet populated).
    return view.profiles.filter(
      (p) => p.cookies.length === 0 || p.cookies.some((c) => cookieInScope(c, scope)),
    );
  }, [view, scope]);

  if (view.kind === 'loading') {
    return <section className="profile-bar status">{t('profilesLoading')}</section>;
  }

  if (view.kind === 'init') {
    return (
      <section className="profile-bar cta">
        <button type="button" className="cta-button" onClick={handleOpenOptions}>
          {t('setupVault')}
        </button>
      </section>
    );
  }

  if (view.kind === 'locked') {
    return (
      <section className="profile-bar cta">
        <button type="button" className="cta-button" onClick={handleOpenOptions}>
          {t('unlockInOptions')}
        </button>
      </section>
    );
  }

  return (
    <section className="profile-bar">
      <div className="scope-row">
        <select
          value={scope.id}
          onChange={(e) => {
            const next = BUILT_IN_SCOPES.find((s) => s.id === e.target.value);
            if (next) setScope(next);
          }}
          aria-label={t('profileScopeAria')}
        >
          {BUILT_IN_SCOPES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button type="button" className="lock-btn" onClick={handleLock} title={t('lockVault')}>
          {t('lockButton')}
        </button>
      </div>
      {visibleProfiles.length === 0 ? (
        <p className="empty">
          {t('noProfilesForScope', scope.label)}{' '}
          <button type="button" className="link" onClick={handleOpenOptions}>
            {t('saveOne')}
          </button>
        </p>
      ) : (
        <ul className="profile-rows">
          {visibleProfiles.map((p) => (
            <li key={p.id} className="profile-row">
              <span className="name" title={p.name}>
                {p.name}
              </span>
              <span className="count" title={t('cookiesInScope')}>
                {p.cookies.filter((c) => cookieInScope(c, scope)).length}
              </span>
              <button
                type="button"
                className="switch-btn"
                onClick={() => setPendingSwitch(p)}
                disabled={busy !== null}
              >
                {busy === p.id ? t('switching') : t('switchButton')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pending ? (
        <div className="pending-reload">
          <span>{t('tabsNeedRefresh', [String(pending.affectedTabs), scope.label])}</span>
          <span className="spacer" />
          <button
            type="button"
            className="reload-btn"
            onClick={() => void handleReloadTabs()}
            disabled={busy !== null}
          >
            {busy === 'reload' ? '…' : t('reloadButton')}
          </button>
        </div>
      ) : null}
      <ConfirmDialog
        open={pendingSwitch !== null}
        title={t('switchProfileTitle')}
        message={pendingSwitch ? t('switchProfileMessage', [pendingSwitch.name, scope.label]) : ''}
        confirmLabel={t('switchConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          const p = pendingSwitch;
          setPendingSwitch(null);
          if (p) void performSwitch(p);
        }}
        onCancel={() => setPendingSwitch(null)}
      />
    </section>
  );
}

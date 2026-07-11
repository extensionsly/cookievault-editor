import { browser, type Browser } from 'wxt/browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { t, LOCALES, getStoredLocale, setLocale } from '../../lib/i18n.js';
import {
  BUILT_IN_SCOPES,
  FACEBOOK_SCOPE,
  InvalidPassphraseError,
  type Profile,
  type Scope,
  cookieInScope,
} from '@cookievault/shared';
import { evaluatePassphrase, type PassphraseStrength } from '@cookievault/shared/profile/strength';
import {
  type RateLimitState,
  isLockedOut,
  recordFailure,
  secondsUntilUnlock,
} from '@cookievault/shared';
import {
  clearRateLimit,
  getSessionKey,
  initialiseVault,
  loadRateLimit,
  loadVault,
  lock,
  readProfiles,
  resetVault,
  saveRateLimit,
  unlockVault,
  writeProfiles,
} from '../../lib/profile-store.js';
import { listCookiesInScope, reloadScopeTabs, switchProfile } from '../../lib/profile.js';
import { ConfirmDialog, ThemeToggle } from '@cookievault/ui';
import { AccountPanel } from './AccountPanel.js';
import { ProPanel } from './ProPanel.js';

const VAULT_LOCAL_KEY = 'cookievault.profileVault.v1';
const VAULT_SESSION_KEY = 'cookievault.profileVault.session';

type VaultState =
  | { kind: 'loading' }
  | { kind: 'init' }
  | { kind: 'locked' }
  | { kind: 'unlocked'; key: CryptoKey; profiles: Profile[] }
  | { kind: 'error'; message: string };

/**
 * Manual language picker (design spec §3.2). "System" follows the browser
 * language; any other choice is stored and overrides it. Changing it reloads
 * the page so the i18n layer re-initialises with the new locale.
 */
function LanguageSelect() {
  const [locale, setLoc] = useState<string>('system');
  useEffect(() => {
    void getStoredLocale().then((v) => setLoc(v ?? 'system'));
  }, []);
  return (
    <select
      className="lang-select"
      aria-label={t('prefLanguage')}
      value={locale}
      onChange={(e) => {
        const next = e.target.value;
        setLoc(next);
        void setLocale(next).then(() => location.reload());
      }}
    >
      <option value="system">{t('langSystem')}</option>
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

export function App() {
  const [state, setState] = useState<VaultState>({ kind: 'loading' });

  const reload = useCallback(async () => {
    try {
      const vault = await loadVault();
      if (!vault) {
        setState({ kind: 'init' });
        return;
      }
      const key = await getSessionKey();
      if (!key) {
        setState({ kind: 'locked' });
        return;
      }
      const profiles = await readProfiles(key);
      setState({ kind: 'unlocked', key, profiles });
    } catch (err) {
      setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void reload();
    // If a different page locks / unlocks the vault, sync our view — but
    // only react to the vault's own keys. Unrelated storage.local writes
    // (auth, sync-state, telemetry) would otherwise re-decrypt the whole
    // vault on every change (audit F13c).
    const handler = (
      changes: { [k: string]: Browser.storage.StorageChange },
      area: Browser.storage.AreaName,
    ) => {
      if (area !== 'session' && area !== 'local') return;
      if (!changes[VAULT_LOCAL_KEY] && !changes[VAULT_SESSION_KEY]) return;
      void reload();
    };
    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  }, [reload]);

  return (
    <main className="layout">
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      >
        <h1>{t('eoTitle')}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LanguageSelect />
          <ThemeToggle label={t('themeToggle')} />
        </div>
      </div>
      <p className="lead">{t('eoLead')}</p>
      {state.kind === 'loading' ? <p className="note">{t('eoLoadingVault')}</p> : null}
      {state.kind === 'init' ? <SetupPanel onSetup={reload} /> : null}
      {state.kind === 'locked' ? <UnlockPanel onUnlock={reload} onReset={reload} /> : null}
      {state.kind === 'unlocked' ? (
        <>
          <AccountPanel />
          <ProPanel />
          <ProfileManager
            key={state.key.algorithm.name}
            vaultKey={state.key}
            profiles={state.profiles}
            onChange={reload}
          />
        </>
      ) : null}
      {state.kind === 'error' ? (
        <div className="banner error">
          <span>{state.message}</span>
        </div>
      ) : null}
    </main>
  );
}

function StrengthMeter({ strength }: { strength: PassphraseStrength }) {
  // Score 0-4 → 5 segments. Coloured by score band.
  const colors = ['#dc2626', '#f97316', '#eab308', '#16a34a', '#0ea5e9'];
  const filledColor = colors[strength.score];
  return (
    <div className="strength-meter" aria-label={t('eoStrengthAria', strength.label)}>
      <div className="bar">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="seg"
            style={{ background: i <= strength.score ? filledColor : 'var(--border)' }}
          />
        ))}
      </div>
      <div className="strength-label">
        <span style={{ color: filledColor }}>{strength.label}</span>
        <span className="strength-time"> {t('eoCracksIn', strength.crackTimeDisplay)}</span>
      </div>
      {strength.warning ? <p className="strength-hint warn">{strength.warning}</p> : null}
      {strength.suggestions.length > 0 ? (
        <ul className="strength-suggestions">
          {strength.suggestions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SetupPanel({ onSetup }: { onSetup: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = useMemo(() => evaluatePassphrase(passphrase), [passphrase]);
  const canSubmit = strength.isStrong && passphrase === confirm && !busy;

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!strength.isStrong) {
        setError(t('eoPassphraseWeak', strength.label));
        return;
      }
      if (passphrase !== confirm) {
        setError(t('eoPassMismatch'));
        return;
      }
      setBusy(true);
      try {
        await initialiseVault(passphrase);
        onSetup();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [passphrase, confirm, onSetup, strength],
  );

  return (
    <section className="panel">
      <h2>{t('eoSetupHeading')}</h2>
      <p className="panel-lead">{t('eoSetupLede')}</p>
      <form onSubmit={submit}>
        <div className="row">
          <label className="field">
            {t('eoPassphrase')}
            <input
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required
            />
          </label>
          <label className="field">
            {t('eoConfirm')}
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>
        </div>
        {passphrase.length > 0 ? <StrengthMeter strength={strength} /> : null}
        <div className="row">
          <button type="submit" className="primary" disabled={!canSubmit}>
            {busy ? t('eoCreating') : t('eoCreateVault')}
          </button>
          <span className="spacer" />
        </div>
        {error ? (
          <p className="note" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        ) : null}
        <ul className="warn-list">
          <li>{t('eoWarnForget')}</li>
          <li>{t('eoWarnReenter')}</li>
        </ul>
      </form>
    </section>
  );
}

function UnlockPanel({ onUnlock, onReset }: { onUnlock: () => void; onReset: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirmReset, setConfirmReset] = useState(false);

  // Load persisted rate-limit on mount + on every storage.session change.
  useEffect(() => {
    let alive = true;
    void loadRateLimit().then((s) => {
      if (alive) setRateLimit(s);
    });
    const handler = (
      _changes: { [k: string]: Browser.storage.StorageChange },
      area: Browser.storage.AreaName,
    ) => {
      if (area !== 'session') return;
      void loadRateLimit().then((s) => {
        if (alive) setRateLimit(s);
      });
    };
    browser.storage.onChanged.addListener(handler);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(handler);
    };
  }, []);

  // Live countdown while locked. setInterval only runs when needed.
  const locked = rateLimit ? isLockedOut(rateLimit, now) : false;
  useEffect(() => {
    if (!locked) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [locked]);

  const remaining = rateLimit ? secondsUntilUnlock(rateLimit, now) : 0;

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (rateLimit && isLockedOut(rateLimit, Date.now())) {
        // Defence in depth — UI already disables, but a race could fire here.
        setError(t('eoTooManyAttempts'));
        return;
      }
      setBusy(true);
      try {
        await unlockVault(passphrase);
        // unlockVault already calls clearRateLimit on success; reflect that here.
        setRateLimit({ failures: 0 });
        setPassphrase('');
        onUnlock();
      } catch (err) {
        if (err instanceof InvalidPassphraseError) {
          const current = (await loadRateLimit()) ?? { failures: 0 };
          const next = recordFailure(current, Date.now());
          await saveRateLimit(next);
          setRateLimit(next);
          const left = Math.max(0, 5 - next.failures);
          setError(next.lockedUntil ? t('eoLockedOut60') : t('eoWrongPassAttempts', String(left)));
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setBusy(false);
      }
    },
    [passphrase, onUnlock, rateLimit],
  );

  const handleReset = useCallback(async () => {
    setConfirmReset(false);
    await resetVault();
    await clearRateLimit();
    setRateLimit({ failures: 0 });
    onReset();
  }, [onReset]);

  return (
    <section className="panel">
      <h2>{t('eoUnlockHeading')}</h2>
      <p className="panel-lead">{t('eoUnlockLede')}</p>
      {locked ? (
        <div className="banner error" style={{ marginBottom: 12 }}>
          {t('eoLockedTryAgain', String(remaining))}
        </div>
      ) : null}
      <form onSubmit={submit}>
        <div className="row">
          <label className="field">
            {t('eoPassphrase')}
            <input
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required
              autoFocus
              disabled={locked}
            />
          </label>
        </div>
        <div className="row">
          <button type="submit" className="primary" disabled={busy || locked}>
            {busy ? t('eoUnlocking') : t('eoUnlock')}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => setConfirmReset(true)}
            disabled={busy}
          >
            {t('eoResetVault')}
          </button>
        </div>
        {error && !locked ? (
          <p className="note" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        ) : null}
      </form>
      <ConfirmDialog
        open={confirmReset}
        title={t('eoResetTitle')}
        message={t('eoResetMessage')}
        confirmLabel={t('eoResetVault')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => void handleReset()}
        onCancel={() => setConfirmReset(false)}
      />
    </section>
  );
}

type StatusBanner =
  | { kind: 'success'; message: string; reloadCount?: number; scope?: Scope }
  | { kind: 'error'; message: string }
  | { kind: 'info'; message: string }
  | null;

function ProfileManager({
  vaultKey,
  profiles: initialProfiles,
  onChange,
}: {
  vaultKey: CryptoKey;
  profiles: Profile[];
  onChange: () => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>(initialProfiles);
  const [scope, setScope] = useState<Scope>(FACEBOOK_SCOPE);
  const [liveCount, setLiveCount] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<StatusBanner>(null);
  const [pendingSwitch, setPendingSwitch] = useState<Profile | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);

  // Re-read profiles from the vault if the parent reload-cycle changes them.
  useEffect(() => {
    setProfiles(initialProfiles);
  }, [initialProfiles]);

  const refreshLiveCount = useCallback(async () => {
    try {
      const list = await listCookiesInScope(scope);
      setLiveCount(list.length);
    } catch (err) {
      setBanner({
        kind: 'error',
        message: t('eoCouldNotReadLive', err instanceof Error ? err.message : String(err)),
      });
    }
  }, [scope]);

  useEffect(() => {
    void refreshLiveCount();
    const handler = () => void refreshLiveCount();
    browser.cookies.onChanged.addListener(handler);
    return () => browser.cookies.onChanged.removeListener(handler);
  }, [refreshLiveCount]);

  const persist = useCallback(
    async (next: Profile[]) => {
      await writeProfiles(vaultKey, next);
      setProfiles(next);
    },
    [vaultKey],
  );

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const name = newName.trim();
      if (!name) return;
      setBusy('save');
      setBanner(null);
      try {
        const live = await listCookiesInScope(scope);
        const inScope = live.filter((c) => cookieInScope(c, scope));
        const now = new Date().toISOString();
        const profile: Profile = {
          id: crypto.randomUUID(),
          name,
          createdAt: now,
          updatedAt: now,
          cookies: inScope,
        };
        await persist([...profiles, profile]);
        setNewName('');
        setBanner({
          kind: 'success',
          message: t('eoSavedProfile', [name, String(inScope.length)]),
        });
      } catch (err) {
        setBanner({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(null);
      }
    },
    [newName, scope, profiles, persist],
  );

  const handleSwitch = useCallback(
    async (p: Profile) => {
      setBusy(p.id);
      setBanner(null);
      try {
        const out = await switchProfile(p, scope);
        if (out.rolledBack) {
          setBanner({
            kind: 'error',
            message: t('eoSwitchFailedBanner', [p.name, String(out.attempted)]),
          });
        } else {
          setBanner({
            kind: 'success',
            scope,
            reloadCount: out.affectedTabs,
            message:
              out.failures.length === 0
                ? t('eoSwitchedApplied', [p.name, String(out.applied)])
                : t('eoSwitchedPartial', [
                    p.name,
                    String(out.applied),
                    String(out.failures.length),
                  ]),
          });
        }
        await refreshLiveCount();
      } catch (err) {
        setBanner({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(null);
      }
    },
    [scope, refreshLiveCount],
  );

  const handleDelete = useCallback(
    async (p: Profile) => {
      setBusy(p.id);
      setBanner(null);
      try {
        await persist(profiles.filter((x) => x.id !== p.id));
        setBanner({ kind: 'info', message: t('eoDeletedProfile', p.name) });
      } catch (err) {
        setBanner({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(null);
      }
    },
    [persist, profiles],
  );

  const handleReloadTabs = useCallback(async () => {
    if (!banner || banner.kind !== 'success' || !banner.scope) return;
    setBusy('reload');
    try {
      const n = await reloadScopeTabs(banner.scope);
      setBanner({
        kind: 'info',
        message: t('eoReloadedTabs', [String(n), banner.scope.label]),
      });
    } catch (err) {
      setBanner({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }, [banner]);

  const handleLock = useCallback(async () => {
    await lock();
    onChange();
  }, [onChange]);

  const scopeProfiles = profiles.filter(
    (p) => p.cookies.some((c) => cookieInScope(c, scope)) || p.cookies.length === 0,
  );

  return (
    <>
      <div className="toolbar">
        <span className="scope-pill">{t('eoVaultUnlocked')}</span>
        <span className="spacer" />
        <button type="button" className="ghost" onClick={handleLock}>
          {t('eoLockVault')}
        </button>
      </div>

      <section className="panel">
        <h2>{t('eoScopeHeading')}</h2>
        <p className="panel-lead">{t('eoScopeLede')}</p>
        <div className="row">
          <label className="field">
            {t('eoSite')}
            <select
              value={scope.id}
              onChange={(e) => {
                const next = BUILT_IN_SCOPES.find((s) => s.id === e.target.value);
                if (next) setScope(next);
              }}
            >
              {BUILT_IN_SCOPES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.hosts.join(', ')} + subdomains)
                </option>
              ))}
            </select>
          </label>
          <span className="meta">
            {liveCount === null
              ? t('eoCountingLive')
              : t('eoLiveCount', [String(liveCount), scope.label])}
          </span>
        </div>
      </section>

      <section className="panel">
        <h2>{t('eoSaveHeading')}</h2>
        <p className="panel-lead">{t('eoSaveLede', scope.label)}</p>
        <form onSubmit={handleSave}>
          <div className="row">
            <label className="field">
              {t('eoProfileName')}
              <input
                type="text"
                placeholder={t('eoProfileNamePlaceholder')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={64}
                required
              />
            </label>
            <button
              type="submit"
              className="primary"
              disabled={busy !== null || newName.trim().length === 0}
            >
              {busy === 'save' ? t('eoSavingProfile') : t('eoSaveProfile')}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>{t('eoProfilesHeading')}</h2>
        <p className="panel-lead">
          {profiles.length === 0
            ? t('eoNoProfilesYet')
            : t('eoProfilesCount', String(profiles.length))}
        </p>
        {scopeProfiles.length === 0 ? (
          <p className="empty">{t('eoNoProfilesScope')}</p>
        ) : (
          <ul className="profile-list">
            {scopeProfiles.map((p) => (
              <li key={p.id}>
                <span className="name" title={p.name}>
                  {p.name}
                </span>
                <span className="meta">{t('eoProfileCookies', String(p.cookies.length))}</span>
                <span className="meta">{formatRelative(p.updatedAt)}</span>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setPendingSwitch(p)}
                  disabled={busy !== null}
                >
                  {busy === p.id ? t('eoProfileSwitching') : t('eoProfileSwitch')}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => setPendingDelete(p)}
                  disabled={busy !== null}
                >
                  {t('eoProfileDelete')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {banner ? (
          <div className={`banner ${banner.kind}`}>
            <span>{banner.message}</span>
            {banner.kind === 'success' && banner.reloadCount && banner.reloadCount > 0 ? (
              <>
                <span className="spacer" />
                <span className="meta">{t('eoTabsNeedRefresh', String(banner.reloadCount))}</span>
                <button
                  type="button"
                  onClick={() => void handleReloadTabs()}
                  disabled={busy !== null}
                >
                  {t('eoReloadTabs')}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>{t('eoSafetyHeading')}</h2>
        <ul className="warn-list">
          <li>{t('eoSafety1')}</li>
          <li>{t('eoSafety2', scope.label)}</li>
          <li>{t('eoSafety3')}</li>
        </ul>
      </section>

      <ConfirmDialog
        open={pendingSwitch !== null}
        title={t('eoSwitchProfileTitle')}
        message={
          pendingSwitch ? t('eoSwitchProfileMessage', [pendingSwitch.name, scope.label]) : ''
        }
        confirmLabel={t('eoSwitchConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          const p = pendingSwitch;
          setPendingSwitch(null);
          if (p) void handleSwitch(p);
        }}
        onCancel={() => setPendingSwitch(null)}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('eoDeleteProfileTitle')}
        message={pendingDelete ? t('eoDeleteProfileMessage', pendingDelete.name) : ''}
        confirmLabel={t('eoDeleteConfirm')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => {
          const p = pendingDelete;
          setPendingDelete(null);
          if (p) void handleDelete(p);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const delta = Date.now() - t;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (delta < min) return 'just now';
  if (delta < hr) return `${Math.floor(delta / min)}m ago`;
  if (delta < day) return `${Math.floor(delta / hr)}h ago`;
  return `${Math.floor(delta / day)}d ago`;
}

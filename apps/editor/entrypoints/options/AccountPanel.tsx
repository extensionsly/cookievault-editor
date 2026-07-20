import { browser, type Browser } from 'wxt/browser';
import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n.js';
import {
  ACCOUNT_SESSION_KEY,
  getSession,
  requestCode,
  signOut,
  signIn as signInExtensionsly,
  type Session,
} from '../../lib/pro/account.js';
import {
  keepMine,
  loadSyncState,
  syncNow,
  takeTheirs,
  type SyncResult,
  type SyncState,
} from '../../lib/sync-state.js';
import { loadVault } from '../../lib/profile-store.js';
import { isNetworkError } from '../../lib/http.js';
import { TELEMETRY_OPT_IN_KEY, getTelemetryOptIn, setTelemetryOptIn } from '../../lib/telemetry.js';
import { buildUpgradeUrl } from '../../lib/checkout.js';

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return t('justNow');
  if (diff < 3_600_000) return t('minutesAgo', String(Math.floor(diff / 60_000)));
  if (diff < 86_400_000) return t('hoursAgo', String(Math.floor(diff / 3_600_000)));
  return new Date(ms).toLocaleDateString();
}

type SignInState =
  | {
      kind: 'signed-out';
      email: string;
      status: 'idle' | 'sending' | 'sent';
      code: string;
      verifying: boolean;
      error?: string;
    }
  | { kind: 'signed-in'; auth: Session };

const SIGNED_OUT: SignInState = {
  kind: 'signed-out',
  email: '',
  status: 'idle',
  code: '',
  verifying: false,
};

export function AccountPanel() {
  const [signIn, setSignIn] = useState<SignInState>(SIGNED_OUT);
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [telemetryOptIn, setTelemetryOptInState] = useState(false);
  // The local vault in memory is stale after a remote pull / "Take theirs"
  // until the page reloads and re-reads browser.storage. Surface a reload CTA.
  const [needsReload, setNeedsReload] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [auth, state, optIn] = await Promise.all([
        getSession(),
        loadSyncState(),
        getTelemetryOptIn(),
      ]);
      if (!alive) return;
      if (auth) setSignIn({ kind: 'signed-in', auth });
      setSyncState(state);
      setTelemetryOptInState(optIn);
    })();
    const handler = (
      changes: { [k: string]: Browser.storage.StorageChange },
      area: Browser.storage.AreaName,
    ) => {
      if (area !== 'local') return;
      if (changes[ACCOUNT_SESSION_KEY]) {
        void getSession().then((auth) => {
          if (!alive) return;
          setSignIn(auth ? { kind: 'signed-in', auth } : SIGNED_OUT);
        });
      }
      if (changes[STATE_KEY]) {
        void loadSyncState().then((s) => alive && setSyncState(s));
      }
      if (changes[TELEMETRY_OPT_IN_KEY]) {
        void getTelemetryOptIn().then((o) => alive && setTelemetryOptInState(o));
      }
    };
    browser.storage.onChanged.addListener(handler);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(handler);
    };
  }, []);

  const onSubmitEmail = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (signIn.kind !== 'signed-out') return;
      setSignIn({ ...signIn, status: 'sending', error: undefined });
      try {
        const result = await requestCode(signIn.email);
        if (!result.ok) throw new Error(result.error || 'request_failed');
        setSignIn({ ...signIn, status: 'sent', code: '', verifying: false });
      } catch (err) {
        setSignIn({
          ...signIn,
          status: 'idle',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [signIn],
  );

  const onSubmitCode = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (signIn.kind !== 'signed-out' || !signIn.code.trim()) return;
      setSignIn({ ...signIn, verifying: true, error: undefined });
      try {
        const result = await signInExtensionsly(signIn.email, signIn.code.trim());
        if (!result.ok) throw new Error(result.error || 'verify_failed');
        const auth = await getSession();
        if (!auth) throw new Error('session_unavailable');
        setSignIn({ kind: 'signed-in', auth });
      } catch (err) {
        setSignIn({
          ...signIn,
          verifying: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [signIn],
  );

  const onSignOut = useCallback(async () => {
    await signOut();
    setSignIn(SIGNED_OUT);
    setSyncState(null);
    setLastResult(null);
  }, []);

  const onSyncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await syncNow();
      setLastResult(r);
      setSyncState(await loadSyncState());
      if (r.kind === 'pulled') setNeedsReload(true);
    } finally {
      setSyncing(false);
    }
  }, []);

  const onKeepMine = useCallback(async () => {
    const vault = await loadVault();
    if (!vault) return;
    setSyncing(true);
    try {
      await keepMine(vault);
      setLastResult({ kind: 'pushed-fresh', etag: 'updated' });
      setSyncState(await loadSyncState());
    } catch (err) {
      setLastResult(
        isNetworkError(err)
          ? { kind: 'offline' }
          : { kind: 'transport-error', message: err instanceof Error ? err.message : String(err) },
      );
    } finally {
      setSyncing(false);
    }
  }, []);

  const onTakeTheirs = useCallback(async () => {
    setSyncing(true);
    try {
      await takeTheirs();
      setLastResult({ kind: 'synced' });
      setSyncState(await loadSyncState());
      // The locally-stored vault is unchanged by sync-state alone; the user
      // must reload the page to re-read the pulled ciphertext. Surface a
      // prominent reload CTA rather than a silent "Up to date".
      setNeedsReload(true);
    } catch (err) {
      setLastResult(
        isNetworkError(err)
          ? { kind: 'offline' }
          : { kind: 'transport-error', message: err instanceof Error ? err.message : String(err) },
      );
    } finally {
      setSyncing(false);
    }
  }, []);

  const onToggleTelemetry = useCallback(async (next: boolean) => {
    setTelemetryOptInState(next);
    await setTelemetryOptIn(next);
  }, []);

  return (
    <section className="panel">
      <h2>{t('apAccount')}</h2>
      {signIn.kind === 'signed-out' ? (
        <>
          <p className="panel-lead">{t('apSignInLede')}</p>
          <form onSubmit={onSubmitEmail}>
            <div className="row">
              <label className="field">
                {t('apEmail')}
                <input
                  type="email"
                  required
                  value={signIn.email}
                  onChange={(e) =>
                    setSignIn({ ...signIn, email: e.target.value, error: undefined })
                  }
                  disabled={signIn.status !== 'idle' && signIn.status !== 'sent'}
                  autoComplete="email"
                />
              </label>
              <button type="submit" className="primary" disabled={signIn.status === 'sending'}>
                {signIn.status === 'sending' ? t('apSending') : t('apSendMagicLink')}
              </button>
            </div>
          </form>
          {signIn.status === 'sent' ? (
            <>
              <div className="banner success" role="status">
                {t('apMagicSent')}
              </div>
              <form onSubmit={onSubmitCode}>
                <div className="row">
                  <label className="field">
                    {t('apCodeLabel')}
                    <input
                      type="text"
                      required
                      value={signIn.code}
                      onChange={(e) =>
                        setSignIn({ ...signIn, code: e.target.value, error: undefined })
                      }
                      disabled={signIn.verifying}
                      autoComplete="one-time-code"
                    />
                  </label>
                  <button
                    type="submit"
                    className="primary"
                    disabled={signIn.verifying || !signIn.code.trim()}
                  >
                    {signIn.verifying ? t('apVerifying') : t('apVerifyCode')}
                  </button>
                </div>
              </form>
            </>
          ) : null}
          {signIn.error ? (
            <p className="note" style={{ color: 'var(--danger)' }}>
              {signIn.error}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="panel-lead">
            {t('apSignedInAs')} <strong>{signIn.auth.email}</strong>
          </p>
          <div className="row">
            <button
              type="button"
              className="primary"
              onClick={() => void onSyncNow()}
              disabled={syncing}
            >
              {syncing ? t('apSyncing') : t('apSyncNow')}
            </button>
            <button type="button" onClick={() => void onSignOut()} disabled={syncing}>
              {t('apSignOut')}
            </button>
            <span className="spacer" />
            <span
              className="meta"
              title={
                syncState?.lastSyncedAt
                  ? new Date(syncState.lastSyncedAt).toLocaleString()
                  : undefined
              }
            >
              {syncState?.lastSyncedAt
                ? t('apLastSynced', relativeTime(syncState.lastSyncedAt))
                : t('apNotSynced')}
            </span>
          </div>
          {needsReload ? (
            <div className="banner success" role="status">
              <span>{t('apReloadBanner')}</span>
              <span className="spacer" />
              <button type="button" className="primary" onClick={() => window.location.reload()}>
                {t('apReload')}
              </button>
            </div>
          ) : null}
          {syncState?.conflictRemoteSha256Hint ? (
            <div className="banner error" role="alert">
              <span>{t('apConflict')}</span>
              <span className="spacer" />
              <button
                type="button"
                onClick={() => void onKeepMine()}
                disabled={syncing}
                title={t('apKeepMineTitle')}
              >
                {t('apKeepMine')}
              </button>
              <button
                type="button"
                onClick={() => void onTakeTheirs()}
                disabled={syncing}
                title={t('apTakeTheirsTitle')}
              >
                {t('apTakeTheirs')}
              </button>
            </div>
          ) : null}
          {lastResult ? (
            <p className="note" role="status">
              {lastResult.kind === 'synced' && t('apResultSynced')}
              {lastResult.kind === 'pushed-fresh' && t('apResultPushed')}
              {lastResult.kind === 'pulled' && t('apResultPulled')}
              {lastResult.kind === 'no-auth' && t('apResultNoAuth')}
              {lastResult.kind === 'pro-required' && (
                <>
                  {t('apResultProRequired')}{' '}
                  <a
                    href={buildUpgradeUrl({
                      feature: 'cloud-sync',
                      source: 'editor-sync',
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('apUpgrade')}
                  </a>
                </>
              )}
              {lastResult.kind === 'conflict' && t('apResultConflict')}
              {lastResult.kind === 'offline' && t('apResultOffline')}
              {lastResult.kind === 'transport-error' && t('apResultError', lastResult.message)}
            </p>
          ) : null}
        </>
      )}
      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />
      <div className="row">
        <label className="checkbox-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={telemetryOptIn}
            onChange={(e) => void onToggleTelemetry(e.target.checked)}
          />
          <span>
            {t('apTelemetry')}{' '}
            <a href="https://cookievault.net/privacy" target="_blank" rel="noopener noreferrer">
              {t('apHowThisWorks')}
            </a>
            .
          </span>
        </label>
      </div>
    </section>
  );
}

const STATE_KEY = 'cookievault.sync.state.v1';

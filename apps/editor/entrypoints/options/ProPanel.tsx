/**
 * Pro licensing panel — the UI for both entitlement channels (ADR-0015):
 *
 *   · offline license key: paste → verify signature locally → activate
 *     (the four verification error reasons map 1:1 to i18n messages);
 *   · extensionsly account: email code sign-in → server-signed entitlement
 *     credential (verified on every read by lib/pro/account).
 *
 * Deliberately separate from AccountPanel: that panel is the CookieVault
 * *sync* account (vault identity), this one is the extensionsly *billing*
 * identity. The Pro badge reflects the dual-channel OR.
 */

import { browser } from 'wxt/browser';
import { useCallback, useEffect, useState } from 'react';
import { t } from '../../lib/i18n.js';
import {
  ACCOUNT_ENTITLEMENT_KEY,
  ACCOUNT_SESSION_KEY,
  getSession,
  refreshEntitlement,
  requestCode,
  signIn,
  signOut,
  startTrial,
  type Session,
} from '../../lib/pro/account.js';
import {
  LICENSE_STORAGE_KEY,
  activateLicense,
  deactivateLicense,
  getProStatus,
  getStoredLicense,
} from '../../lib/pro/entitlement.js';
import type { LicenseResult } from '../../lib/pro/license.js';
import { buildUpgradeUrl } from '../../lib/checkout.js';

function licenseErrorMessage(reason: NonNullable<LicenseResult['reason']>): string {
  switch (reason) {
    case 'format':
      return t('licErrFormat');
    case 'signature':
      return t('licErrSignature');
    case 'product':
      return t('licErrProduct');
    case 'expired':
      return t('licErrExpired');
    case 'revoked':
      return t('licErrRevoked');
  }
}

type AccountFormState = {
  email: string;
  code: string;
  status: 'idle' | 'sending' | 'sent' | 'verifying';
  error?: string;
};

const ACCOUNT_IDLE: AccountFormState = { email: '', code: '', status: 'idle' };

export function ProPanel() {
  const [pro, setPro] = useState(false);
  const [licenseStored, setLicenseStored] = useState(false);
  const [licenseInput, setLicenseInput] = useState('');
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [form, setForm] = useState<AccountFormState>(ACCOUNT_IDLE);
  const [trialing, setTrialing] = useState(false);
  const [trialNote, setTrialNote] = useState<string | null>(null);

  const rehydrate = useCallback(async () => {
    const [p, lic, s] = await Promise.all([getProStatus(), getStoredLicense(), getSession()]);
    setPro(p);
    setLicenseStored(lic != null);
    setSession(s);
  }, []);

  useEffect(() => {
    let alive = true;
    void rehydrate();
    // One-time cleanup of the pre-ADR-0015 plain-JSON entitlement cache — it
    // was an unauthenticated blob (LIC-01) and nothing reads it anymore.
    void browser.storage.local.remove('cookievault.entitlement.v1').catch(() => {});
    const handler = (changes: Record<string, unknown>) => {
      if (
        LICENSE_STORAGE_KEY in changes ||
        ACCOUNT_SESSION_KEY in changes ||
        ACCOUNT_ENTITLEMENT_KEY in changes
      ) {
        if (alive) void rehydrate();
      }
    };
    browser.storage.onChanged.addListener(handler);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(handler);
    };
  }, [rehydrate]);

  const onActivate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!licenseInput.trim()) return;
      setActivating(true);
      setLicenseError(null);
      try {
        const r = await activateLicense(licenseInput);
        if (r.valid) {
          setLicenseInput('');
          await rehydrate();
        } else {
          setLicenseError(licenseErrorMessage(r.reason ?? 'format'));
        }
      } finally {
        setActivating(false);
      }
    },
    [licenseInput, rehydrate],
  );

  const onDeactivate = useCallback(async () => {
    await deactivateLicense();
    await rehydrate();
  }, [rehydrate]);

  const onSendCode = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setForm((f) => ({ ...f, status: 'sending', error: undefined }));
      const r = await requestCode(form.email);
      setForm((f) =>
        r.ok
          ? { ...f, status: 'sent', code: '' }
          : { ...f, status: 'idle', error: t('exSignInFailed', r.error ?? '') },
      );
    },
    [form.email],
  );

  const onSignIn = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!form.code.trim()) return;
      setForm((f) => ({ ...f, status: 'verifying', error: undefined }));
      const r = await signIn(form.email, form.code.trim());
      if (r.ok) {
        setForm(ACCOUNT_IDLE);
        await rehydrate();
      } else {
        setForm((f) => ({ ...f, status: 'sent', error: t('exSignInFailed', r.error ?? '') }));
      }
    },
    [form.email, form.code, rehydrate],
  );

  const onSignOut = useCallback(async () => {
    await signOut();
    await rehydrate();
  }, [rehydrate]);

  const onRefreshEnt = useCallback(async () => {
    await refreshEntitlement();
    await rehydrate();
  }, [rehydrate]);

  const onStartTrial = useCallback(async () => {
    setTrialing(true);
    setTrialNote(null);
    try {
      const r = await startTrial();
      if (!r.ok) {
        setTrialNote(t('exTrialError', r.error ?? ''));
      } else if (r.started) {
        setTrialNote(t('exTrialStarted'));
      } else {
        // Account already consumed its one lifetime trial (server-authoritative).
        setTrialNote(t('exTrialUsed'));
      }
      await rehydrate();
    } finally {
      setTrialing(false);
    }
  }, [rehydrate]);

  return (
    <section className="panel">
      <h2>{t('licSection')}</h2>
      <p className="panel-lead">
        <strong>{pro ? t('apPlanPro') : t('apPlanFree')}</strong> {t('apPlanLabel')}
        {!pro ? (
          <>
            {' — '}
            <a
              href={buildUpgradeUrl({ source: 'editor-pro-panel' })}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('apUpgrade')}
            </a>
          </>
        ) : null}
      </p>
      <p className="note">{t('licLede')}</p>

      {licenseStored ? (
        <div className="row">
          <span className="meta">✓ {t('licActive')}</span>
          <span className="spacer" />
          <button type="button" onClick={() => void onDeactivate()}>
            {t('licDeactivate')}
          </button>
        </div>
      ) : (
        <form onSubmit={onActivate}>
          <div className="row">
            <label className="field">
              {t('licKeyLabel')}
              <input
                type="text"
                value={licenseInput}
                onChange={(e) => {
                  setLicenseInput(e.target.value);
                  setLicenseError(null);
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button type="submit" className="primary" disabled={activating || !licenseInput.trim()}>
              {activating ? t('apVerifying') : t('licActivate')}
            </button>
          </div>
        </form>
      )}
      {licenseError ? (
        <p className="note" role="alert" style={{ color: 'var(--danger)' }}>
          {licenseError}
        </p>
      ) : null}

      <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0' }} />
      <h3>{t('exAccount')}</h3>
      {session ? (
        <>
          <div className="row">
            <span className="meta">
              {t('apSignedInAs')} <strong>{session.email}</strong>
            </span>
            <span className="spacer" />
            {/* Trial is server-side + account-bound (§3.4): shown only to a
                signed-in, non-Pro account. A used trial reports back via note. */}
            {!pro ? (
              <button type="button" onClick={() => void onStartTrial()} disabled={trialing}>
                {trialing ? t('exTrialStarting') : t('exStartTrial')}
              </button>
            ) : null}
            <button type="button" onClick={() => void onRefreshEnt()}>
              {t('exRefreshEnt')}
            </button>
            <button type="button" onClick={() => void onSignOut()}>
              {t('apSignOut')}
            </button>
          </div>
          {trialNote ? (
            <p className="note" role="status">
              {trialNote}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="note">{t('exLede')}</p>
          <form onSubmit={onSendCode}>
            <div className="row">
              <label className="field">
                {t('apEmail')}
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  disabled={form.status === 'sending' || form.status === 'verifying'}
                  autoComplete="email"
                />
              </label>
              <button type="submit" className="primary" disabled={form.status === 'sending'}>
                {form.status === 'sending' ? t('apSending') : t('exSendCode')}
              </button>
            </div>
          </form>
          {form.status === 'sent' || form.status === 'verifying' ? (
            <>
              <div className="banner success" role="status">
                {t('exCodeSent')}
              </div>
              <form onSubmit={onSignIn}>
                <div className="row">
                  <label className="field">
                    {t('apCodeLabel')}
                    <input
                      type="text"
                      required
                      value={form.code}
                      onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                      disabled={form.status === 'verifying'}
                      autoComplete="one-time-code"
                    />
                  </label>
                  <button
                    type="submit"
                    className="primary"
                    disabled={form.status === 'verifying' || !form.code.trim()}
                  >
                    {form.status === 'verifying' ? t('apVerifying') : t('apVerifyCode')}
                  </button>
                </div>
              </form>
            </>
          ) : null}
          {form.error ? (
            <p className="note" role="alert" style={{ color: 'var(--danger)' }}>
              {form.error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

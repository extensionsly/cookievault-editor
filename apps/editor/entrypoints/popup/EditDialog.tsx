import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { t } from '../../lib/i18n.js';
import type { Cookie, SameSite } from '@cookievault/shared/schema';

interface Props {
  /** Non-null when the dialog should be open, seeded with this cookie. */
  cookie: Cookie | null;
  onCancel: () => void;
  onSave: (updated: Cookie) => Promise<void> | void;
}

const SAME_SITE_OPTIONS: SameSite[] = ['unspecified', 'no_restriction', 'lax', 'strict'];

function toDateTimeLocal(unix: number): string {
  const d = new Date(unix * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocal(s: string): number {
  return Math.floor(new Date(s).getTime() / 1000);
}

/**
 * Field-level validation run before save, so the user gets a specific
 * message instead of the generic failure `chrome.cookies.set` throws.
 * Returns an i18n message key, or null when the draft is writable.
 * Mirrors the browser's own __Host-/__Secure- prefix rules (which the
 * cleanup engine already understands) plus basic name/domain/expiry sanity.
 */
function validationError(c: Cookie): string | null {
  if (/[\s;=]/.test(c.name)) return 'errNameFormat';
  if (c.domain.length === 0 || /\s/.test(c.domain) || c.domain.includes('://')) {
    return 'errDomainFormat';
  }
  if (c.name.startsWith('__Host-')) {
    if (!c.secure || c.path !== '/' || !c.hostOnly) return 'errHostPrefix';
  } else if (c.name.startsWith('__Secure-')) {
    if (!c.secure) return 'errSecurePrefix';
  }
  if (!c.session && (c.expirationDate === undefined || !Number.isFinite(c.expirationDate))) {
    return 'errExpiryInvalid';
  }
  return null;
}

export function EditDialog({ cookie, onCancel, onSave }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Cookie | null>(cookie);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();

  useEffect(() => {
    setDraft(cookie);
    setError(null);
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (cookie) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [cookie]);

  if (!draft) return <dialog ref={dialogRef} className="edit-dialog" />;

  function patch<K extends keyof Cookie>(key: K, value: Cookie[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const code = validationError(draft);
    if (code) {
      setError(t(code));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const expirationLocal =
    !draft.session && draft.expirationDate !== undefined
      ? toDateTimeLocal(draft.expirationDate)
      : '';

  return (
    <dialog ref={dialogRef} className="edit-dialog" onClose={onCancel}>
      <form id={formId} onSubmit={handleSubmit}>
        <header>
          <h2>{t('editCookieTitle')}</h2>
          <button type="button" className="icon" onClick={onCancel} aria-label={t('close')}>
            ✕
          </button>
        </header>
        <fieldset disabled={saving}>
          <label>
            {t('fieldName')}
            <input
              type="text"
              required
              autoFocus
              value={draft.name}
              onChange={(e) => patch('name', e.target.value)}
            />
          </label>
          <label>
            {t('fieldDomain')}
            <input
              type="text"
              required
              value={draft.domain}
              onChange={(e) => patch('domain', e.target.value)}
            />
          </label>
          <label>
            {t('fieldPath')}
            <input
              type="text"
              required
              value={draft.path}
              onChange={(e) => patch('path', e.target.value)}
            />
          </label>
          <label>
            {t('fieldValue')}
            <textarea
              rows={3}
              value={draft.value}
              onChange={(e) => patch('value', e.target.value)}
            />
          </label>
          <label>
            {t('fieldSameSite')}
            <select
              value={draft.sameSite}
              onChange={(e) => patch('sameSite', e.target.value as SameSite)}
            >
              {SAME_SITE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <div className="flag-grid">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.secure}
                onChange={(e) => patch('secure', e.target.checked)}
              />
              {t('checkSecure')}
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.httpOnly}
                onChange={(e) => patch('httpOnly', e.target.checked)}
              />
              {t('checkHttpOnly')}
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={draft.hostOnly}
                onChange={(e) => patch('hostOnly', e.target.checked)}
              />
              {t('checkHostOnly')}
            </label>
          </div>
          <fieldset className="expiry">
            <legend>{t('expiryLegend')}</legend>
            <label className="checkbox-row">
              <input
                type="radio"
                name="expiry-mode"
                checked={draft.session}
                onChange={() =>
                  setDraft((p) => (p ? { ...p, session: true, expirationDate: undefined } : p))
                }
              />
              {t('expirySession')}
            </label>
            <label className="checkbox-row">
              <input
                type="radio"
                name="expiry-mode"
                checked={!draft.session}
                onChange={() =>
                  setDraft((p) =>
                    p
                      ? {
                          ...p,
                          session: false,
                          expirationDate:
                            p.expirationDate ?? Math.floor(Date.now() / 1000) + 86_400 * 30,
                        }
                      : p,
                  )
                }
              />
              {t('expiryUntil')}
            </label>
            {!draft.session ? (
              <>
                <input
                  type="datetime-local"
                  aria-describedby={`${formId}-tz`}
                  value={expirationLocal}
                  onChange={(e) => patch('expirationDate', fromDateTimeLocal(e.target.value))}
                />
                <small id={`${formId}-tz`} className="hint">
                  {t('timezoneHint')}
                </small>
              </>
            ) : null}
          </fieldset>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>
        <footer>
          <button type="button" onClick={onCancel} disabled={saving}>
            {t('cancel')}
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? t('saving') : t('buttonSave')}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

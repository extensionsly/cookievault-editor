/**
 * Storage facade for the encrypted profile vault.
 *
 *   - `browser.storage.local`   → the ciphertext envelope (`EncryptedVault`).
 *   - `browser.storage.session` → the raw AES-GCM key bytes, RAM-only,
 *                                wiped on browser restart. This is the
 *                                same security posture as "key in
 *                                Service Worker memory" (security-model.md
 *                                §7) — `storage.session` is shared between
 *                                the SW and extension pages so the user
 *                                only re-enters their passphrase once per
 *                                browser session.
 *
 * Plaintext business data NEVER lands in `browser.storage.local`.
 */

import { browser } from 'wxt/browser';
import {
  EMPTY as EMPTY_RATE_LIMIT,
  EncryptedVaultSchema,
  type EncryptedVault,
  type Profile,
  type RateLimitState,
  RateLimitStateSchema,
  createVault,
  decryptVault,
  deriveKeyForVault,
  exportAesGcmKeyRaw,
  fromBase64Url,
  importAesGcmKeyRaw,
  repackVault,
  toBase64Url,
} from '@cookievault/shared';

const VAULT_KEY = 'cookievault.profileVault.v1';
const SESSION_KEY = 'cookievault.profileVault.session';
const RATE_LIMIT_KEY = 'cookievault.profileVault.rateLimit.v1';

interface SessionEntry {
  /** Raw AES-GCM key, base64url-encoded. RAM-only via storage.session. */
  keyB64: string;
}

export async function loadVault(): Promise<EncryptedVault | null> {
  const r = await browser.storage.local.get(VAULT_KEY);
  const raw = r[VAULT_KEY];
  if (raw === undefined) return null;
  const parsed = EncryptedVaultSchema.safeParse(raw);
  if (!parsed.success) {
    // Refuse to overwrite an unrecognised blob — the user's data may
    // be a future version we don't know how to read.
    throw new Error('Stored profile vault is malformed or from an unsupported version.');
  }
  return parsed.data;
}

async function saveVaultRaw(v: EncryptedVault): Promise<void> {
  await browser.storage.local.set({ [VAULT_KEY]: v });
}

async function persistSessionKey(key: CryptoKey): Promise<void> {
  const raw = await exportAesGcmKeyRaw(key);
  const entry: SessionEntry = { keyB64: toBase64Url(raw) };
  await browser.storage.session.set({ [SESSION_KEY]: entry });
}

export async function getSessionKey(): Promise<CryptoKey | null> {
  const r = await browser.storage.session.get(SESSION_KEY);
  const entry = r[SESSION_KEY] as SessionEntry | undefined;
  if (!entry) return null;
  const raw = fromBase64Url(entry.keyB64);
  return importAesGcmKeyRaw(raw, true);
}

export async function isUnlocked(): Promise<boolean> {
  const r = await browser.storage.session.get(SESSION_KEY);
  return r[SESSION_KEY] !== undefined;
}

export async function lock(): Promise<void> {
  await browser.storage.session.remove(SESSION_KEY);
}

/**
 * Wipe the vault entirely. Used by the "Reset vault" path — there is
 * no recovery (zero-knowledge); the UI must double-confirm.
 */
export async function resetVault(): Promise<void> {
  await browser.storage.local.remove(VAULT_KEY);
  await browser.storage.session.remove(SESSION_KEY);
  await clearRateLimit();
}

export async function initialiseVault(passphrase: string): Promise<CryptoKey> {
  const existing = await loadVault();
  if (existing) {
    throw new Error('A vault already exists. Reset it first if you want to start over.');
  }
  const { vault, key } = await createVault(passphrase, true);
  await saveVaultRaw(vault);
  await persistSessionKey(key);
  await clearRateLimit();
  return key;
}

export interface UnlockResult {
  key: CryptoKey;
  profiles: Profile[];
}

export async function unlockVault(passphrase: string): Promise<UnlockResult> {
  const vault = await loadVault();
  if (!vault) throw new Error('No vault to unlock — initialise one first.');
  const key = await deriveKeyForVault(vault, passphrase, true);
  // decryptVault throws InvalidPassphraseError on wrong passphrase.
  // The caller (UnlockPanel) is responsible for catching that and
  // calling recordFailure + saveRateLimit; on success we clear here.
  const body = await decryptVault(vault, key);
  await persistSessionKey(key);
  await clearRateLimit();
  return { key, profiles: body.profiles };
}

export async function readProfiles(key: CryptoKey): Promise<Profile[]> {
  const v = await loadVault();
  if (!v) throw new Error('Vault not initialised');
  const body = await decryptVault(v, key);
  return body.profiles;
}

export async function writeProfiles(key: CryptoKey, profiles: Profile[]): Promise<void> {
  const v = await loadVault();
  if (!v) throw new Error('Vault not initialised');
  const updated = await repackVault(v, key, profiles);
  await saveVaultRaw(updated);
  // Fire-and-forget sync. Failures (offline, unauthenticated, conflict)
  // surface as sync state — no UI block on the write path.
  void scheduleSyncIfAuthenticated();
}

async function scheduleSyncIfAuthenticated(): Promise<void> {
  try {
    const { loadPersistedAuth } = await import('./auth.js');
    const auth = await loadPersistedAuth();
    if (!auth) return;
    const { scheduleSync } = await import('./sync-state.js');
    scheduleSync();
  } catch {
    // No-op — sync is best-effort.
  }
}

/**
 * Rate-limit state for wrong-passphrase attempts. Lives in
 * `browser.storage.session` — survives Service Worker restarts but
 * resets on browser quit. Counted in shared/profile/rate-limit.ts.
 */
export async function loadRateLimit(): Promise<RateLimitState> {
  const r = await browser.storage.session.get(RATE_LIMIT_KEY);
  const raw = r[RATE_LIMIT_KEY];
  if (raw === undefined) return EMPTY_RATE_LIMIT;
  const parsed = RateLimitStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_RATE_LIMIT;
}

export async function saveRateLimit(state: RateLimitState): Promise<void> {
  await browser.storage.session.set({ [RATE_LIMIT_KEY]: state });
}

export async function clearRateLimit(): Promise<void> {
  await browser.storage.session.remove(RATE_LIMIT_KEY);
}

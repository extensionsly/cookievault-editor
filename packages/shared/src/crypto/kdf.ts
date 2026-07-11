/**
 * PBKDF2 master-key derivation.
 *
 * Algorithm and parameters locked by ADR-0006:
 *   - PBKDF2-SHA256
 *   - 600_000 iterations (OWASP 2025 baseline)
 *   - 32-byte random salt per user (stored server-side, public)
 *   - Derives a 32-byte AES-GCM CryptoKey, non-extractable
 *
 * The derived key is held in Service Worker memory only. It never
 * leaves the device, never lands on disk, never lands on a server.
 *
 * If you change iterations or the algorithm here, you also break every
 * existing user's saved data unless you ship a migration path. Open an
 * ADR amendment first.
 */
export const PBKDF2_ITERATIONS = 600_000;
export const SALT_BYTES = 32;
export const KEY_BITS = 256;

/**
 * Derive an AES-GCM key from a password + salt.
 *
 * @param password User-supplied passphrase. Must not be empty.
 * @param salt Per-user salt, exactly {@link SALT_BYTES} bytes.
 * @param extractable Default `false` (ADR-0006). The profile-vault
 *   session cache passes `true` so the raw key bytes can be exported
 *   into `chrome.storage.session` (RAM-only) to survive Service Worker
 *   restarts without re-prompting the user every 30 seconds. Never
 *   export an extractable key onto disk.
 */
export async function deriveMasterKey(
  password: string,
  salt: BufferSource,
  extractable = false,
): Promise<CryptoKey> {
  if (password.length === 0) {
    throw new Error('deriveMasterKey: password must not be empty');
  }
  if (salt.byteLength !== SALT_BYTES) {
    throw new Error(`deriveMasterKey: salt must be ${SALT_BYTES} bytes, got ${salt.byteLength}`);
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_BITS },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

/** Fresh CSPRNG salt sized for {@link deriveMasterKey}. */
export function generateSalt(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

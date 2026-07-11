/**
 * AES-256-GCM authenticated encryption.
 *
 * Algorithm locked by ADR-0006. Each call generates a fresh 96-bit IV;
 * callers MUST persist the IV alongside the ciphertext, and MUST pass
 * the same `additionalData` (if any) at decrypt time.
 *
 * The optional `additionalData` parameter is for AEAD context binding —
 * e.g. tie a ciphertext to `(userId, blobType, version)` so a swapped
 * blob fails authentication.
 */

const IV_BYTES = 12;

export interface CiphertextBlob {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
}

export async function encrypt(
  key: CryptoKey,
  plaintext: BufferSource,
  additionalData?: BufferSource,
): Promise<CiphertextBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const params: AesGcmParams = additionalData
    ? { name: 'AES-GCM', iv, additionalData }
    : { name: 'AES-GCM', iv };
  const buf = await crypto.subtle.encrypt(params, key, plaintext);
  return { iv, ciphertext: new Uint8Array(buf) };
}

export async function decrypt(
  key: CryptoKey,
  blob: CiphertextBlob,
  additionalData?: BufferSource,
): Promise<Uint8Array<ArrayBuffer>> {
  if (blob.iv.byteLength !== IV_BYTES) {
    throw new Error(`decrypt: iv must be ${IV_BYTES} bytes, got ${blob.iv.byteLength}`);
  }
  const params: AesGcmParams = additionalData
    ? { name: 'AES-GCM', iv: blob.iv, additionalData }
    : { name: 'AES-GCM', iv: blob.iv };
  const buf = await crypto.subtle.decrypt(params, key, blob.ciphertext);
  return new Uint8Array(buf);
}

/** Convenience for the common JSON round-trip. */
export async function encryptJson<T>(
  key: CryptoKey,
  value: T,
  additionalData?: BufferSource,
): Promise<CiphertextBlob> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return encrypt(key, bytes, additionalData);
}

export async function decryptJson<T>(
  key: CryptoKey,
  blob: CiphertextBlob,
  additionalData?: BufferSource,
): Promise<T> {
  const bytes = await decrypt(key, blob, additionalData);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/**
 * Export an AES-GCM key's raw bytes. Only valid on an extractable key —
 * the profile-vault session cache derives with `extractable=true` so it
 * can round-trip the key through `chrome.storage.session` (RAM-only) and
 * survive Service Worker restarts. Never export a key onto disk.
 *
 * Exists so client code doesn't touch `crypto.subtle` directly (the
 * CLAUDE.md red-line keeps all Web Crypto behind this facade).
 */
export async function exportAesGcmKeyRaw(key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

/** Import raw bytes back into an AES-256-GCM key (see {@link exportAesGcmKeyRaw}). */
export async function importAesGcmKeyRaw(
  raw: BufferSource,
  extractable = true,
): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, extractable, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypted profile vault — pure crypto + serialisation only.
 *
 * One vault holds N profiles. The whole profile list is encrypted as a
 * single AES-256-GCM blob. AEAD additional data binds the ciphertext to
 * the vault format + version so a swapped blob fails authentication.
 *
 * Lives in @cookievault/shared (no `chrome.*`) so it can round-trip in
 * unit tests under Node's globalThis.crypto.subtle.
 */

import { z } from 'zod';
import { decrypt, encrypt } from '../crypto/aead.js';
import { PBKDF2_ITERATIONS, SALT_BYTES, deriveMasterKey, generateSalt } from '../crypto/kdf.js';
import { fromBase64Url, toBase64Url } from '../crypto/random.js';
import { ProfileSchema, type Profile } from '../schema/profile.js';

export const VAULT_FORMAT = 'cookievault.vault/v1';
export const VAULT_VERSION = 1;
const BODY_FORMAT = 'cookievault.vault.body/v1';

export const EncryptedBlobSchema = z
  .object({
    /** Base64URL-encoded 12-byte IV. */
    iv: z.string(),
    /** Base64URL-encoded ciphertext including the 16-byte GCM tag. */
    ct: z.string(),
  })
  .strict();
export type EncryptedBlob = z.infer<typeof EncryptedBlobSchema>;

export const EncryptedVaultSchema = z
  .object({
    format: z.literal(VAULT_FORMAT),
    version: z.literal(VAULT_VERSION),
    kdf: z
      .object({
        algo: z.literal('PBKDF2-SHA256'),
        iterations: z.number().int().positive(),
        salt: z.string(),
      })
      .strict(),
    body: EncryptedBlobSchema,
    updatedAt: z.string(),
  })
  .strict();
export type EncryptedVault = z.infer<typeof EncryptedVaultSchema>;

export const VaultBodySchema = z
  .object({
    format: z.literal(BODY_FORMAT),
    profiles: z.array(ProfileSchema),
  })
  .strict();
export type VaultBody = z.infer<typeof VaultBodySchema>;

/**
 * Surfaced when AES-GCM tag fails (wrong passphrase) OR the decrypted
 * body fails JSON / schema parse. We do not distinguish: both
 * indicate the same user-facing problem ("the vault could not be
 * opened") and leaking which case fired could help an attacker.
 */
export class InvalidPassphraseError extends Error {
  constructor() {
    super('Invalid passphrase or corrupted vault');
    this.name = 'InvalidPassphraseError';
  }
}

function aad(): Uint8Array<ArrayBuffer> {
  // `TextEncoder.encode` returns Uint8Array<ArrayBuffer>; the explicit
  // return type stops the generic from collapsing to ArrayBufferLike,
  // which the strict BufferSource definition rejects.
  return new TextEncoder().encode(`${VAULT_FORMAT}|${VAULT_VERSION}`);
}

async function encryptBody(key: CryptoKey, body: VaultBody): Promise<EncryptedBlob> {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const blob = await encrypt(key, bytes, aad());
  return { iv: toBase64Url(blob.iv), ct: toBase64Url(blob.ciphertext) };
}

/**
 * Initialise a fresh empty vault with a freshly generated salt. Returns
 * both the serialisable encrypted vault and the derived key for
 * immediate session caching (avoids a second PBKDF2 round).
 */
export async function createVault(
  passphrase: string,
  extractableKey = false,
): Promise<{ vault: EncryptedVault; key: CryptoKey }> {
  if (passphrase.length === 0) {
    throw new Error('createVault: passphrase must not be empty');
  }
  const salt = generateSalt();
  const key = await deriveMasterKey(passphrase, salt, extractableKey);
  const body: VaultBody = { format: BODY_FORMAT, profiles: [] };
  const blob = await encryptBody(key, body);
  const vault: EncryptedVault = {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    kdf: {
      algo: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: toBase64Url(salt),
    },
    body: blob,
    updatedAt: new Date().toISOString(),
  };
  return { vault, key };
}

/** Derive the AES-GCM key for an existing vault. Does NOT verify the passphrase. */
export async function deriveKeyForVault(
  vault: EncryptedVault,
  passphrase: string,
  extractableKey = false,
): Promise<CryptoKey> {
  const salt = fromBase64Url(vault.kdf.salt);
  if (salt.byteLength !== SALT_BYTES) {
    throw new Error('deriveKeyForVault: stored salt length mismatch');
  }
  return deriveMasterKey(passphrase, salt, extractableKey);
}

/**
 * Decrypt the body and validate. Throws {@link InvalidPassphraseError}
 * on any failure (wrong passphrase, tampered ciphertext, malformed
 * JSON, schema mismatch).
 */
export async function decryptVault(vault: EncryptedVault, key: CryptoKey): Promise<VaultBody> {
  try {
    const iv = fromBase64Url(vault.body.iv);
    const ciphertext = fromBase64Url(vault.body.ct);
    const buf = await decrypt(key, { iv, ciphertext }, aad());
    const text = new TextDecoder().decode(buf);
    const json = JSON.parse(text);
    return VaultBodySchema.parse(json);
  } catch {
    throw new InvalidPassphraseError();
  }
}

/**
 * Re-encrypt a replacement profile list, reusing the existing KDF salt
 * + iterations (key has not changed). Bumps `updatedAt`.
 */
export async function repackVault(
  prev: EncryptedVault,
  key: CryptoKey,
  profiles: Profile[],
): Promise<EncryptedVault> {
  const body: VaultBody = { format: BODY_FORMAT, profiles };
  const blob = await encryptBody(key, body);
  return {
    ...prev,
    body: blob,
    updatedAt: new Date().toISOString(),
  };
}

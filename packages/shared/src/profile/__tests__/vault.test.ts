import { describe, expect, it } from 'vitest';
import type { Profile } from '../../schema/profile.js';
import {
  EncryptedVaultSchema,
  InvalidPassphraseError,
  createVault,
  decryptVault,
  deriveKeyForVault,
  repackVault,
} from '../vault.js';

function newProfile(name: string): Profile {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    cookies: [
      {
        name: 'c_user',
        value: '12345',
        domain: '.facebook.com',
        hostOnly: false,
        path: '/',
        secure: true,
        httpOnly: false,
        sameSite: 'lax',
        session: false,
        expirationDate: 9_999_999_999,
      },
    ],
  };
}

describe('vault round-trip', () => {
  it('createVault produces a schema-valid envelope', async () => {
    const { vault } = await createVault('correct horse battery staple');
    expect(EncryptedVaultSchema.safeParse(vault).success).toBe(true);
    expect(vault.format).toBe('cookievault.vault/v1');
    expect(vault.version).toBe(1);
    expect(vault.kdf.algo).toBe('PBKDF2-SHA256');
  });

  it('decryptVault returns empty profile list for fresh vault', async () => {
    const { vault, key } = await createVault('pw');
    const body = await decryptVault(vault, key);
    expect(body.profiles).toEqual([]);
  });

  it('repackVault round-trips profiles', async () => {
    const { vault, key } = await createVault('pw');
    const p = newProfile('Test FB Account');
    const updated = await repackVault(vault, key, [p]);
    const body = await decryptVault(updated, key);
    expect(body.profiles).toHaveLength(1);
    expect(body.profiles[0]?.name).toBe('Test FB Account');
    expect(body.profiles[0]?.cookies[0]?.value).toBe('12345');
  });

  it('rejects wrong passphrase', async () => {
    const { vault } = await createVault('right');
    const wrongKey = await deriveKeyForVault(vault, 'wrong');
    await expect(decryptVault(vault, wrongKey)).rejects.toBeInstanceOf(InvalidPassphraseError);
  });

  it('rejects tampered ciphertext', async () => {
    const { vault, key } = await createVault('pw');
    // Flip a byte in the base64url ciphertext (preserve length).
    const ct = vault.body.ct;
    const flippedChar = ct[0] === 'A' ? 'B' : 'A';
    const tampered = { ...vault, body: { ...vault.body, ct: flippedChar + ct.slice(1) } };
    await expect(decryptVault(tampered, key)).rejects.toBeInstanceOf(InvalidPassphraseError);
  });

  it('rejects ciphertext from a different vault format binding', async () => {
    // Two vaults with the same passphrase but different salts have different
    // keys; the body from vault A must not decrypt under vault B's key.
    const { vault: a } = await createVault('pw');
    const { vault: b, key: keyB } = await createVault('pw');
    const swapped = { ...b, body: a.body };
    await expect(decryptVault(swapped, keyB)).rejects.toBeInstanceOf(InvalidPassphraseError);
  });

  it('createVault rejects empty passphrase', async () => {
    await expect(createVault('')).rejects.toThrow(/passphrase/);
  });
});

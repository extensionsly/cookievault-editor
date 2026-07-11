import { describe, expect, it } from 'vitest';
import { PBKDF2_ITERATIONS, SALT_BYTES, deriveMasterKey, generateSalt } from '../kdf.js';
import { encryptJson, decryptJson } from '../aead.js';

describe('deriveMasterKey', () => {
  it('produces a key usable for AES-GCM round-trip', async () => {
    const salt = generateSalt();
    const key = await deriveMasterKey('correct horse battery staple', salt);
    const blob = await encryptJson(key, { hello: 'world' });
    const out = await decryptJson<{ hello: string }>(key, blob);
    expect(out).toEqual({ hello: 'world' });
  });

  it('same password + salt → same key (deterministic)', async () => {
    const salt = generateSalt();
    const k1 = await deriveMasterKey('passw0rd', salt);
    const k2 = await deriveMasterKey('passw0rd', salt);
    const blob = await encryptJson(k1, { ok: true });
    const out = await decryptJson<{ ok: boolean }>(k2, blob);
    expect(out).toEqual({ ok: true });
  });

  it('different salt → unrelated key (cannot decrypt)', async () => {
    const k1 = await deriveMasterKey('passw0rd', generateSalt());
    const k2 = await deriveMasterKey('passw0rd', generateSalt());
    const blob = await encryptJson(k1, { ok: true });
    await expect(decryptJson(k2, blob)).rejects.toThrow();
  });

  it('different password → unrelated key (cannot decrypt)', async () => {
    const salt = generateSalt();
    const k1 = await deriveMasterKey('one', salt);
    const k2 = await deriveMasterKey('two', salt);
    const blob = await encryptJson(k1, { ok: true });
    await expect(decryptJson(k2, blob)).rejects.toThrow();
  });

  it('rejects empty password', async () => {
    await expect(deriveMasterKey('', generateSalt())).rejects.toThrow(/password/);
  });

  it('rejects wrong-sized salt', async () => {
    const bad = new Uint8Array(SALT_BYTES - 1);
    await expect(deriveMasterKey('x', bad)).rejects.toThrow(/salt/);
  });

  it('uses OWASP-2025-baseline iteration count', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });
});

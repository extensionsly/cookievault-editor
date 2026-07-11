import { describe, expect, it } from 'vitest';
import { deriveMasterKey, generateSalt } from '../kdf.js';
import { decrypt, encrypt, encryptJson, decryptJson } from '../aead.js';

async function key() {
  return deriveMasterKey('test-password', generateSalt());
}

describe('AES-GCM round-trip', () => {
  it('encrypt + decrypt restores plaintext', async () => {
    const k = await key();
    const plaintext = new TextEncoder().encode('hello world');
    const blob = await encrypt(k, plaintext);
    const out = await decrypt(k, blob);
    expect(new TextDecoder().decode(out)).toBe('hello world');
  });

  it('JSON helpers round-trip nested objects', async () => {
    const k = await key();
    const value = { a: 1, b: [2, 3], c: { nested: true } };
    const blob = await encryptJson(k, value);
    expect(await decryptJson(k, blob)).toEqual(value);
  });

  it('fresh IV per call (no nonce reuse)', async () => {
    const k = await key();
    const pt = new Uint8Array([1, 2, 3, 4]);
    const a = await encrypt(k, pt);
    const b = await encrypt(k, pt);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('IV is 12 bytes (AES-GCM standard)', async () => {
    const k = await key();
    const blob = await encrypt(k, new Uint8Array([0]));
    expect(blob.iv.byteLength).toBe(12);
  });

  it('tampered ciphertext fails authentication', async () => {
    const k = await key();
    const blob = await encrypt(k, new TextEncoder().encode('payload'));
    blob.ciphertext[0] = blob.ciphertext[0]! ^ 0xff;
    await expect(decrypt(k, blob)).rejects.toThrow();
  });

  it('AAD mismatch fails authentication', async () => {
    const k = await key();
    const aad1 = new TextEncoder().encode('user-1');
    const aad2 = new TextEncoder().encode('user-2');
    const blob = await encrypt(k, new TextEncoder().encode('payload'), aad1);
    await expect(decrypt(k, blob, aad2)).rejects.toThrow();
    const out = await decrypt(k, blob, aad1);
    expect(new TextDecoder().decode(out)).toBe('payload');
  });

  it('decrypt rejects wrong IV size', async () => {
    const k = await key();
    const blob = await encrypt(k, new Uint8Array([0]));
    const bad = { iv: new Uint8Array(blob.iv.byteLength - 1), ciphertext: blob.ciphertext };
    await expect(decrypt(k, bad)).rejects.toThrow(/iv/);
  });
});

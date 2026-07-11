import { describe, expect, it } from 'vitest';
import {
  licenseKeyHash,
  verifyLicense,
  verifyLicenseWithKey,
  verifyLicenseWithRing,
} from './license.js';

// Every branch is covered with throwaway runtime keypairs injected via
// `verifyLicenseWithKey` / `verifyLicenseWithRing` — the production private
// key lives only in .keys/ (gitignored) and must never appear in a committed
// file (licensing standard test red line, ADR-0015). Format v2: kid-routed
// ring + revocation list.

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makePair() {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
}

async function issue(priv: CryptoKey, payload: object): Promise<string> {
  const payloadB64 = toB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      priv,
      new TextEncoder().encode(payloadB64),
    ),
  );
  return `${payloadB64}.${toB64url(sig)}`;
}

describe('verifyLicenseWithKey (single injected key)', () => {
  it('accepts a valid v2 signed license', async () => {
    const kp = await makePair();
    const key = await issue(kp.privateKey, {
      v: 2,
      kid: 'aaaa1111',
      p: 'cookievault-pro',
      iat: 1_700_000_000,
      sub: 'buyer@example.com',
      ord: 'ORDER-1',
    });
    const r = await verifyLicenseWithKey(key, kp.publicKey);
    expect(r.valid).toBe(true);
    expect(r.payload?.sub).toBe('buyer@example.com');
    expect(r.payload?.ord).toBe('ORDER-1');
  });

  it('accepts a legacy v1 license (no v/kid)', async () => {
    const kp = await makePair();
    const key = await issue(kp.privateKey, { p: 'cookievault-pro', iat: 1_700_000_000 });
    expect((await verifyLicenseWithKey(key, kp.publicKey)).valid).toBe(true);
  });

  it('rejects a tampered payload (signature mismatch)', async () => {
    const kp = await makePair();
    const key = await issue(kp.privateKey, { v: 2, kid: 'aaaa1111', p: 'cookievault-pro', iat: 1 });
    const [, sig] = key.split('.');
    const forged = toB64url(
      new TextEncoder().encode(JSON.stringify({ v: 2, p: 'cookievault-pro', iat: 1, sub: 'evil' })),
    );
    const r = await verifyLicenseWithKey(`${forged}.${sig}`, kp.publicKey);
    expect(r).toMatchObject({ valid: false, reason: 'signature' });
  });

  it("rejects another product's license", async () => {
    const kp = await makePair();
    const key = await issue(kp.privateKey, { v: 2, kid: 'aaaa1111', p: 'mockbird-pro', iat: 1 });
    expect(await verifyLicenseWithKey(key, kp.publicKey)).toMatchObject({
      valid: false,
      reason: 'product',
    });
  });

  it('rejects an expired license and accepts an unexpired one', async () => {
    const kp = await makePair();
    const past = Math.floor(Date.now() / 1000) - 60;
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(
      await verifyLicenseWithKey(
        await issue(kp.privateKey, { v: 2, p: 'cookievault-pro', iat: 1, exp: past }),
        kp.publicKey,
      ),
    ).toMatchObject({ valid: false, reason: 'expired' });
    expect(
      (
        await verifyLicenseWithKey(
          await issue(kp.privateKey, { v: 2, p: 'cookievault-pro', iat: 1, exp: future }),
          kp.publicKey,
        )
      ).valid,
    ).toBe(true);
  });

  it('rejects malformed keys', async () => {
    const kp = await makePair();
    for (const bad of ['', 'no-dot', '.abc', 'abc.', 'not b64!.also not!']) {
      expect((await verifyLicenseWithKey(bad, kp.publicKey)).valid).toBe(false);
    }
  });
});

describe('verifyLicenseWithRing (kid routing + revocation)', () => {
  it('routes to the key named by the payload kid', async () => {
    const a = await makePair();
    const b = await makePair();
    const ring = { keyA: a.publicKey, keyB: b.publicKey };
    const key = await issue(a.privateKey, { v: 2, kid: 'keyA', p: 'cookievault-pro', iat: 1 });
    expect((await verifyLicenseWithRing(key, ring, 'keyA')).valid).toBe(true);
  });

  it('rejects a key whose kid points at a different key (cross-kid forgery)', async () => {
    const a = await makePair();
    const b = await makePair();
    const ring = { keyA: a.publicKey, keyB: b.publicKey };
    // Signed by A but claims kid keyB → verified against B → signature fail.
    const key = await issue(a.privateKey, { v: 2, kid: 'keyB', p: 'cookievault-pro', iat: 1 });
    expect(await verifyLicenseWithRing(key, ring, 'keyA')).toMatchObject({
      valid: false,
      reason: 'signature',
    });
  });

  it('rejects an unknown kid', async () => {
    const a = await makePair();
    const key = await issue(a.privateKey, { v: 2, kid: 'ghost', p: 'cookievault-pro', iat: 1 });
    expect(await verifyLicenseWithRing(key, { keyA: a.publicKey }, 'keyA')).toMatchObject({
      valid: false,
      reason: 'signature',
    });
  });

  it('falls a v1 key (no kid) back to the default kid', async () => {
    const a = await makePair();
    const key = await issue(a.privateKey, { p: 'cookievault-pro', iat: 1 });
    expect((await verifyLicenseWithRing(key, { keyA: a.publicKey }, 'keyA')).valid).toBe(true);
  });

  it('rejects a revoked key before verifying its (still-valid) signature', async () => {
    const a = await makePair();
    const key = await issue(a.privateKey, { v: 2, kid: 'keyA', p: 'cookievault-pro', iat: 1 });
    const revoked = new Set([await licenseKeyHash(key)]);
    expect(await verifyLicenseWithRing(key, { keyA: a.publicKey }, 'keyA', revoked)).toMatchObject({
      valid: false,
      reason: 'revoked',
    });
  });
});

describe('verifyLicense (built-in ring)', () => {
  it('rejects keys signed by a foreign private key', async () => {
    const kp = await makePair();
    // Uses the real DEFAULT_KID so ring routing succeeds, but the signature is
    // from a foreign key → signature failure (not unknown-kid).
    const key = await issue(kp.privateKey, {
      v: 2,
      kid: '15b170f5',
      p: 'cookievault-pro',
      iat: 1_700_000_000,
    });
    expect(await verifyLicense(key)).toMatchObject({ valid: false, reason: 'signature' });
  });

  it('rejects an unknown kid against the built-in ring', async () => {
    const kp = await makePair();
    const key = await issue(kp.privateKey, { v: 2, kid: 'nope0000', p: 'cookievault-pro', iat: 1 });
    expect(await verifyLicense(key)).toMatchObject({ valid: false, reason: 'signature' });
  });
});

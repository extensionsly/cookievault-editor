import { beforeEach, describe, expect, it } from 'vitest';
import { rowEntitles, verifyEntToken, ACCOUNT_ENTITLEMENT_KEY } from './account.js';
import {
  LICENSE_STORAGE_KEY,
  activateLicense,
  deactivateLicense,
  getOfflinePro,
  getProStatus,
  getStoredLicense,
} from './entitlement.js';

// The online credential is verified with an injected throwaway keypair
// (production trusts only the embedded extensionsly public key). The core
// regression under test is LIC-01: no hand-written storage value — bare
// boolean, forged token, or garbage license — may ever read as Pro.

/** In-memory storage.local + storage.sync, mirroring auth.test.ts. */
let local: Map<string, unknown>;
let sync: Map<string, unknown>;
function makeArea(store: Map<string, unknown>) {
  return {
    get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
    set: async (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
    },
    remove: async (key: string) => void store.delete(key),
  };
}
function installStorage(): void {
  local = new Map();
  sync = new Map();
  const chrome = (globalThis as unknown as { chrome: { storage: Record<string, unknown> } }).chrome;
  chrome.storage.local = { ...makeArea(local), onChanged: { addListener() {} } };
  chrome.storage.sync = { ...makeArea(sync), onChanged: { addListener() {} } };
  chrome.storage.onChanged = { addListener() {}, removeListener() {} };
}

beforeEach(() => installStorage());

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

/** Sign an ES256 JWT the way the extensionsly worker does. */
async function signEntToken(priv: CryptoKey, payload: object): Promise<string> {
  const header = toB64url(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })));
  const body = toB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      priv,
      new TextEncoder().encode(`${header}.${body}`),
    ),
  );
  return `${header}.${body}.${toB64url(sig)}`;
}

const NOW_S = () => Math.floor(Date.now() / 1000);

function proPayload(overrides: Record<string, unknown> = {}) {
  return {
    typ: 'entitlement',
    iss: 'exly',
    sub: 'user-1',
    entitlements: [{ product: 'cookievault', tier: 'pro', status: 'active', expires_at: null }],
    iat: NOW_S(),
    exp: NOW_S() + 14 * 24 * 3600,
    ...overrides,
  };
}

describe('verifyEntToken (injected key)', () => {
  it('accepts a well-formed signed credential', async () => {
    const kp = await makePair();
    const token = await signEntToken(kp.privateKey, proPayload());
    const payload = await verifyEntToken(token, kp.publicKey);
    expect(payload?.entitlements[0]?.product).toBe('cookievault');
  });

  it('rejects a credential signed by a foreign key', async () => {
    const kp = await makePair();
    const other = await makePair();
    const token = await signEntToken(other.privateKey, proPayload());
    expect(await verifyEntToken(token, kp.publicKey)).toBeNull();
  });

  it('rejects wrong typ / iss, expiry, and future iat', async () => {
    const kp = await makePair();
    for (const bad of [
      proPayload({ typ: 'access' }),
      proPayload({ iss: 'someone-else' }),
      proPayload({ exp: NOW_S() - 10 }),
      proPayload({ iat: NOW_S() + 3600 }),
    ]) {
      const token = await signEntToken(kp.privateKey, bad);
      expect(await verifyEntToken(token, kp.publicKey)).toBeNull();
    }
  });

  it('rejects structurally broken tokens', async () => {
    const kp = await makePair();
    for (const bad of ['', 'a.b', 'a.b.c.d', 'not-a-jwt']) {
      expect(await verifyEntToken(bad, kp.publicKey)).toBeNull();
    }
  });
});

describe('rowEntitles (product + status semantics, standard §3.3)', () => {
  const t0 = 1_700_000_000;
  it('matches the cookievault slug and the ALL bundle only', () => {
    expect(
      rowEntitles({ product: 'cookievault', tier: 'pro', status: 'active', expires_at: null }, t0),
    ).toBe(true);
    expect(
      rowEntitles({ product: 'ALL', tier: 'pro', status: 'active', expires_at: null }, t0),
    ).toBe(true);
    expect(
      rowEntitles({ product: 'mockbird', tier: 'pro', status: 'active', expires_at: null }, t0),
    ).toBe(false);
  });

  it('canceled keeps Pro until period end; unknown/expired never entitle', () => {
    expect(
      rowEntitles(
        { product: 'cookievault', tier: 'pro', status: 'canceled', expires_at: t0 + 100 },
        t0,
      ),
    ).toBe(true);
    expect(
      rowEntitles(
        { product: 'cookievault', tier: 'pro', status: 'canceled', expires_at: null },
        t0,
      ),
    ).toBe(false);
    expect(
      rowEntitles(
        { product: 'cookievault', tier: 'pro', status: 'active', expires_at: t0 - 1 },
        t0,
      ),
    ).toBe(false);
    expect(
      rowEntitles({ product: 'cookievault', tier: 'pro', status: 'expired', expires_at: null }, t0),
    ).toBe(false);
    expect(
      rowEntitles({ product: 'cookievault', tier: 'pro', status: 'weird', expires_at: null }, t0),
    ).toBe(false);
  });
});

describe('LIC-01 regression: hand-written storage never grants Pro', () => {
  it('a forged/garbage entitlement blob reads as free', async () => {
    local.set(ACCOUNT_ENTITLEMENT_KEY, { token: 'forged.token.value' });
    expect(await getProStatus()).toBe(false);
  });

  it('a bare boolean in storage reads as free', async () => {
    local.set(ACCOUNT_ENTITLEMENT_KEY, { pro: true });
    local.set(LICENSE_STORAGE_KEY, true);
    expect(await getProStatus()).toBe(false);
  });

  it('a garbage license key in storage.sync reads as free', async () => {
    sync.set(LICENSE_STORAGE_KEY, 'not-a-real-license');
    expect(await getOfflinePro()).toBe(false);
  });
});

describe('license activation lifecycle', () => {
  it('rejects an invalid key and stores nothing', async () => {
    const r = await activateLicense('garbage');
    expect(r.valid).toBe(false);
    expect(await getStoredLicense()).toBeNull();
  });

  it('deactivate clears both storage areas', async () => {
    sync.set(LICENSE_STORAGE_KEY, 'whatever');
    local.set(LICENSE_STORAGE_KEY, 'whatever');
    await deactivateLicense();
    expect(await getStoredLicense()).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_ENTITLEMENT_KEY,
  ACCOUNT_SESSION_KEY,
  getOnlinePro,
  startTrial,
} from './account.js';

// startTrial talks to api.extensionsly.com; we stub global fetch. The trial row
// flows through the same signed-credential path as any entitlement, so we sign
// the returned credential with a throwaway key that the module's built-in
// public key won't match — proving the standard's rule holds: the server-issued
// credential is trusted only via signature, and here (foreign key) it is NOT,
// so a "trial started" response alone never fakes Pro.

const API = 'https://api.extensionsly.com';

let store: Map<string, unknown>;
function installStorage(): void {
  store = new Map();
  (globalThis as unknown as { chrome: { storage: Record<string, unknown> } }).chrome.storage = {
    local: {
      get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
      set: async (obj: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(obj)) store.set(k, v);
      },
      remove: async (key: string) => void store.delete(key),
      onChanged: { addListener() {} },
    },
    sync: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
      onChanged: { addListener() {} },
    },
    onChanged: { addListener() {}, removeListener() {} },
  };
}

function toB64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fake access JWT whose `exp` claim is far in the future (so accessToken()
 * uses it directly without a refresh round-trip). */
function futureAccessJwt(): string {
  const payload = toB64url(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `h.${payload}.s`;
}

function seedSession(): void {
  store.set(ACCOUNT_SESSION_KEY, {
    access: futureAccessJwt(),
    refresh: 'refresh-tok',
    email: 'qa@example.com',
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  installStorage();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('startTrial (server-side, §3.4)', () => {
  it('fails fast when not signed in — never calls the backend', async () => {
    const r = await startTrial();
    expect(r).toMatchObject({ ok: false, error: 'not_signed_in' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs product to /v1/trial/start with the bearer token', async () => {
    seedSession();
    fetchMock.mockResolvedValue(jsonResponse({ started: true, entitlement: { expires_at: 123 } }));
    const r = await startTrial();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API}/v1/trial/start`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ product: 'cookievault' });
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(r).toMatchObject({ ok: true, started: true, expiresAt: 123 });
  });

  it('reports started:false when the account already used its trial', async () => {
    seedSession();
    fetchMock.mockResolvedValue(
      jsonResponse({ started: false, entitlement: { expires_at: 100 }, token: null }),
    );
    const r = await startTrial();
    expect(r).toMatchObject({ ok: true, started: false });
  });

  it('does NOT grant Pro from a trial response whose credential fails verification', async () => {
    seedSession();
    // Backend "started" but the credential is a forged/foreign token — must not
    // be stored, and Pro must stay false (only signature-verified grants Pro).
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/v1/trial/start')) {
        return jsonResponse({ started: true, entitlement: { expires_at: null }, token: 'a.b.c' });
      }
      // getOnlinePro → refreshEntitlement → entitlement endpoint returns nothing usable
      return jsonResponse({ token: null });
    });
    const r = await startTrial();
    expect(r.ok).toBe(true);
    expect(store.get(ACCOUNT_ENTITLEMENT_KEY)).toBeUndefined();
    expect(await getOnlinePro()).toBe(false);
  });

  it('returns a network error without throwing', async () => {
    seedSession();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await startTrial()).toMatchObject({ ok: false, error: 'network' });
  });
});

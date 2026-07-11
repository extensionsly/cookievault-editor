import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPersistedAuth,
  getAccessToken,
  loadPersistedAuth,
  requestMagicLink,
  signOut,
  verifyMagicToken,
} from './auth.js';

// WORKER_BASE_URL falls back to localhost in the test runner (no Vite define).
const BASE = 'http://localhost:8787';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Replace the default no-op storage stub with a stateful in-memory one. */
function installStatefulStorage(): void {
  const m = new Map<string, unknown>();
  (globalThis as unknown as { chrome: { storage: { local: unknown } } }).chrome.storage.local = {
    get: async (key: string) => (m.has(key) ? { [key]: m.get(key) } : {}),
    set: async (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) m.set(k, v);
    },
    remove: async (key: string) => {
      m.delete(key);
    },
    onChanged: { addListener() {}, removeListener() {} },
  };
}

const nowS = () => Math.floor(Date.now() / 1000);

const VERIFY_OK = {
  accessToken: 'access.jwt.tok',
  accessExpiresAt: nowS() + 3600,
  refreshToken: 'refresh-abc',
  refreshExpiresAt: nowS() + 86_400,
  kdf: { algo: 'PBKDF2-SHA256', iterations: 600_000, salt: 'saltz' },
  userId: 'u-1',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  installStatefulStorage();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  // Reset the module-scope access-token cache between tests.
  await clearPersistedAuth();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestMagicLink', () => {
  it('POSTs the email to /v1/auth/magic', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await requestMagicLink('a@b.com');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/v1/auth/magic`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.com' });
  });

  it('throws a rate-limit message on 429', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'too_many_requests' }, 429));
    await expect(requestMagicLink('a@b.com')).rejects.toThrow(/too many/i);
  });
});

describe('verifyMagicToken', () => {
  it('exchanges the code via POST body — no clickable ?token= link (P0-1)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(VERIFY_OK));
    const result = await verifyMagicToken('the-code', 'a@b.com');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/v1/auth/verify`);
    expect(String(url)).not.toContain('?token=');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: 'the-code' });

    expect(result.userId).toBe('u-1');
    expect(result.email).toBe('a@b.com');
    // Refresh token + kdf salt are persisted for later; access token is not.
    const persisted = await loadPersistedAuth();
    expect(persisted?.refreshToken).toBe('refresh-abc');
    expect(persisted?.kdfSalt).toBe('saltz');
  });

  it('rejects when verify fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'already_used' }, 400));
    await expect(verifyMagicToken('bad', 'a@b.com')).rejects.toThrow(/verify failed/i);
  });
});

describe('getAccessToken', () => {
  it('returns the cached access token while fresh (no refresh call)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(VERIFY_OK));
    await verifyMagicToken('c', 'a@b.com');
    fetchMock.mockClear();

    const tok = await getAccessToken();
    expect(tok).toBe('access.jwt.tok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes when the cached token is within the expiry window', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...VERIFY_OK, accessExpiresAt: nowS() + 10 }));
    await verifyMagicToken('c', 'a@b.com');

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        accessToken: 'fresh.jwt',
        accessExpiresAt: nowS() + 3600,
        refreshToken: 'refresh-def',
        refreshExpiresAt: nowS() + 86_400,
      }),
    );
    const tok = await getAccessToken();
    expect(tok).toBe('fresh.jwt');

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(`${BASE}/v1/auth/refresh`);
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'refresh-abc' });

    // The rotated refresh token replaced the stored one.
    const persisted = await loadPersistedAuth();
    expect(persisted?.refreshToken).toBe('refresh-def');
  });

  it('wipes local auth and forces re-sign-in when refresh is rejected', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...VERIFY_OK, accessExpiresAt: nowS() + 10 }));
    await verifyMagicToken('c', 'a@b.com');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'rotated' }, 401));
    await expect(getAccessToken()).rejects.toThrow(/sign in/i);
    expect(await loadPersistedAuth()).toBeNull();
  });
});

describe('signOut', () => {
  it('posts the refresh token and clears local state', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(VERIFY_OK));
    await verifyMagicToken('c', 'a@b.com');

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await signOut();

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(`${BASE}/v1/auth/signout`);
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'refresh-abc' });
    expect(await loadPersistedAuth()).toBeNull();
  });
});

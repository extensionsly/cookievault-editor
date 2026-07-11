import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportError, UnauthorizedError, freshIfMatch, pullVault, pushVault } from './sync.js';

const cfg = { baseUrl: 'http://localhost:8787', accessToken: 'tok' };
const VAULT_URL = 'http://localhost:8787/v1/sync/vault';
const KDF = { algo: 'PBKDF2-SHA256', iterations: 600_000, salt: 'AAAA' } as const;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('pullVault', () => {
  it('parses a 200 body and returns the ETag', async () => {
    const body = { ciphertext: 'ct', sha256Hint: 'h', kdfMeta: KDF, updatedAt: 123 };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json', ETag: 'W/"3"' },
      }),
    );
    const r = await pullVault(cfg);
    expect(r?.ciphertext).toBe('ct');
    expect(r?.etag).toBe('W/"3"');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(VAULT_URL);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('returns null on 404 (no vault yet)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
    expect(await pullVault(cfg)).toBeNull();
  });

  it('throws UnauthorizedError on 401', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(pullVault(cfg)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws TransportError on 500', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(pullVault(cfg)).rejects.toBeInstanceOf(TransportError);
  });
});

describe('pushVault', () => {
  const input = {
    ciphertext: 'ct',
    kdfMeta: KDF,
    sha256Hint: 'h',
    ifMatchEtag: freshIfMatch(),
  };

  it('sends PUT with If-Match + Bearer and returns the new ETag on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204, headers: { ETag: 'W/"1"' } }));
    const r = await pushVault(cfg, input);
    expect(r).toEqual({ kind: 'ok', etag: 'W/"1"' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(VAULT_URL);
    expect(init.method).toBe('PUT');
    expect(init.headers['If-Match']).toBe(freshIfMatch());
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('returns a conflict with the remote hint + etag on 412', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'precondition_failed', currentSha256Hint: 'remote-h' }),
        {
          status: 412,
          headers: { 'content-type': 'application/json', ETag: 'W/"5"' },
        },
      ),
    );
    const r = await pushVault(cfg, input);
    expect(r).toEqual({ kind: 'conflict', remoteSha256Hint: 'remote-h', remoteEtag: 'W/"5"' });
  });

  it('throws UnauthorizedError on 401', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(pushVault(cfg, input)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws TransportError on an unexpected status', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(pushVault(cfg, input)).rejects.toBeInstanceOf(TransportError);
  });
});

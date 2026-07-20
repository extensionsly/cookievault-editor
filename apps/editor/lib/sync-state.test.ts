import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth.js', () => ({
  WORKER_BASE_URL: 'http://localhost:8787',
}));
vi.mock('./pro/account.js', () => ({
  getStoredEntToken: vi.fn(),
}));
vi.mock('./profile-store.js', () => ({ loadVault: vi.fn() }));
// Keep the real error classes + etagToHeader; only stub the transport calls.
vi.mock('./sync.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, pullVault: vi.fn(), pushVault: vi.fn() };
});

import { fromBase64Url, sha256OfString, toBase64Url } from '@cookievault/shared';
import { keepMine, syncNow, takeTheirs, vaultToWire, wireToVault } from './sync-state.js';
import { getStoredEntToken } from './pro/account.js';
import { loadVault } from './profile-store.js';
import { pullVault, pushVault, UnauthorizedError } from './sync.js';

const mockEntitlement = vi.mocked(getStoredEntToken);
const mockLoadVault = vi.mocked(loadVault);
const mockPull = vi.mocked(pullVault);
const mockPush = vi.mocked(pushVault);

const VAULT_FORMAT = 'cookievault.vault/v1' as const;

/** A valid EncryptedVault fixture (iv is 12 bytes; ct is arbitrary). */
function makeVault(ct: Uint8Array): ReturnType<typeof wireToVault> {
  return {
    format: VAULT_FORMAT,
    version: 1,
    kdf: { algo: 'PBKDF2-SHA256', iterations: 600_000, salt: 'c2FsdA' },
    body: { iv: toBase64Url(new Uint8Array(12).fill(7)), ct: toBase64Url(ct) },
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * Mirror the worker's storage exactly: base64url-decode the client's
 * ciphertext, zero-pad the bytes to a 256-byte boundary, re-encode. This is
 * what `wireToVault` must survive (audit F6 padding + F5 encoding).
 */
function simulateServerRoundTrip(ciphertext: string): string {
  const bytes = fromBase64Url(ciphertext);
  const target = Math.max(256, Math.ceil(bytes.length / 256) * 256);
  const padded = new Uint8Array(target);
  padded.set(bytes);
  return toBase64Url(padded);
}

function remoteFrom(vault: ReturnType<typeof makeVault>, etag = 'W/"1"') {
  const wire = vaultToWire(vault);
  return {
    ciphertext: simulateServerRoundTrip(wire.ciphertext),
    kdfMeta: wire.kdfMeta,
    etag,
    sha256Hint: 'hint',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEntitlement.mockResolvedValue('entitlement-tok');
  mockLoadVault.mockResolvedValue(null);
});

describe('syncNow — auth + transport classification', () => {
  it('returns no-auth when there is no usable access token', async () => {
    mockEntitlement.mockResolvedValue(null);
    expect(await syncNow()).toEqual({ kind: 'no-auth' });
    expect(mockPull).not.toHaveBeenCalled();
  });

  it('returns synced when both sides are empty', async () => {
    mockPull.mockResolvedValue(null);
    mockLoadVault.mockResolvedValue(null);
    expect(await syncNow()).toEqual({ kind: 'synced' });
  });

  it('maps an UnauthorizedError during pull to no-auth', async () => {
    mockPull.mockRejectedValue(new UnauthorizedError());
    expect(await syncNow()).toEqual({ kind: 'no-auth' });
  });

  it('maps a network failure to offline', async () => {
    mockPull.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await syncNow()).toEqual({ kind: 'offline' });
  });

  it('maps an unexpected error to transport-error', async () => {
    mockPull.mockRejectedValue(new Error('boom'));
    expect(await syncNow()).toEqual({ kind: 'transport-error', message: 'boom' });
  });
});

describe('vaultToWire ↔ wireToVault round-trip', () => {
  it('recovers iv/ct/kdf after the server pads the blob', () => {
    const vault = makeVault(new Uint8Array([1, 2, 3, 4, 5, 250, 200, 42]));
    const recovered = wireToVault(remoteFrom(vault), VAULT_FORMAT);
    expect(recovered.body.iv).toBe(vault.body.iv);
    expect(recovered.body.ct).toBe(vault.body.ct);
    expect(recovered.kdf.iterations).toBe(600_000);
    expect(recovered.kdf.salt).toBe('c2FsdA');
  });

  it('survives a ciphertext whose real bytes END in 0x00 (padding ambiguity)', () => {
    // The trailing zero must not be mistaken for server NUL padding.
    const vault = makeVault(new Uint8Array([9, 8, 7, 0, 0, 0]));
    const recovered = wireToVault(remoteFrom(vault), VAULT_FORMAT);
    expect(recovered.body.ct).toBe(vault.body.ct);
  });

  it('handles a large ciphertext spanning multiple 256B pad blocks', () => {
    const big = new Uint8Array(600);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 256;
    const vault = makeVault(big);
    const recovered = wireToVault(remoteFrom(vault), VAULT_FORMAT);
    expect(recovered.body.ct).toBe(vault.body.ct);
  });
});

describe('conflict resolution', () => {
  it('takeTheirs pulls + decodes the remote vault', async () => {
    const vault = makeVault(new Uint8Array([11, 22, 33]));
    mockPull.mockResolvedValue(remoteFrom(vault, 'W/"7"') as never);
    const got = await takeTheirs();
    expect(got.body.ct).toBe(vault.body.ct);
  });

  it('takeTheirs throws when there is no remote vault', async () => {
    mockPull.mockResolvedValue(null);
    await expect(takeTheirs()).rejects.toThrow(/no remote/i);
  });

  it('keepMine force-pushes local under the latest remote etag', async () => {
    const vault = makeVault(new Uint8Array([1, 1, 1]));
    mockPull.mockResolvedValue(remoteFrom(vault, 'W/"9"') as never);
    mockPush.mockResolvedValue({ kind: 'ok', etag: 'W/"10"' });
    await keepMine(vault);
    const arg = mockPush.mock.calls[0][1];
    expect(arg.ifMatchEtag).toBe('W/"9"');
    expect(typeof arg.sha256Hint).toBe('string');
  });

  it('keepMine throws on a concurrent-change conflict', async () => {
    const vault = makeVault(new Uint8Array([2, 2, 2]));
    mockPull.mockResolvedValue(remoteFrom(vault, 'W/"9"') as never);
    mockPush.mockResolvedValue({ kind: 'conflict', remoteSha256Hint: 'h', remoteEtag: 'W/"9"' });
    await expect(keepMine(vault)).rejects.toThrow(/concurrent/i);
  });
});

describe('syncNow — success paths', () => {
  it('pushes a fresh vault when the server is empty (pushed-fresh)', async () => {
    const vault = makeVault(new Uint8Array([5, 5, 5]));
    mockLoadVault.mockResolvedValue(vault);
    mockPull.mockResolvedValue(null);
    mockPush.mockResolvedValue({ kind: 'ok', etag: 'W/"1"' });
    expect(await syncNow()).toEqual({ kind: 'pushed-fresh', etag: 'W/"1"' });
    expect(mockPush.mock.calls[0][1].ifMatchEtag).toBe('W/"0"');
  });

  it('surfaces the remote vault when there is no local copy (pulled)', async () => {
    const vault = makeVault(new Uint8Array([6, 6, 6]));
    mockLoadVault.mockResolvedValue(null);
    mockPull.mockResolvedValue(remoteFrom(vault, 'W/"4"') as never);
    const r = await syncNow();
    expect(r.kind).toBe('pulled');
    if (r.kind === 'pulled') expect(r.remote.body.ct).toBe(vault.body.ct);
  });

  it('reports synced when local and remote hashes match', async () => {
    const vault = makeVault(new Uint8Array([7, 7, 7]));
    mockLoadVault.mockResolvedValue(vault);
    const sha = await sha256OfString(vaultToWire(vault).serialised);
    mockPull.mockResolvedValue({ ...remoteFrom(vault, 'W/"2"'), sha256Hint: sha } as never);
    expect(await syncNow()).toEqual({ kind: 'synced' });
  });

  it('pushes conditionally when local has diverged from remote', async () => {
    const local = makeVault(new Uint8Array([8, 8, 8]));
    mockLoadVault.mockResolvedValue(local);
    mockPull.mockResolvedValue({ ...remoteFrom(local, 'W/"3"'), sha256Hint: 'different' } as never);
    mockPush.mockResolvedValue({ kind: 'ok', etag: 'W/"4"' });
    expect(await syncNow()).toEqual({ kind: 'pushed-fresh', etag: 'W/"4"' });
    expect(mockPush.mock.calls[0][1].ifMatchEtag).toBe('W/"3"');
  });
});

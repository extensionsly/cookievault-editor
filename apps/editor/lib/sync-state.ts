/**
 * Sync orchestration: decides when to push, when to pull, and tracks
 * the last-known ETag for optimistic locking. Reads / writes
 * `browser.storage.local` for cross-page coordination.
 *
 * NOT the conflict UI — that lives in `entrypoints/options/ConflictModal`.
 * This module only classifies (`'synced'` / `'pushed'` / `'pulled'`
 * / `'conflict'` / `'no-remote'`) and surfaces the data the UI needs
 * to drive resolution.
 */

import { browser } from 'wxt/browser';
import {
  type EncryptedVault,
  EncryptedVaultSchema,
  fromBase64Url,
  sha256OfString,
  toBase64Url,
} from '@cookievault/shared';
import { getAccessToken, WORKER_BASE_URL } from './auth.js';
import { isNetworkError } from './http.js';
import { loadVault } from './profile-store.js';
import { getStoredEntToken } from './pro/account.js';
import {
  PreconditionFailedError,
  ProRequiredError,
  UnauthorizedError,
  etagToHeader,
  pullVault,
  pushVault,
} from './sync.js';

const STATE_KEY = 'cookievault.sync.state.v1';

export interface SyncState {
  /** Last successful sync's server ETag. */
  lastEtag: string | null;
  /** Last successful sync wall-clock (epoch ms). */
  lastSyncedAt: number | null;
  /** Set when an outbound push or pull surfaced a conflict. */
  conflictRemoteSha256Hint: string | null;
  /** Set when an offline write needs flushing on next online sync. */
  pendingPush: boolean;
}

const DEFAULT_STATE: SyncState = {
  lastEtag: null,
  lastSyncedAt: null,
  conflictRemoteSha256Hint: null,
  pendingPush: false,
};

export async function loadSyncState(): Promise<SyncState> {
  const r = await browser.storage.local.get(STATE_KEY);
  const raw = r[STATE_KEY] as Partial<SyncState> | undefined;
  if (!raw) return DEFAULT_STATE;
  return { ...DEFAULT_STATE, ...raw };
}

export async function saveSyncState(s: SyncState): Promise<void> {
  await browser.storage.local.set({ [STATE_KEY]: s });
}

export type SyncResult =
  | { kind: 'synced' }
  | { kind: 'pushed-fresh'; etag: string }
  | { kind: 'pulled'; remote: EncryptedVault }
  | { kind: 'conflict'; remoteSha256Hint: string }
  | { kind: 'no-auth' }
  | { kind: 'pro-required' }
  | { kind: 'offline' }
  | { kind: 'transport-error'; message: string };

interface RemoteVaultEnvelope {
  ciphertext: string;
  kdfMeta: { algo: 'PBKDF2-SHA256'; iterations: number; salt: string };
  etag: string;
  sha256Hint: string;
}

/** Exported for round-trip tests; not part of the public sync API. */
export function vaultToWire(vault: EncryptedVault): {
  ciphertext: string;
  kdfMeta: { algo: 'PBKDF2-SHA256'; iterations: number; salt: string };
  serialised: string;
} {
  // Wire layout (opaque bytes to the server): a 4-byte big-endian length
  // of the meaningful payload, then the raw AES-GCM iv + ciphertext:
  //
  //   [payloadLen: uint32 BE][iv: 12][ct: payloadLen-12]
  //
  // The length prefix lets `wireToVault` strip the server's trailing NUL
  // padding even when the ciphertext legitimately ends in 0x00 — without
  // the JSON-envelope + double-base64 the old encoding used (~1.78×). This
  // is a single base64url of the raw bytes (~1.33×). Server treats the
  // whole thing as opaque base64url per packages/shared/src/sync/wire.ts.
  const iv = fromBase64Url(vault.body.iv);
  const ct = fromBase64Url(vault.body.ct);
  const payloadLen = iv.length + ct.length;
  const buf = new Uint8Array(4 + payloadLen);
  buf[0] = (payloadLen >>> 24) & 0xff;
  buf[1] = (payloadLen >>> 16) & 0xff;
  buf[2] = (payloadLen >>> 8) & 0xff;
  buf[3] = payloadLen & 0xff;
  buf.set(iv, 4);
  buf.set(ct, 4 + iv.length);
  const ciphertext = toBase64Url(buf);
  return {
    ciphertext,
    kdfMeta: { algo: 'PBKDF2-SHA256', iterations: vault.kdf.iterations, salt: vault.kdf.salt },
    // Hash the wire string for the freshness hint — deterministic given the
    // vault's stored iv/ct.
    serialised: ciphertext,
  };
}

/** Exported for round-trip tests; not part of the public sync API. */
export function wireToVault(
  remote: RemoteVaultEnvelope,
  format: EncryptedVault['format'],
): EncryptedVault {
  // Reverse of vaultToWire. Decode the base64url bytes, read the 4-byte
  // length header, and slice out iv (12) + ct — ignoring any trailing
  // server NUL padding beyond `payloadLen`.
  const IV_LEN = 12;
  const bytes = fromBase64Url(remote.ciphertext);
  if (bytes.length < 4 + IV_LEN) {
    throw new Error('wireToVault: server ciphertext is too short to be a vault blob');
  }
  const payloadLen = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  if (payloadLen < IV_LEN || 4 + payloadLen > bytes.length) {
    throw new Error('wireToVault: server ciphertext length header is out of range');
  }
  const iv = bytes.slice(4, 4 + IV_LEN);
  const ct = bytes.slice(4 + IV_LEN, 4 + payloadLen);
  return EncryptedVaultSchema.parse({
    format,
    version: 1,
    kdf: {
      algo: 'PBKDF2-SHA256',
      iterations: remote.kdfMeta.iterations,
      salt: remote.kdfMeta.salt,
    },
    body: { iv: toBase64Url(iv), ct: toBase64Url(ct) },
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Pull-then-conditional-push. Returns a classification — caller (Options
 * page) decides whether to surface a toast, open the conflict modal, etc.
 */
export async function syncNow(): Promise<SyncResult> {
  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch {
    return { kind: 'no-auth' };
  }
  // Attach the extensionsly entitlement credential (if any) so the worker's
  // Pro gate can verify it server-side (ADR-0015). Never blocks a sync.
  const entitlementToken = await getStoredEntToken().catch(() => null);
  const cfg = { baseUrl: WORKER_BASE_URL, accessToken, entitlementToken };
  const localVault = await loadVault();
  const state = await loadSyncState();
  try {
    const remote = await pullVault(cfg);
    if (!remote && !localVault) {
      return { kind: 'synced' };
    }
    if (!remote && localVault) {
      // Fresh server-side. Push local up.
      const wire = vaultToWire(localVault);
      const sha = await sha256OfString(wire.serialised);
      const push = await pushVault(cfg, {
        ciphertext: wire.ciphertext,
        kdfMeta: wire.kdfMeta,
        sha256Hint: sha,
        ifMatchEtag: 'W/"0"',
      });
      if (push.kind === 'conflict') {
        await saveSyncState({ ...state, conflictRemoteSha256Hint: push.remoteSha256Hint });
        return { kind: 'conflict', remoteSha256Hint: push.remoteSha256Hint };
      }
      await saveSyncState({
        lastEtag: push.etag,
        lastSyncedAt: Date.now(),
        conflictRemoteSha256Hint: null,
        pendingPush: false,
      });
      return { kind: 'pushed-fresh', etag: push.etag };
    }
    // Remote exists.
    if (remote && !localVault) {
      // No local vault yet; surface remote so the caller can install it.
      const vault = wireToVault(remote, 'cookievault.vault/v1' as EncryptedVault['format']);
      await saveSyncState({
        lastEtag: remote.etag,
        lastSyncedAt: Date.now(),
        conflictRemoteSha256Hint: null,
        pendingPush: false,
      });
      return { kind: 'pulled', remote: vault };
    }
    // Both sides exist — push if local has moved past last-known etag.
    const wire = vaultToWire(localVault!);
    const sha = await sha256OfString(wire.serialised);
    if (sha === remote!.sha256Hint) {
      // Already in sync.
      await saveSyncState({
        lastEtag: remote!.etag,
        lastSyncedAt: Date.now(),
        conflictRemoteSha256Hint: null,
        pendingPush: false,
      });
      return { kind: 'synced' };
    }
    const push = await pushVault(cfg, {
      ciphertext: wire.ciphertext,
      kdfMeta: wire.kdfMeta,
      sha256Hint: sha,
      ifMatchEtag: etagToHeader(remote!.etag),
    });
    if (push.kind === 'conflict') {
      await saveSyncState({ ...state, conflictRemoteSha256Hint: push.remoteSha256Hint });
      return { kind: 'conflict', remoteSha256Hint: push.remoteSha256Hint };
    }
    await saveSyncState({
      lastEtag: push.etag,
      lastSyncedAt: Date.now(),
      conflictRemoteSha256Hint: null,
      pendingPush: false,
    });
    return { kind: 'pushed-fresh', etag: push.etag };
  } catch (err) {
    if (err instanceof UnauthorizedError) return { kind: 'no-auth' };
    if (err instanceof ProRequiredError) return { kind: 'pro-required' };
    if (err instanceof PreconditionFailedError) {
      return { kind: 'conflict', remoteSha256Hint: err.remoteSha256Hint };
    }
    if (isNetworkError(err)) return { kind: 'offline' };
    return {
      kind: 'transport-error',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * "Take theirs" resolution path. Fetches the remote, returns the
 * decoded `EncryptedVault` for the caller to install locally.
 */
export async function takeTheirs(): Promise<EncryptedVault> {
  const accessToken = await getAccessToken();
  const remote = await pullVault({ baseUrl: WORKER_BASE_URL, accessToken });
  if (!remote) throw new Error('No remote vault to take');
  const vault = wireToVault(remote, 'cookievault.vault/v1' as EncryptedVault['format']);
  await saveSyncState({
    lastEtag: remote.etag,
    lastSyncedAt: Date.now(),
    conflictRemoteSha256Hint: null,
    pendingPush: false,
  });
  return vault;
}

/**
 * "Keep mine" resolution path. Fetches the latest etag, then force-pushes
 * the local vault under that etag.
 */
export async function keepMine(localVault: EncryptedVault): Promise<void> {
  const accessToken = await getAccessToken();
  const entitlementToken = await getStoredEntToken().catch(() => null);
  const cfg = { baseUrl: WORKER_BASE_URL, accessToken, entitlementToken };
  const remote = await pullVault(cfg);
  const wire = vaultToWire(localVault);
  const sha = await sha256OfString(wire.serialised);
  const ifMatch = remote ? etagToHeader(remote.etag) : 'W/"0"';
  const push = await pushVault(cfg, {
    ciphertext: wire.ciphertext,
    kdfMeta: wire.kdfMeta,
    sha256Hint: sha,
    ifMatchEtag: ifMatch,
  });
  if (push.kind === 'conflict') {
    // Race — server moved between our GET and PUT. Caller can retry.
    throw new Error('Concurrent server change — try again');
  }
  await saveSyncState({
    lastEtag: push.etag,
    lastSyncedAt: Date.now(),
    conflictRemoteSha256Hint: null,
    pendingPush: false,
  });
}

/** Light fire-and-forget — non-blocking. */
export function scheduleSync(): void {
  void syncNow().catch(() => {
    // Failures already surface via syncState; no need to re-throw.
  });
}

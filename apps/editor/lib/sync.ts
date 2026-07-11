/**
 * HTTP client for `/v1/sync/vault`. Pure transport: never touches
 * `chrome.storage`, never decides "should I push now". The orchestrator
 * in `lib/sync-state.ts` makes those decisions.
 *
 * All call sites must pass a fresh access token (use `getAccessToken`
 * from `lib/auth.ts`, which auto-refreshes when expired).
 */

import {
  type SyncKdfMeta,
  type VaultGetResponse,
  formatIfMatch,
  parseEtagHeader,
  parseVaultConflict,
  parseVaultGet,
  serializeVaultPut,
} from '@cookievault/shared';
import { fetchWithTimeout } from './http.js';

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

/** Server said vault writes need a Pro entitlement (402, ADR-0015). */
export class ProRequiredError extends Error {
  constructor() {
    super('pro_required');
    this.name = 'ProRequiredError';
  }
}

export class PreconditionFailedError extends Error {
  constructor(
    public readonly remoteSha256Hint: string,
    public readonly remoteEtag: string | null,
  ) {
    super('precondition_failed');
    this.name = 'PreconditionFailedError';
  }
}

export class TransportError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'TransportError';
  }
}

export interface SyncTransportConfig {
  baseUrl: string;
  accessToken: string;
  /**
   * extensionsly entitlement credential (raw signed token), forwarded on
   * writes so the worker can verify Pro server-side (ADR-0015). Optional:
   * absent for free users — the worker then falls back to its own records
   * and 402s when SYNC_REQUIRES_PRO is on.
   */
  entitlementToken?: string | null;
}

function vaultUrl(base: string): string {
  return `${base.replace(/\/$/, '')}/v1/sync/vault`;
}

function authHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export interface PullVaultResult extends VaultGetResponse {
  etag: string;
}

export async function pullVault(cfg: SyncTransportConfig): Promise<PullVaultResult | null> {
  const res = await fetchWithTimeout(vaultUrl(cfg.baseUrl), {
    method: 'GET',
    headers: authHeader(cfg.accessToken),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new TransportError(res.status, `pullVault: GET returned ${res.status}`);
  }
  const json = await res.json();
  const parsed = parseVaultGet(json);
  const etag = res.headers.get('ETag') ?? '';
  return { ...parsed, etag };
}

export interface PushVaultInput {
  ciphertext: string;
  kdfMeta: SyncKdfMeta;
  sha256Hint: string;
  /** Server etag this push is conditional on. Use `'W/"0"'` for first push. */
  ifMatchEtag: string;
}

export type PushVaultResult =
  | { kind: 'ok'; etag: string }
  | { kind: 'conflict'; remoteSha256Hint: string; remoteEtag: string | null };

export async function pushVault(
  cfg: SyncTransportConfig,
  input: PushVaultInput,
): Promise<PushVaultResult> {
  const body = serializeVaultPut({
    ciphertext: input.ciphertext,
    kdfMeta: input.kdfMeta,
    sha256Hint: input.sha256Hint,
  });
  const res = await fetchWithTimeout(vaultUrl(cfg.baseUrl), {
    method: 'PUT',
    headers: {
      ...authHeader(cfg.accessToken),
      'Content-Type': 'application/json',
      'If-Match': input.ifMatchEtag,
      ...(cfg.entitlementToken ? { 'X-Entitlement': cfg.entitlementToken } : {}),
    },
    body,
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 402) throw new ProRequiredError();
  if (res.status === 412) {
    const json = await res.json().catch(() => ({}));
    const conflict = parseVaultConflict(json);
    return {
      kind: 'conflict',
      remoteSha256Hint: conflict?.currentSha256Hint ?? '',
      remoteEtag: res.headers.get('ETag'),
    };
  }
  if (res.status !== 204) {
    throw new TransportError(res.status, `pushVault: PUT returned ${res.status}`);
  }
  return { kind: 'ok', etag: res.headers.get('ETag') ?? '' };
}

/** Format the initial If-Match for a fresh-create PUT. */
export function freshIfMatch(): string {
  return formatIfMatch(0);
}

export function etagToHeader(versionEtagOrNull: string | null | undefined): string {
  if (!versionEtagOrNull) return formatIfMatch(0);
  const parsed = parseEtagHeader(versionEtagOrNull);
  if (!parsed) return formatIfMatch(0);
  return formatIfMatch(parsed.version);
}

/**
 * Magic-link auth flow + token storage facade for the editor.
 *
 * Token storage:
 *   - `accessToken` lives ONLY in module-scope memory (cleared on
 *     popup/options reload — re-derive from refresh on next use).
 *   - `refreshToken` persists to `browser.storage.local` (RAM-safe is
 *     ideal but we need to survive a popup reopen). Encryption with
 *     the vault key is a follow-up — for MVP the refresh token alone
 *     is not enough to derive vault data (server cannot decrypt).
 *
 * Wire is `apps/worker/src/routes/auth.ts`. Schema below mirrors it
 * exactly; mismatches surface as TS errors.
 */

import { browser } from 'wxt/browser';
import { z } from 'zod';
import { fetchWithTimeout } from './http.js';

const PERSISTED_KEY = 'cookievault.auth.v1';

const PersistedAuthSchema = z
  .object({
    userId: z.string().min(1),
    email: z.string().email(),
    refreshToken: z.string().min(1),
    refreshExpiresAt: z.number().int().positive(),
    kdfSalt: z.string().min(1),
  })
  .strict();
export type PersistedAuth = z.infer<typeof PersistedAuthSchema>;

const VerifyResponseSchema = z
  .object({
    accessToken: z.string(),
    accessExpiresAt: z.number(),
    refreshToken: z.string(),
    refreshExpiresAt: z.number(),
    kdf: z.object({
      algo: z.literal('PBKDF2-SHA256'),
      iterations: z.number().int().positive(),
      salt: z.string(),
    }),
    userId: z.string(),
  })
  .strict();

const RefreshResponseSchema = z
  .object({
    accessToken: z.string(),
    accessExpiresAt: z.number(),
    refreshToken: z.string(),
    refreshExpiresAt: z.number(),
  })
  .strict();

let accessTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Build-time base URL for the worker, injected by WXT/Vite `define` (see
 * wxt.config.ts `resolveWorkerUrl`). Release builds bake in the production
 * https URL; dev builds and the test runner (no define) fall back to
 * localhost. `typeof` guards the undefined-identifier case at runtime, and
 * the bare identifier (not a property access) is what Vite `define` can
 * replace.
 */
declare const __COOKIEVAULT_WORKER_URL__: string | undefined;

export const WORKER_BASE_URL =
  typeof __COOKIEVAULT_WORKER_URL__ !== 'undefined'
    ? __COOKIEVAULT_WORKER_URL__
    : 'http://localhost:8787';

function joinUrl(path: string): string {
  return `${WORKER_BASE_URL.replace(/\/$/, '')}${path}`;
}

export async function requestMagicLink(email: string): Promise<void> {
  const res = await fetchWithTimeout(joinUrl('/v1/auth/magic'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (res.status === 429) {
    throw new Error('Too many sign-in requests. Try again in an hour.');
  }
  if (!res.ok) {
    throw new Error(`Magic link request failed: ${res.status}`);
  }
}

export interface VerifyResult {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
  userId: string;
  email: string;
  kdfSalt: string;
}

export async function verifyMagicToken(token: string, email: string): Promise<VerifyResult> {
  // POST (not GET): the code is exchanged by this direct extension request,
  // so the returned tokens never touch a clickable link a mail gateway
  // could pre-fetch. Mirrors worker `POST /v1/auth/verify`.
  const res = await fetchWithTimeout(joinUrl('/v1/auth/verify'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Verify failed: ${res.status} ${detail.slice(0, 200)}`);
  }
  const parsed = VerifyResponseSchema.parse(await res.json());
  const result: VerifyResult = {
    accessToken: parsed.accessToken,
    accessExpiresAt: parsed.accessExpiresAt,
    refreshToken: parsed.refreshToken,
    refreshExpiresAt: parsed.refreshExpiresAt,
    userId: parsed.userId,
    email,
    kdfSalt: parsed.kdf.salt,
  };
  accessTokenCache = { token: result.accessToken, expiresAt: result.accessExpiresAt };
  await persistAuth({
    userId: result.userId,
    email,
    refreshToken: result.refreshToken,
    refreshExpiresAt: result.refreshExpiresAt,
    kdfSalt: result.kdfSalt,
  });
  return result;
}

export async function loadPersistedAuth(): Promise<PersistedAuth | null> {
  const r = await browser.storage.local.get(PERSISTED_KEY);
  const raw = r[PERSISTED_KEY];
  if (!raw) return null;
  const parsed = PersistedAuthSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function persistAuth(auth: PersistedAuth): Promise<void> {
  await browser.storage.local.set({ [PERSISTED_KEY]: auth });
}

export async function clearPersistedAuth(): Promise<void> {
  accessTokenCache = null;
  await browser.storage.local.remove(PERSISTED_KEY);
}

async function refreshAccessToken(): Promise<string> {
  const persisted = await loadPersistedAuth();
  if (!persisted) throw new Error('Not signed in');
  const res = await fetchWithTimeout(joinUrl('/v1/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: persisted.refreshToken }),
  });
  if (!res.ok) {
    // Refresh token unusable — wipe local state, force re-sign-in.
    await clearPersistedAuth();
    throw new Error('Session expired — sign in again');
  }
  const parsed = RefreshResponseSchema.parse(await res.json());
  accessTokenCache = { token: parsed.accessToken, expiresAt: parsed.accessExpiresAt };
  await persistAuth({
    ...persisted,
    refreshToken: parsed.refreshToken,
    refreshExpiresAt: parsed.refreshExpiresAt,
  });
  return parsed.accessToken;
}

/**
 * Returns a fresh access token, refreshing if cache is stale. Throws
 * if not signed in or refresh fails (caller renders sign-in CTA).
 */
export async function getAccessToken(): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Use cached token if it still has > 60s left (avoid using one
  // about to expire mid-request).
  if (accessTokenCache && accessTokenCache.expiresAt - nowSeconds > 60) {
    return accessTokenCache.token;
  }
  return refreshAccessToken();
}

export async function signOut(): Promise<void> {
  const persisted = await loadPersistedAuth();
  if (persisted) {
    try {
      await fetchWithTimeout(joinUrl('/v1/auth/signout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: persisted.refreshToken }),
      });
    } catch {
      // Best-effort; sign-out is local-authoritative.
    }
  }
  await clearPersistedAuth();
}

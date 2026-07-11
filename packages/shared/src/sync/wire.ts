/**
 * Wire-format schemas + helpers for the `/v1/sync/vault` API.
 *
 * Pure logic: no `fetch`, no `chrome.*`. The HTTP client in
 * `apps/editor/lib/sync.ts` (W7-impl) sits on top of these.
 *
 * Mirrors the worker's request/response shape exactly so a schema
 * mismatch surfaces in tests on either side.
 */

import { z } from 'zod';

/** Same as the worker's `KdfMetaSchema`. Kept symmetric on purpose. */
export const SyncKdfMetaSchema = z
  .object({
    algo: z.literal('PBKDF2-SHA256'),
    // Defence in depth: reject KDF metadata below the mandated 600K floor
    // (ADR-0006) so a poisoned server response can't push a client onto a
    // downgraded iteration count. The AEAD tag would reject the resulting
    // key anyway, but we refuse to even construct it.
    iterations: z.number().int().min(600_000),
    salt: z.string().min(1).max(128),
  })
  .strict();
export type SyncKdfMeta = z.infer<typeof SyncKdfMetaSchema>;

/** Body shape the client sends in `PUT /v1/sync/vault`. */
export const VaultPutBodySchema = z
  .object({
    // Mirror of the worker's 2 MiB cap (routes/sync.ts). A cookie vault is
    // KB-scale; the ceiling bounds request/response amplification.
    ciphertext: z
      .string()
      .min(1)
      .max(2 * 1024 * 1024),
    kdfMeta: SyncKdfMetaSchema,
    sha256Hint: z.string().min(1).max(128),
  })
  .strict();
export type VaultPutBody = z.infer<typeof VaultPutBodySchema>;

/** Body shape the worker returns from `GET /v1/sync/vault`. */
export const VaultGetResponseSchema = z
  .object({
    ciphertext: z.string().min(1),
    sha256Hint: z.string().min(1).max(128),
    kdfMeta: SyncKdfMetaSchema,
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type VaultGetResponse = z.infer<typeof VaultGetResponseSchema>;

/** 412 conflict body. */
export const VaultConflictBodySchema = z
  .object({
    error: z.literal('precondition_failed'),
    currentSha256Hint: z.string(),
  })
  .strict();
export type VaultConflictBody = z.infer<typeof VaultConflictBodySchema>;

/** Encode a `PUT` body for sending. JSON because the server parses JSON. */
export function serializeVaultPut(body: VaultPutBody): string {
  return JSON.stringify(VaultPutBodySchema.parse(body));
}

/** Decode a `GET` response. Throws on schema mismatch. */
export function parseVaultGet(raw: unknown): VaultGetResponse {
  return VaultGetResponseSchema.parse(raw);
}

/** Decode a 412 body. Returns `null` if the shape doesn't match. */
export function parseVaultConflict(raw: unknown): VaultConflictBody | null {
  const parsed = VaultConflictBodySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

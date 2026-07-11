import { z } from 'zod';

export const SameSiteSchema = z.enum(['no_restriction', 'lax', 'strict', 'unspecified']);
export type SameSite = z.infer<typeof SameSiteSchema>;

export const PartitionKeySchema = z
  .object({
    topLevelSite: z.string().optional(),
    hasCrossSiteAncestor: z.boolean().optional(),
  })
  .strict();
export type PartitionKey = z.infer<typeof PartitionKeySchema>;

/**
 * Mirrors `chrome.cookies.Cookie` (MV3, including CHIPS partitionKey).
 * Kept as a zod schema so we can validate JSON imports at runtime.
 */
export const CookieSchema = z
  .object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    hostOnly: z.boolean(),
    path: z.string(),
    secure: z.boolean(),
    httpOnly: z.boolean(),
    sameSite: SameSiteSchema,
    session: z.boolean(),
    expirationDate: z.number().optional(),
    storeId: z.string().optional(),
    partitionKey: PartitionKeySchema.optional(),
  })
  .strict();
export type Cookie = z.infer<typeof CookieSchema>;

/**
 * Stable string identity for a cookie within a store.
 * Two cookies are "the same" iff (domain, path, name) match per RFC 6265.
 */
export function cookieIdentity(c: Pick<Cookie, 'domain' | 'path' | 'name'>): string {
  return `${c.domain}|${c.path}|${c.name}`;
}

/**
 * CookieVault's own export format. Versioned so we can evolve without
 * breaking older exports. Always emit version 1 until we have a real
 * reason to bump.
 */
export const CookieVaultExportSchema = z
  .object({
    format: z.literal('cookievault/v1'),
    exportedAt: z.string(),
    cookies: z.array(CookieSchema),
  })
  .strict();
export type CookieVaultExport = z.infer<typeof CookieVaultExportSchema>;

/**
 * EditThisCookie's export shape — a bare array of cookie-like objects
 * with slightly looser typing (sameSite can be null, has an `id` field).
 * Used at import time to accept legacy exports from migrating users.
 */
export const EditThisCookieExportSchema = z.array(
  z
    .object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      hostOnly: z.boolean(),
      path: z.string(),
      secure: z.boolean(),
      httpOnly: z.boolean(),
      sameSite: z.union([SameSiteSchema, z.string(), z.null()]).optional(),
      session: z.boolean(),
      expirationDate: z.number().optional(),
      storeId: z.string().optional(),
      id: z.number().optional(),
    })
    .passthrough(),
);
export type EditThisCookieExport = z.infer<typeof EditThisCookieExportSchema>;

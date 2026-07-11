/**
 * SHA-256 helpers.
 *
 * The single place client code should hash through, so `crypto.subtle`
 * stays confined to `packages/shared/crypto` (CLAUDE.md red-line). Note
 * the sync layer has its own `sha256OfString` for the vault-freshness
 * hint; this one is the general-purpose crypto-facade entry point.
 */

/** SHA-256 over raw bytes or a UTF-8 string. Returns the 32-byte digest. */
export async function sha256(data: BufferSource | string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return new Uint8Array(digest);
}

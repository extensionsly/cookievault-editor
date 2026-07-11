/**
 * Client-side ETag parser, mirrors `apps/worker/src/lib/etag.ts`.
 *
 * The wire format is `W/"<version>"` (weak) — see ADR-0009. Strong
 * ETags are tolerated on parse because some HTTP proxies rewrite
 * quoting; we never produce strong tags ourselves.
 */

export interface ParsedEtag {
  version: number;
  weak: boolean;
}

export function parseEtagHeader(value: string | null | undefined): ParsedEtag | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const weak = trimmed.startsWith('W/');
  const noWeak = weak ? trimmed.slice(2) : trimmed;
  const match = /^"(\d+)"$/.exec(noWeak);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isInteger(n) || n < 0) return null;
  return { version: n, weak };
}

/** Format an If-Match header value. Always weak — see ADR-0009. */
export function formatIfMatch(version: number): string {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`formatIfMatch: version must be a non-negative integer, got ${version}`);
  }
  return `W/"${version}"`;
}

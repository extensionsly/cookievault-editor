/**
 * SHA-256 helpers used as the client-side `sha256Hint` of the
 * ciphertext (ADR-0009 §"sha256_hint short-circuit"). Pure — no
 * `fetch`, no `chrome.*`.
 */

import { toBase64Url } from '../crypto/random.js';

export async function sha256Base64Url(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toBase64Url(new Uint8Array(digest));
}

export async function sha256OfString(s: string): Promise<string> {
  return sha256Base64Url(new TextEncoder().encode(s));
}

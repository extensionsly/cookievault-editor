/**
 * Pure classification of a sync conflict.
 *
 * The actual modal UI lives in the editor (W7-impl). This module
 * answers one question: given a local sha256-hint and the remote
 * sha256-hint the worker sent back in a 412 body, is the conflict
 * a genuine divergence or a false-positive (same bytes, stale etag)?
 *
 * Per ADR-0009 §"Decision detail / sha256_hint short-circuit", the
 * worker already does this check server-side and returns 204 for
 * identical content. This function is for the *client* — to defend
 * against a worker version that doesn't short-circuit yet, or to
 * pre-classify before showing a "your changes vs. theirs" modal.
 */

export type ConflictClassification = 'identical' | 'real-conflict';

export function classifyConflict(
  localSha256Hint: string,
  remoteSha256Hint: string,
): ConflictClassification {
  if (typeof localSha256Hint !== 'string' || typeof remoteSha256Hint !== 'string') {
    return 'real-conflict';
  }
  if (localSha256Hint.length === 0 || remoteSha256Hint.length === 0) {
    return 'real-conflict';
  }
  return localSha256Hint === remoteSha256Hint ? 'identical' : 'real-conflict';
}

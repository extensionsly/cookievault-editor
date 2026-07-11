/**
 * Pure rate-limit state machine for vault unlock attempts.
 *
 * Policy (MVP, intentionally simple):
 *   - N consecutive wrong passphrases → lockout for L milliseconds.
 *   - After lockout window expires, the next attempt is a "fresh"
 *     streak (failures reset to 1; lock NOT re-applied until N hits again).
 *   - Successful unlock immediately clears the state.
 *
 * Storage backing is the caller's problem — `apps/editor/lib/profile-store.ts`
 * persists to `chrome.storage.session` (RAM-only, browser-quit clears it).
 * Tests stay pure here in shared.
 */

import { z } from 'zod';

export const FAILURES_BEFORE_LOCKOUT = 5;
export const LOCKOUT_MS = 60_000;

export const RateLimitStateSchema = z
  .object({
    failures: z.number().int().min(0),
    /** Epoch ms when the current lockout ends; absent when not locked. */
    lockedUntil: z.number().int().positive().optional(),
  })
  .strict();
export type RateLimitState = z.infer<typeof RateLimitStateSchema>;

export const EMPTY: RateLimitState = { failures: 0 };

/** True iff `now` is before the active `lockedUntil` window. */
export function isLockedOut(state: RateLimitState, nowMs: number): boolean {
  return state.lockedUntil !== undefined && nowMs < state.lockedUntil;
}

/** Whole seconds remaining; 0 when not locked or already expired. */
export function secondsUntilUnlock(state: RateLimitState, nowMs: number): number {
  if (!isLockedOut(state, nowMs)) return 0;
  // `lockedUntil` is defined here because isLockedOut returned true.
  const remainingMs = state.lockedUntil! - nowMs;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

/**
 * Record a failed unlock attempt. Returns the next state. Caller persists.
 *
 *   - If a previous lockout has expired, the streak resets to 1 (this is a
 *     fresh attempt window; we don't re-lock until N more failures).
 *   - Otherwise increment. If we cross N, set a new `lockedUntil`.
 */
export function recordFailure(state: RateLimitState, nowMs: number): RateLimitState {
  if (state.lockedUntil !== undefined && nowMs >= state.lockedUntil) {
    // The clock has crossed the previous lockout — start a fresh streak.
    return { failures: 1 };
  }
  const failures = state.failures + 1;
  if (state.lockedUntil !== undefined) {
    // Still inside the active lockout window — honour the original end
    // time. We don't extend the punishment on each extra attempt; the
    // UI is supposed to disable submit anyway. Bump failures for telemetry.
    return { failures, lockedUntil: state.lockedUntil };
  }
  if (failures >= FAILURES_BEFORE_LOCKOUT) {
    return { failures, lockedUntil: nowMs + LOCKOUT_MS };
  }
  return { failures };
}

/** Successful unlock — drop the streak entirely. */
export function clearFailures(): RateLimitState {
  return EMPTY;
}

import { describe, expect, it } from 'vitest';
import {
  EMPTY,
  FAILURES_BEFORE_LOCKOUT,
  LOCKOUT_MS,
  RateLimitStateSchema,
  clearFailures,
  isLockedOut,
  recordFailure,
  secondsUntilUnlock,
} from '../rate-limit.js';

const T0 = 1_700_000_000_000;

describe('isLockedOut', () => {
  it('false for empty state', () => {
    expect(isLockedOut(EMPTY, T0)).toBe(false);
  });

  it('true while now < lockedUntil', () => {
    const state = { failures: 5, lockedUntil: T0 + LOCKOUT_MS };
    expect(isLockedOut(state, T0)).toBe(true);
    expect(isLockedOut(state, T0 + LOCKOUT_MS - 1)).toBe(true);
  });

  it('false once now >= lockedUntil', () => {
    const state = { failures: 5, lockedUntil: T0 + LOCKOUT_MS };
    expect(isLockedOut(state, T0 + LOCKOUT_MS)).toBe(false);
    expect(isLockedOut(state, T0 + LOCKOUT_MS + 1000)).toBe(false);
  });
});

describe('secondsUntilUnlock', () => {
  it('0 for empty state', () => {
    expect(secondsUntilUnlock(EMPTY, T0)).toBe(0);
  });

  it('ceils to whole seconds remaining', () => {
    const state = { failures: 5, lockedUntil: T0 + 30_500 };
    expect(secondsUntilUnlock(state, T0)).toBe(31);
  });

  it('returns 0 once the window has elapsed', () => {
    const state = { failures: 5, lockedUntil: T0 + 60_000 };
    expect(secondsUntilUnlock(state, T0 + 60_001)).toBe(0);
  });
});

describe('recordFailure', () => {
  it('increments from empty', () => {
    expect(recordFailure(EMPTY, T0)).toEqual({ failures: 1 });
  });

  it('keeps incrementing below threshold without locking', () => {
    let state: ReturnType<typeof recordFailure> = EMPTY;
    for (let i = 1; i < FAILURES_BEFORE_LOCKOUT; i++) {
      state = recordFailure(state, T0 + i);
      expect(state.failures).toBe(i);
      expect(state.lockedUntil).toBeUndefined();
    }
  });

  it(`locks on the ${FAILURES_BEFORE_LOCKOUT}th consecutive failure`, () => {
    let state: ReturnType<typeof recordFailure> = EMPTY;
    for (let i = 1; i <= FAILURES_BEFORE_LOCKOUT; i++) {
      state = recordFailure(state, T0);
    }
    expect(state.failures).toBe(FAILURES_BEFORE_LOCKOUT);
    expect(state.lockedUntil).toBe(T0 + LOCKOUT_MS);
  });

  it('resets to a fresh streak when called after a lockout expires', () => {
    const locked = { failures: FAILURES_BEFORE_LOCKOUT, lockedUntil: T0 + LOCKOUT_MS };
    // After the lockout window passes, the next failed attempt does NOT
    // immediately re-lock — it starts a fresh 5-attempt streak.
    const next = recordFailure(locked, T0 + LOCKOUT_MS + 1);
    expect(next.failures).toBe(1);
    expect(next.lockedUntil).toBeUndefined();
  });

  it('keeps incrementing while still locked (no-op for UX, but state grows)', () => {
    // This shouldn't actually happen in practice — UI disables submit while
    // locked — but the function must remain pure / total. Within-lockout
    // calls just grow the streak count.
    const state = { failures: FAILURES_BEFORE_LOCKOUT, lockedUntil: T0 + LOCKOUT_MS };
    const next = recordFailure(state, T0 + 1000);
    expect(next.failures).toBe(FAILURES_BEFORE_LOCKOUT + 1);
    expect(next.lockedUntil).toBe(T0 + LOCKOUT_MS); // still original lockout end
  });
});

describe('clearFailures', () => {
  it('returns empty state', () => {
    expect(clearFailures()).toEqual(EMPTY);
  });

  it('drops any prior lockout', () => {
    expect(clearFailures()).toEqual({ failures: 0 });
  });
});

describe('RateLimitStateSchema', () => {
  it('accepts empty state', () => {
    expect(RateLimitStateSchema.safeParse(EMPTY).success).toBe(true);
  });

  it('accepts a locked state', () => {
    expect(
      RateLimitStateSchema.safeParse({ failures: 5, lockedUntil: T0 + LOCKOUT_MS }).success,
    ).toBe(true);
  });

  it('rejects negative failures', () => {
    expect(RateLimitStateSchema.safeParse({ failures: -1 }).success).toBe(false);
  });

  it('rejects non-positive lockedUntil', () => {
    expect(RateLimitStateSchema.safeParse({ failures: 0, lockedUntil: 0 }).success).toBe(false);
  });
});

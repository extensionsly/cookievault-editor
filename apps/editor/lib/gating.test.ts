import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decideGate,
  GATING_ENFORCED,
  PRO_FEATURES,
  requireFeature,
  type ProFeature,
} from './gating.js';
import * as entitlement from './pro/entitlement.js';

afterEach(() => vi.restoreAllMocks());

describe('gating policy', () => {
  it('ships with enforcement off (boundary not yet locked — W6-13 / ADR-0013)', () => {
    expect(GATING_ENFORCED).toBe(false);
  });

  it('allows every Pro feature while enforcement is off, without consulting the plan', async () => {
    const proSpy = vi.spyOn(entitlement, 'getProStatus');
    for (const { feature } of PRO_FEATURES) {
      const r = await requireFeature(feature);
      expect(r).toEqual({ allowed: true, feature, reason: 'enforced-off' });
    }
    // Enforcement off must not even query entitlement — it's a pure short-circuit.
    expect(proSpy).not.toHaveBeenCalled();
  });

  it('exposes a stable, de-duplicated feature list', () => {
    const ids = PRO_FEATURES.map((f) => f.feature);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain<ProFeature>('cloud-sync');
    expect(ids).toContain<ProFeature>('multi-profile');
  });
});

describe('decideGate — the pure policy call sites rely on when enforced', () => {
  it('short-circuits to enforced-off regardless of plan', () => {
    expect(decideGate('cloud-sync', { enforced: false, isPro: false })).toEqual({
      allowed: true,
      feature: 'cloud-sync',
      reason: 'enforced-off',
    });
  });

  it('a Pro user (paid or trialing) is allowed', () => {
    expect(decideGate('multi-profile', { enforced: true, isPro: true })).toEqual({
      allowed: true,
      feature: 'multi-profile',
      reason: 'pro',
    });
  });

  it('blocks a free user and offers upgrade', () => {
    expect(decideGate('cloud-sync', { enforced: true, isPro: false })).toEqual({
      allowed: false,
      feature: 'cloud-sync',
      reason: 'free-blocked',
    });
  });
});

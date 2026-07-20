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
  it('ships with the production boundary enforced', () => {
    expect(GATING_ENFORCED).toBe(true);
  });

  it('allows every declared Pro feature for an entitled user', async () => {
    const proSpy = vi.spyOn(entitlement, 'getProStatus').mockResolvedValue(true);
    for (const { feature } of PRO_FEATURES) {
      const r = await requireFeature(feature);
      expect(r).toEqual({ allowed: true, feature, reason: 'pro' });
    }
    expect(proSpy).toHaveBeenCalledTimes(PRO_FEATURES.length);
  });

  it('exposes a stable, de-duplicated feature list', () => {
    const ids = PRO_FEATURES.map((f) => f.feature);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain<ProFeature>('cloud-sync');
    expect(ids).toContain<ProFeature>('multi-profile');
    expect(ids).toEqual(['multi-profile', 'profile-switching', 'cloud-sync']);
  });

  it('blocks every declared Pro feature for a free user', async () => {
    vi.spyOn(entitlement, 'getProStatus').mockResolvedValue(false);
    for (const { feature } of PRO_FEATURES) {
      await expect(requireFeature(feature)).resolves.toEqual({
        allowed: false,
        feature,
        reason: 'free-blocked',
      });
    }
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

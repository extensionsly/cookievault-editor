import { afterEach, describe, expect, it, vi } from 'vitest';
import { UPGRADE_BASE_URL, buildUpgradeUrl, openUpgrade } from './checkout.js';

afterEach(() => vi.restoreAllMocks());

describe('buildUpgradeUrl', () => {
  it('defaults to a recommended plan with extension attribution', () => {
    const url = new URL(buildUpgradeUrl());
    expect(`${url.origin}${url.pathname}`).toBe(UPGRADE_BASE_URL);
    expect(url.searchParams.get('plan')).toBe('recommended');
    expect(url.searchParams.get('utm_source')).toBe('extension');
    expect(url.searchParams.get('utm_medium')).toBe('editor');
    expect(url.searchParams.get('uid')).toBeNull();
    expect(url.searchParams.get('feature')).toBeNull();
  });

  it('carries uid, plan, feature deep-link and attribution source', () => {
    const url = new URL(
      buildUpgradeUrl({
        userId: 'user-123',
        plan: 'lifetime',
        feature: 'cloud-sync',
        source: 'editor-account',
      }),
    );
    expect(url.searchParams.get('uid')).toBe('user-123');
    expect(url.searchParams.get('plan')).toBe('lifetime');
    expect(url.searchParams.get('feature')).toBe('cloud-sync');
    expect(url.searchParams.get('utm_medium')).toBe('editor-account');
  });

  it('url-encodes a hostile user id rather than injecting query params', () => {
    const url = new URL(buildUpgradeUrl({ userId: 'a&plan=hacked' }));
    expect(url.searchParams.get('uid')).toBe('a&plan=hacked');
    expect(url.searchParams.get('plan')).toBe('recommended');
  });
});

describe('openUpgrade', () => {
  it('opens the hosted checkout via chrome.tabs.create', async () => {
    const create = vi.fn().mockResolvedValue({});
    (chrome.tabs as unknown as { create: typeof create }).create = create;
    await openUpgrade({ userId: 'u1', plan: 'annual' });
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0] as { url: string };
    const url = new URL(arg.url);
    expect(url.searchParams.get('uid')).toBe('u1');
    expect(url.searchParams.get('plan')).toBe('annual');
  });
});

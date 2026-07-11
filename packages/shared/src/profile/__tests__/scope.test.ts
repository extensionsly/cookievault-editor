import { describe, expect, it } from 'vitest';
import type { Cookie } from '../../schema/cookie.js';
import {
  BUILT_IN_SCOPES,
  FACEBOOK_SCOPE,
  GOOGLE_SCOPE,
  type Scope,
  cookieIdentityKey,
  cookieInScope,
  findScope,
  hostMatchesBase,
  mergeScopedCookies,
} from '../scope.js';

const baseCookie: Cookie = {
  name: 'c_user',
  value: '42',
  domain: '',
  hostOnly: false,
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  session: true,
};

describe('hostMatchesBase', () => {
  it('matches exact host', () => {
    expect(hostMatchesBase('facebook.com', 'facebook.com')).toBe(true);
  });

  it('matches proper subdomain', () => {
    expect(hostMatchesBase('m.facebook.com', 'facebook.com')).toBe(true);
    expect(hostMatchesBase('www.facebook.com', 'facebook.com')).toBe(true);
    expect(hostMatchesBase('business.facebook.com', 'facebook.com')).toBe(true);
  });

  it('strips leading dot from cookie host', () => {
    expect(hostMatchesBase('.facebook.com', 'facebook.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(hostMatchesBase('FACEBOOK.COM', 'facebook.com')).toBe(true);
    expect(hostMatchesBase('M.FaceBook.Com', 'facebook.com')).toBe(true);
  });

  it('rejects bare suffix collisions', () => {
    expect(hostMatchesBase('notfacebook.com', 'facebook.com')).toBe(false);
    expect(hostMatchesBase('myfacebook.com', 'facebook.com')).toBe(false);
  });

  it('rejects unrelated domain', () => {
    expect(hostMatchesBase('messenger.com', 'facebook.com')).toBe(false);
    expect(hostMatchesBase('instagram.com', 'facebook.com')).toBe(false);
  });

  it('rejects empty base', () => {
    expect(hostMatchesBase('facebook.com', '')).toBe(false);
  });
});

describe('cookieInScope', () => {
  it('keeps Facebook host-only cookies', () => {
    expect(cookieInScope({ ...baseCookie, domain: 'facebook.com' }, FACEBOOK_SCOPE)).toBe(true);
  });

  it('keeps Facebook domain cookies (leading dot)', () => {
    expect(cookieInScope({ ...baseCookie, domain: '.facebook.com' }, FACEBOOK_SCOPE)).toBe(true);
  });

  it('keeps Facebook subdomain cookies', () => {
    expect(cookieInScope({ ...baseCookie, domain: 'm.facebook.com' }, FACEBOOK_SCOPE)).toBe(true);
    expect(cookieInScope({ ...baseCookie, domain: 'www.facebook.com' }, FACEBOOK_SCOPE)).toBe(true);
  });

  it('drops cookies for unrelated domains', () => {
    expect(cookieInScope({ ...baseCookie, domain: 'messenger.com' }, FACEBOOK_SCOPE)).toBe(false);
    expect(cookieInScope({ ...baseCookie, domain: 'notfacebook.com' }, FACEBOOK_SCOPE)).toBe(false);
  });
});

describe('findScope', () => {
  it('finds built-in scope by id', () => {
    expect(findScope('facebook')).toBe(FACEBOOK_SCOPE);
    expect(findScope('google')).toBe(GOOGLE_SCOPE);
  });

  it('returns undefined for unknown id', () => {
    expect(findScope('unknown')).toBeUndefined();
  });
});

describe('BUILT_IN_SCOPES', () => {
  it('has unique ids', () => {
    const ids = BUILT_IN_SCOPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has non-empty hosts', () => {
    for (const s of BUILT_IN_SCOPES) {
      expect(s.hosts.length).toBeGreaterThan(0);
      for (const h of s.hosts) {
        expect(h.length).toBeGreaterThan(0);
        expect(h.startsWith('.')).toBe(false);
        expect(h).toBe(h.toLowerCase());
      }
    }
  });
});

describe('cookieInScope (multi-host: Google)', () => {
  it('keeps google.com host-only cookies', () => {
    expect(cookieInScope({ ...baseCookie, domain: 'google.com' }, GOOGLE_SCOPE)).toBe(true);
  });

  it('keeps .google.com domain cookies (identity SID/HSID/etc)', () => {
    expect(cookieInScope({ ...baseCookie, domain: '.google.com' }, GOOGLE_SCOPE)).toBe(true);
  });

  it('keeps subdomain cookies (accounts.google.com, mail.google.com)', () => {
    expect(cookieInScope({ ...baseCookie, domain: 'accounts.google.com' }, GOOGLE_SCOPE)).toBe(
      true,
    );
    expect(cookieInScope({ ...baseCookie, domain: 'mail.google.com' }, GOOGLE_SCOPE)).toBe(true);
  });

  it('keeps the youtube.com side of the same account', () => {
    expect(cookieInScope({ ...baseCookie, domain: 'youtube.com' }, GOOGLE_SCOPE)).toBe(true);
    expect(cookieInScope({ ...baseCookie, domain: '.youtube.com' }, GOOGLE_SCOPE)).toBe(true);
    expect(cookieInScope({ ...baseCookie, domain: 'm.youtube.com' }, GOOGLE_SCOPE)).toBe(true);
  });

  it('drops international TLDs (deliberate MVP limit)', () => {
    expect(cookieInScope({ ...baseCookie, domain: 'google.co.uk' }, GOOGLE_SCOPE)).toBe(false);
    expect(cookieInScope({ ...baseCookie, domain: 'google.de' }, GOOGLE_SCOPE)).toBe(false);
    expect(cookieInScope({ ...baseCookie, domain: 'youtu.be' }, GOOGLE_SCOPE)).toBe(false);
  });

  it('drops Google-shaped collision domains', () => {
    expect(cookieInScope({ ...baseCookie, domain: 'notgoogle.com' }, GOOGLE_SCOPE)).toBe(false);
    expect(cookieInScope({ ...baseCookie, domain: 'fakegoogle.com' }, GOOGLE_SCOPE)).toBe(false);
    expect(cookieInScope({ ...baseCookie, domain: 'evilyoutube.com' }, GOOGLE_SCOPE)).toBe(false);
  });

  it('drops unrelated domains', () => {
    expect(cookieInScope({ ...baseCookie, domain: 'facebook.com' }, GOOGLE_SCOPE)).toBe(false);
  });

  it('keeps Facebook scope and Google scope disjoint', () => {
    const fb: Cookie = { ...baseCookie, domain: '.facebook.com' };
    const g: Cookie = { ...baseCookie, domain: '.google.com' };
    const yt: Cookie = { ...baseCookie, domain: '.youtube.com' };
    expect(cookieInScope(fb, FACEBOOK_SCOPE)).toBe(true);
    expect(cookieInScope(fb, GOOGLE_SCOPE)).toBe(false);
    expect(cookieInScope(g, GOOGLE_SCOPE)).toBe(true);
    expect(cookieInScope(g, FACEBOOK_SCOPE)).toBe(false);
    expect(cookieInScope(yt, GOOGLE_SCOPE)).toBe(true);
    expect(cookieInScope(yt, FACEBOOK_SCOPE)).toBe(false);
  });
});

describe('cookieIdentityKey', () => {
  it('treats two cookies with the same (domain, path, name) as equal', () => {
    const a: Cookie = { ...baseCookie, domain: '.fb.com', path: '/', name: 'c_user' };
    const b: Cookie = { ...baseCookie, domain: '.fb.com', path: '/', name: 'c_user' };
    expect(cookieIdentityKey(a)).toBe(cookieIdentityKey(b));
  });

  it('separates cookies with different partitionKey (CHIPS)', () => {
    const a: Cookie = {
      ...baseCookie,
      domain: '.example.com',
      path: '/',
      name: 'sid',
      partitionKey: { topLevelSite: 'https://news.site' },
    };
    const b: Cookie = {
      ...baseCookie,
      domain: '.example.com',
      path: '/',
      name: 'sid',
      partitionKey: { topLevelSite: 'https://other.site' },
    };
    expect(cookieIdentityKey(a)).not.toBe(cookieIdentityKey(b));
  });

  it('separates partitioned vs unpartitioned twin', () => {
    const unpartitioned: Cookie = { ...baseCookie, domain: 'example.com', path: '/', name: 'sid' };
    const partitioned: Cookie = {
      ...unpartitioned,
      partitionKey: { topLevelSite: 'https://x.com' },
    };
    expect(cookieIdentityKey(unpartitioned)).not.toBe(cookieIdentityKey(partitioned));
  });

  it('separates default vs incognito store', () => {
    const a: Cookie = {
      ...baseCookie,
      domain: 'example.com',
      path: '/',
      name: 'sid',
      storeId: '0',
    };
    const b: Cookie = {
      ...baseCookie,
      domain: 'example.com',
      path: '/',
      name: 'sid',
      storeId: '1',
    };
    expect(cookieIdentityKey(a)).not.toBe(cookieIdentityKey(b));
  });
});

describe('mergeScopedCookies', () => {
  /** Make a minimal cookie shape compatible with the mergeScopedCookies generic. */
  function c(domain: string, name: string, extra: Partial<Cookie> = {}): Cookie {
    return { ...baseCookie, domain, name, ...extra };
  }

  it('returns [] for empty input', () => {
    expect(mergeScopedCookies([], FACEBOOK_SCOPE)).toEqual([]);
    expect(mergeScopedCookies([[]], FACEBOOK_SCOPE)).toEqual([]);
  });

  it('filters out-of-scope cookies', () => {
    const list = [c('messenger.com', 'sid'), c('.facebook.com', 'c_user')];
    const out = mergeScopedCookies([list], FACEBOOK_SCOPE);
    expect(out.map((x) => x.name)).toEqual(['c_user']);
  });

  it('merges per-host lists for a multi-host scope', () => {
    const googleList = [c('.google.com', 'SID'), c('accounts.google.com', 'GAPS')];
    const youtubeList = [c('.youtube.com', 'YSC'), c('m.youtube.com', 'VISITOR_INFO1_LIVE')];
    const out = mergeScopedCookies([googleList, youtubeList], GOOGLE_SCOPE);
    expect(out.map((x) => x.name).sort()).toEqual(
      ['GAPS', 'SID', 'VISITOR_INFO1_LIVE', 'YSC'].sort(),
    );
  });

  it('dedups cookies returned for two overlapping hosts', () => {
    // A scope with overlapping bases — `mail.google.com` is a subdomain
    // of `google.com`, so chrome.cookies.getAll for each host returns
    // the same cookie. Without dedup we'd count + delete it twice.
    const overlapScope: Scope = {
      id: 'goverlap',
      label: 'Google (overlap)',
      hosts: ['google.com', 'mail.google.com'],
    };
    const googleList = [c('.google.com', 'SID'), c('mail.google.com', 'GMAIL_AT')];
    // getAll({domain:'mail.google.com'}) returns mail.google.com cookies,
    // which already appeared in the google.com result.
    const mailList = [c('mail.google.com', 'GMAIL_AT')];
    const out = mergeScopedCookies([googleList, mailList], overlapScope);
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.name).sort()).toEqual(['GMAIL_AT', 'SID']);
  });

  it('keeps CHIPS twins separate during dedup', () => {
    const unpart = c('example.com', 'sid');
    const part1: Cookie = {
      ...unpart,
      partitionKey: { topLevelSite: 'https://news.site' },
    };
    const part2: Cookie = {
      ...unpart,
      partitionKey: { topLevelSite: 'https://blog.site' },
    };
    const scope: Scope = { id: 'ex', label: 'Example', hosts: ['example.com'] };
    const out = mergeScopedCookies([[unpart, part1, part2, unpart]], scope);
    expect(out).toHaveLength(3);
  });

  it('preserves first-seen order across host lists', () => {
    const list1 = [c('.google.com', 'a'), c('.google.com', 'b')];
    const list2 = [c('.youtube.com', 'c'), c('.google.com', 'a')];
    const out = mergeScopedCookies([list1, list2], GOOGLE_SCOPE);
    expect(out.map((x) => x.name)).toEqual(['a', 'b', 'c']);
  });
});

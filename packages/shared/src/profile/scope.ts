import type { Cookie } from '../schema/cookie.js';

/**
 * A named set of host suffixes used to scope profile save / clear /
 * switch to a single site (e.g. all of Facebook, all of Google).
 *
 * Hosts are *bare* (no leading dot, lowercase). Matching is:
 *   - exact host match  (`facebook.com` matches `facebook.com`), or
 *   - proper subdomain  (`facebook.com` matches `m.facebook.com`).
 *
 * `notfacebook.com` does NOT match `facebook.com` — we never substring
 * match, which is the bug a naive `endsWith` would have.
 */
export interface Scope {
  id: string;
  label: string;
  hosts: readonly string[];
}

/**
 * Default scope for Facebook test-account switching.
 *
 * `chrome.cookies.getAll({domain: "facebook.com"})` is itself inclusive
 * by suffix, so this single base covers `.facebook.com`,
 * `m.facebook.com`, `www.facebook.com`, `business.facebook.com`, etc.
 */
export const FACEBOOK_SCOPE: Scope = {
  id: 'facebook',
  label: 'Facebook',
  hosts: ['facebook.com'],
};

/**
 * Default scope for Google account switching.
 *
 * Google's identity cookies live on `.google.com`; the YouTube side of
 * the same account lives on `.youtube.com`. Both must move together —
 * if you only swap google.com cookies, refreshing youtube.com still
 * shows the old account, because YouTube has its own mirror of the
 * session.
 *
 * Not included intentionally:
 *   - international TLDs (`google.de`, `google.co.uk`, …). These are
 *     separate eTLD+1s. Users who actively log into a country TLD can
 *     add a custom scope later (post-MVP).
 *   - `googleusercontent.com` / `gstatic.com` — static asset domains,
 *     no session cookies worth carrying.
 */
export const GOOGLE_SCOPE: Scope = {
  id: 'google',
  label: 'Google',
  hosts: ['google.com', 'youtube.com'],
};

export const BUILT_IN_SCOPES: readonly Scope[] = [FACEBOOK_SCOPE, GOOGLE_SCOPE];

export function findScope(id: string): Scope | undefined {
  return BUILT_IN_SCOPES.find((s) => s.id === id);
}

function normaliseHost(host: string): string {
  return host.replace(/^\./, '').toLowerCase();
}

/** Is `host` either equal to `base` or a proper subdomain of `base`? */
export function hostMatchesBase(host: string, base: string): boolean {
  const h = normaliseHost(host);
  const b = normaliseHost(base);
  if (b.length === 0) return false;
  if (h === b) return true;
  return h.endsWith('.' + b);
}

export function cookieInScope(
  cookie: Pick<Cookie, 'domain'>,
  scope: Pick<Scope, 'hosts'>,
): boolean {
  for (const base of scope.hosts) {
    if (hostMatchesBase(cookie.domain, base)) return true;
  }
  return false;
}

/**
 * Stable identity for a cookie within a browser cookie store, used to
 * dedup multi-host scope reads. Two cookies are "the same" iff
 * (domain, path, name, storeId, partitionKey) all match.
 *
 * partitionKey matters because CHIPS-partitioned cookies and their
 * unpartitioned twin can coexist with identical name/domain/path.
 */
export function cookieIdentityKey(
  c: Pick<Cookie, 'domain' | 'path' | 'name' | 'storeId' | 'partitionKey'>,
): string {
  const partition = c.partitionKey
    ? `${c.partitionKey.topLevelSite ?? ''}|${c.partitionKey.hasCrossSiteAncestor ?? ''}`
    : '';
  return `${c.domain}|${c.path}|${c.name}|${c.storeId ?? ''}|${partition}`;
}

/**
 * Merge per-host cookie lists (one per `scope.hosts[i]`) into a single
 * scoped, deduped list. Pure — no chrome.* calls.
 *
 * Why this lives here: `chrome.cookies.getAll({domain})` is inclusive
 * by suffix, so for a multi-host scope two calls can return the same
 * cookie (e.g. scope hosts `['google.com', 'mail.google.com']` —
 * `getAll({domain:'google.com'})` already includes mail.google.com).
 * Extracting the merge keeps the test in shared, away from chrome mocks.
 */
export function mergeScopedCookies<
  T extends Pick<Cookie, 'domain' | 'path' | 'name' | 'storeId' | 'partitionKey'>,
>(perHostLists: ReadonlyArray<ReadonlyArray<T>>, scope: Pick<Scope, 'hosts'>): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const list of perHostLists) {
    for (const c of list) {
      if (!cookieInScope(c, scope)) continue;
      const k = cookieIdentityKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

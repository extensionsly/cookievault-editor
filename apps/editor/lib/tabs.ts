/**
 * The ONLY editor module (besides existing call sites) that should reach
 * for `browser.tabs.*` — keeps tab access auditable in one place, mirroring
 * the cookies.ts red-line. New tab usage goes here.
 */

import { browser } from 'wxt/browser';

/**
 * Hostname of the active tab, or null when there is no http(s) page in
 * focus (e.g. chrome:// pages, the new-tab page, or query failure).
 */
export async function getActiveTabHost(): Promise<string | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    const u = new URL(tab.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname;
  } catch {
    return null;
  }
}

/**
 * Does a cookie's domain apply to `host`? True for an exact host match and
 * for domain cookies covering a subdomain (`.example.com` ⊇ `x.example.com`).
 */
export function hostMatchesDomain(host: string, cookieDomain: string): boolean {
  const dk = cookieDomain.replace(/^\./, '');
  return host === dk || host.endsWith(`.${dk}`);
}

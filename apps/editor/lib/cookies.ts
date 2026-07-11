/**
 * Thin wrappers around the `browser.cookies.*` API, lifting our
 * `Cookie` schema into the browser's slightly-different `SetDetails`
 * shape and centralising error handling.
 *
 * Anything in this module is allowed to touch `browser.cookies.*`; nothing
 * elsewhere in apps/editor should — push browser calls down through
 * here so tests in @cookievault/shared can stay platform-neutral.
 */

import { browser, type Browser } from 'wxt/browser';
import {
  type Cookie,
  cookieIdentity,
  cookieUrl,
  parseImport,
  serializeExport,
} from '@cookievault/shared/schema';

export async function listCookies(): Promise<Cookie[]> {
  const list = await browser.cookies.getAll({});
  return list as unknown as Cookie[];
}

/**
 * Inclusive suffix match: returns cookies whose domain equals `domain`
 * or is a subdomain of it. The browser's own filter is already suffix-
 * inclusive, so this is a thin pass-through; routed through here only
 * to keep `browser.cookies.*` calls confined to this module per the
 * project red-line rule.
 */
export async function listCookiesByDomain(domain: string): Promise<Cookie[]> {
  const list = await browser.cookies.getAll({ domain });
  return list as unknown as Cookie[];
}

export async function setCookie(c: Cookie): Promise<Browser.cookies.Cookie | null> {
  const details: Browser.cookies.SetDetails = {
    url: cookieUrl(c),
    name: c.name,
    value: c.value,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
  };
  // Chrome derives hostOnly from the *absence* of `domain` in SetDetails:
  //   - omit domain → cookie is locked to the URL's exact host
  //   - include domain (e.g. ".example.com") → cookie covers subdomains
  if (!c.hostOnly) details.domain = c.domain;
  if (!c.session && c.expirationDate !== undefined) {
    details.expirationDate = c.expirationDate;
  }
  if (c.storeId) details.storeId = c.storeId;
  if (c.partitionKey) {
    details.partitionKey = c.partitionKey as Browser.cookies.CookiePartitionKey;
  }
  return browser.cookies.set(details);
}

export async function removeCookie(
  c: Pick<Cookie, 'domain' | 'path' | 'secure' | 'name' | 'storeId' | 'partitionKey'>,
): Promise<void> {
  const details: Browser.cookies.CookieDetails = {
    url: cookieUrl(c),
    name: c.name,
  };
  if (c.storeId) details.storeId = c.storeId;
  if (c.partitionKey) {
    details.partitionKey = c.partitionKey as Browser.cookies.CookiePartitionKey;
  }
  const result = await browser.cookies.remove(details);
  if (!result) {
    throw new Error(
      `browser.cookies.remove returned null — host permission missing or cookie already gone.`,
    );
  }
}

/**
 * Save an edit. If the cookie's identity (domain / path / name) changed
 * we first remove the original so we don't leave a stale duplicate.
 */
export async function saveCookie(original: Cookie | null, updated: Cookie): Promise<void> {
  if (original && cookieIdentity(original) !== cookieIdentity(updated)) {
    try {
      await removeCookie(original);
    } catch {
      // The original may already be gone (e.g. browser cleared it). Don't
      // block the save on a redundant delete.
    }
  }
  const result = await setCookie(updated);
  if (!result) {
    throw new Error(
      'browser.cookies.set returned null — check the URL, host permissions, and field values.',
    );
  }
}

export interface ImportSummary {
  source: 'cookievault/v1' | 'editthiscookie';
  total: number;
  ok: number;
  failed: Array<{ name: string; domain: string; error: string }>;
}

export async function importCookies(text: string): Promise<ImportSummary> {
  const { source, cookies } = parseImport(text);
  const summary: ImportSummary = { source, total: cookies.length, ok: 0, failed: [] };
  for (const c of cookies) {
    try {
      const r = await setCookie(c);
      if (r) {
        summary.ok += 1;
      } else {
        summary.failed.push({ name: c.name, domain: c.domain, error: 'set returned null' });
      }
    } catch (err) {
      summary.failed.push({
        name: c.name,
        domain: c.domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

export function downloadExport(cookies: Cookie[]): void {
  const json = serializeExport(cookies);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cookievault-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

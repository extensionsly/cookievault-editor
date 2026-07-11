/**
 * Profile orchestration: list / clear / apply cookies inside a Scope,
 * and the high-level profile-switch flow with rollback.
 *
 * All `browser.cookies.*` and `browser.tabs.*` calls stay confined to
 * this module (and `cookies.ts`) per the project red-line rule.
 */

import { browser } from 'wxt/browser';
import {
  type Cookie,
  type Profile,
  type Scope,
  cookieInScope,
  hostMatchesBase,
  mergeScopedCookies,
} from '@cookievault/shared';
import { listCookiesByDomain, removeCookie, setCookie } from './cookies.js';

export interface ApplyOutcome {
  applied: number;
  failures: Array<{ name: string; domain: string; error: string }>;
}

export interface SwitchOutcome extends ApplyOutcome {
  /** Cookies attempted from the profile (after scope filtering). */
  attempted: number;
  rolledBack: boolean;
  affectedTabs: number;
}

function isInScopeHost(host: string, scope: Pick<Scope, 'hosts'>): boolean {
  for (const base of scope.hosts) {
    if (hostMatchesBase(host, base)) return true;
  }
  return false;
}

export async function listCookiesInScope(scope: Scope): Promise<Cookie[]> {
  // `browser.cookies.getAll({domain})` is itself an inclusive suffix
  // match, but it only accepts one base at a time. Fan out per host,
  // then let the shared helper filter + dedup (tested in shared,
  // so the multi-host overlap / CHIPS-partition cases stay covered).
  const perHost = await Promise.all(scope.hosts.map((h) => listCookiesByDomain(h)));
  return mergeScopedCookies(perHost, scope);
}

export async function clearCookiesInScope(scope: Scope): Promise<number> {
  const current = await listCookiesInScope(scope);
  let removed = 0;
  for (const c of current) {
    try {
      await removeCookie(c);
      removed += 1;
    } catch {
      // Best-effort: a missing cookie or partition-key mismatch should
      // not abort the whole clear. We surface partial failures via the
      // caller's own diff (length comparison) if it cares.
    }
  }
  return removed;
}

export async function applyCookies(cookies: Cookie[]): Promise<ApplyOutcome> {
  let applied = 0;
  const failures: ApplyOutcome['failures'] = [];
  for (const c of cookies) {
    try {
      const r = await setCookie(c);
      if (r) applied += 1;
      else failures.push({ name: c.name, domain: c.domain, error: 'set returned null' });
    } catch (err) {
      failures.push({
        name: c.name,
        domain: c.domain,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { applied, failures };
}

async function countScopeTabs(scope: Scope): Promise<number> {
  const tabs = await browser.tabs.query({});
  let n = 0;
  for (const t of tabs) {
    if (!t.url) continue;
    try {
      const host = new URL(t.url).hostname;
      if (isInScopeHost(host, scope)) n += 1;
    } catch {
      // Ignore tabs with non-http URLs (chrome://, about:, etc.)
    }
  }
  return n;
}

/**
 * Switch the live browser cookie store to match `target` within
 * `scope`. Flow:
 *   1. snapshot current cookies in scope (rollback set)
 *   2. delete current cookies in scope
 *   3. set target's cookies (those that fall inside scope)
 *   4. if 0 applied and target had cookies → re-clear + re-apply snapshot
 *
 * Returns metrics + tab refresh hint. Caller decides what to surface.
 */
export async function switchProfile(target: Profile, scope: Scope): Promise<SwitchOutcome> {
  const rollback = await listCookiesInScope(scope);
  await clearCookiesInScope(scope);
  const targetInScope = target.cookies.filter((c) => cookieInScope(c, scope));
  const apply = await applyCookies(targetInScope);
  let rolledBack = false;
  if (apply.applied === 0 && targetInScope.length > 0) {
    await clearCookiesInScope(scope);
    await applyCookies(rollback);
    rolledBack = true;
  }
  const affectedTabs = await countScopeTabs(scope);
  return {
    attempted: targetInScope.length,
    applied: apply.applied,
    failures: apply.failures,
    rolledBack,
    affectedTabs,
  };
}

export async function reloadScopeTabs(scope: Scope): Promise<number> {
  const tabs = await browser.tabs.query({});
  let reloaded = 0;
  for (const t of tabs) {
    if (!t.url || t.id === undefined) continue;
    try {
      const host = new URL(t.url).hostname;
      if (!isInScopeHost(host, scope)) continue;
      await browser.tabs.reload(t.id);
      reloaded += 1;
    } catch {
      // Ignore tabs we can't reload (DevTools, chrome://, gone, etc.)
    }
  }
  return reloaded;
}

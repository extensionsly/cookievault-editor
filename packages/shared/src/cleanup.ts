/**
 * Pure cleanup decision logic for Guardian.
 *
 * Lives in @cookievault/shared (no `chrome.*`) so it can be exhaustively
 * tested without spinning up a fake browser. The caller — the
 * Guardian Service Worker — is responsible for actually invoking
 * `chrome.cookies.remove` based on the decision returned here.
 */

import { z } from 'zod';
import type { Cookie } from './schema/cookie.js';
import { type Rule, type RuleAction, findMatchingRule } from './schema/rule.js';

/**
 * What the Service Worker should do with the cookie.
 *
 *   - `delete`                — remove it now.
 *   - `keep`                  — leave it (an `allow` rule / default).
 *   - `protect-while-tab-open`— would clean on close, but a tab is open.
 *   - `protect-login`         — would be deleted, but it looks like a
 *                               login/session cookie and the login-
 *                               protection safety net kicked in. Treated
 *                               as a keep by the engine.
 */
export type CleanupDecision = 'delete' | 'keep' | 'protect-while-tab-open' | 'protect-login';

/**
 * Catch-all action when no rule matches a cookie. Whatever the user
 * picked in Guardian settings.
 *
 * Two MVP defaults make sense:
 *   - `allow`            — Safe Mode. Only delete cookies for domains
 *                          explicitly listed with a cleanup action.
 *   - `clean-on-close`   — Cookie AutoDelete parity. Default-greylist
 *                          everything; whitelist is opt-in.
 *
 * `clean-immediately` is technically allowed by the type but is too
 * destructive as a default — the popup should refuse to set it.
 */
export type DefaultAction = RuleAction;

export const GuardianSettingsSchema = z
  .object({
    defaultAction: z.enum(['allow', 'clean-on-close', 'clean-immediately']),
    /**
     * Login-protection safety net. When on (the default), a cookie that
     * looks like a login/session cookie is never auto-deleted — unless
     * the user set an explicit `clean-immediately` rule for its domain.
     * `.default(true)` migrates older stored settings that predate this
     * field without a write.
     */
    protectLogins: z.boolean().default(true),
    /**
     * When on, cleaning a host's cookies also clears its other site data
     * (localStorage, IndexedDB, cache storage, service workers). Requires
     * the optional `browsingData` permission, which the UI requests at
     * runtime — so this can be `true` in settings only after the user
     * granted it. Defaults off to keep the base permission surface minimal.
     */
    clearSiteData: z.boolean().default(false),
  })
  .strict();
export type GuardianSettings = z.infer<typeof GuardianSettingsSchema>;

/**
 * Recommended default: auto-clean unlisted sites' cookies when their last
 * tab closes. This makes the product's promise true out of the box — the
 * whole reason to install Guardian is auto-delete. `protectLogins: true` is
 * the safety net: login/session cookies survive the sweep unless the user
 * sets an explicit clean-immediately rule, so a fresh user isn't logged out
 * of sites they use. Users who want a whitelist-only posture pick "Safe mode"
 * in onboarding (or flip the default in the popup). See UX audit F1.
 */
export const DEFAULT_GUARDIAN_SETTINGS: GuardianSettings = {
  defaultAction: 'clean-on-close',
  protectLogins: true,
  clearSiteData: false,
};

/**
 * Substrings that strongly suggest a cookie carries auth/session state.
 * Matched case-insensitively against the cookie name. Deliberately
 * conservative: a false positive merely keeps a cookie that could have
 * been cleaned; a false negative risks logging the user out.
 */
const LOGIN_COOKIE_NAME_HINTS = [
  'sid',
  'sess',
  'session',
  'auth',
  'token',
  'login',
  'csrf',
  'xsrf',
  'remember',
  'jwt',
  '__secure-',
  '__host-',
];

/**
 * Heuristic — NOT exact. True when a cookie looks like it holds
 * login/session state and should survive auto-cleanup under the
 * safety net:
 *   - its name contains a known auth/session hint, OR
 *   - it is a session cookie (no expiry) that is also `httpOnly`
 *     (the typical shape of a server-set session id).
 */
export function looksLikeLoginCookie(
  cookie: Pick<Cookie, 'name' | 'session' | 'httpOnly'>,
): boolean {
  const name = cookie.name.toLowerCase();
  if (LOGIN_COOKIE_NAME_HINTS.some((hint) => name.includes(hint))) return true;
  if (cookie.session && cookie.httpOnly) return true;
  return false;
}

export interface TabState {
  /**
   * Set of hosts (no leading dot, lowercase) with at least one open
   * tab. Maintained by the Service Worker; passed in here for purity.
   */
  hostsWithOpenTabs: ReadonlySet<string>;
}

/**
 * Is any open tab loading a page that would see this cookie?
 *
 *   - Host-only cookie (`hostOnly: true`, no leading dot in domain):
 *     only sent to the exact host.
 *   - Domain cookie (leading-dot form, e.g. `.example.com`): sent to
 *     the host AND any subdomain.
 */
export function isProtectedByTabState(
  cookie: Pick<Cookie, 'domain' | 'hostOnly'>,
  openHosts: ReadonlySet<string>,
): boolean {
  const cleanDomain = cookie.domain.replace(/^\./, '').toLowerCase();
  for (const host of openHosts) {
    const h = host.toLowerCase();
    if (h === cleanDomain) return true;
    if (!cookie.hostOnly && h.endsWith('.' + cleanDomain)) return true;
  }
  return false;
}

/**
 * Decide what to do with a single cookie given the rule set, the
 * current tab state, and the global default.
 *
 *   1. Find the first rule whose pattern matches `cookie.domain`.
 *   2. If no rule matched, fall back to `settings.defaultAction`.
 *   3. Map the chosen action to a decision:
 *        - allow              → keep
 *        - clean-immediately  → delete
 *        - clean-on-close     → protect-while-tab-open  (tab open)
 *                              / delete                  (no tab)
 *   4. Login-protection safety net: if the decision came out `delete`
 *      and `settings.protectLogins` is on and the cookie looks like a
 *      login cookie, downgrade to `protect-login` — UNLESS the user set
 *      an explicit `clean-immediately` rule for the domain (explicit
 *      intent wins over the safety net).
 */
export function decideCleanup(
  cookie: Pick<Cookie, 'domain' | 'hostOnly' | 'name' | 'session' | 'httpOnly'>,
  rules: readonly Rule[],
  tabState: TabState,
  settings: GuardianSettings,
): CleanupDecision {
  const matched = findMatchingRule(cookie.domain, rules);
  const action: RuleAction = matched ? matched.action : settings.defaultAction;

  if (action === 'allow') return 'keep';

  const wouldDelete =
    action === 'clean-immediately' || !isProtectedByTabState(cookie, tabState.hostsWithOpenTabs);
  if (!wouldDelete) {
    // Only reachable for clean-on-close with a tab still open.
    return 'protect-while-tab-open';
  }

  const explicitKill = matched?.action === 'clean-immediately';
  if (settings.protectLogins && !explicitKill && looksLikeLoginCookie(cookie)) {
    return 'protect-login';
  }
  return 'delete';
}

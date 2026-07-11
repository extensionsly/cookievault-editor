/**
 * Upgrade funnel hand-off.
 *
 * MV3-compliant by design: the extension never embeds Paddle.js or any other
 * remotely-hosted checkout script — doing so would be remotely-hosted code and
 * draw a "Blue Argon" rejection (CRI red line). Instead we hand off to the
 * website's hosted Paddle checkout (cookievault.net/upgrade), carrying the user
 * id, a preselected plan, the originating feature, and attribution so the
 * funnel deep-links to the right SKU and is measurable end-to-end.
 *
 * After a successful purchase the Paddle webhook updates the worker
 * (`/v1/billing/webhook` → D1 `subscriptions`); the next entitlement refresh in
 * the extension then sees `plan: 'pro'`. See ADR-0008.
 */

import { browser } from 'wxt/browser';
import type { ProFeature } from './gating.js';

export const UPGRADE_BASE_URL = 'https://cookievault.net/upgrade';

/** Plan to preselect on the hosted checkout. `recommended` lets the site pick. */
export type UpgradePlan = 'recommended' | 'monthly' | 'annual' | 'lifetime';

export interface UpgradeOptions {
  /** Worker user id, so checkout can attribute the purchase back to the account. */
  userId?: string;
  /** Plan to preselect; defaults to `recommended`. */
  plan?: UpgradePlan;
  /** The feature that triggered the upgrade, for deep-linking + analytics. */
  feature?: ProFeature;
  /** Attribution surface, e.g. `editor-account`, `editor-popup`. */
  source?: string;
}

/**
 * Build the hosted-checkout URL. Pure and deterministic — the unit under test.
 */
export function buildUpgradeUrl(opts: UpgradeOptions = {}): string {
  const url = new URL(UPGRADE_BASE_URL);
  if (opts.userId) url.searchParams.set('uid', opts.userId);
  url.searchParams.set('plan', opts.plan ?? 'recommended');
  if (opts.feature) url.searchParams.set('feature', opts.feature);
  url.searchParams.set('utm_source', 'extension');
  url.searchParams.set('utm_medium', opts.source ?? 'editor');
  return url.toString();
}

/**
 * Open the hosted checkout in a new tab. Works from both the popup and the
 * options page (uses `browser.tabs.create` when available, else `window.open`).
 */
export async function openUpgrade(opts: UpgradeOptions = {}): Promise<void> {
  const url = buildUpgradeUrl(opts);
  if (browser?.tabs?.create) {
    await browser.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

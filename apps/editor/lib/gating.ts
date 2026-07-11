/**
 * Pro feature policy — the single source of truth for which features are Pro,
 * and the gating-ready check that call sites use.
 *
 * The Free/Pro boundary is NOT enforced yet: `GATING_ENFORCED` is `false`
 * until the boundary is validated and locked (W6-13 — 15 interviews + lifetime
 * smoke test, ADR-0013). While it is off, `requireFeature()` always allows, so
 * shipping today changes no user-visible behaviour. But the policy list, the
 * deep-link plumbing (`lib/checkout.ts`) and the tests already route through
 * this module — so locking the boundary becomes a one-line flip of
 * `GATING_ENFORCED` plus wiring `await requireFeature(...)` at the handful of
 * call sites, rather than a scavenger hunt across the codebase.
 *
 * Trials are server-side and account-bound (extensionsly `/v1/trial/start`,
 * ADR-0015 §3.4): a trial simply issues a signed entitlement credential, so a
 * trial user reads as Pro through `getProStatus()`. There is deliberately no
 * local trial clock here — a local clock can't survive uninstall/reinstall and
 * is a licensing-standard red line.
 */

import { getProStatus } from './pro/entitlement.js';

/** Features the PRD / ADR-0004 designate as Pro (Editor scope). */
export type ProFeature =
  | 'multi-profile' // Free is capped at 1 saved profile; Pro = unlimited
  | 'profile-switching'
  | 'cloud-sync' // E2E encrypted cross-device sync
  | 'cookie-history'
  | 'data-export';

export interface ProFeatureMeta {
  readonly feature: ProFeature;
  /** Stable English label for analytics / dev prompts (not user-facing i18n). */
  readonly label: string;
}

export const PRO_FEATURES: readonly ProFeatureMeta[] = [
  { feature: 'multi-profile', label: 'Unlimited cookie profiles' },
  { feature: 'profile-switching', label: 'One-click profile switching' },
  { feature: 'cloud-sync', label: 'End-to-end encrypted cloud sync' },
  { feature: 'cookie-history', label: 'Cookie change history' },
  { feature: 'data-export', label: 'CSV / HAR export' },
];

/**
 * Master switch. Stays `false` until the Free/Pro boundary is locked
 * (W6-13, ADR-0013). Flip to `true` in the same change that locks the
 * boundary — every gate below it then enforces at once.
 */
export const GATING_ENFORCED = false as boolean;

/**
 * Why a gate resolved the way it did.
 * `enforced-off` — gating not yet locked (always allowed today);
 * `pro` — user is entitled (paid or in an active server-side trial);
 * `free-blocked` — gated, offer upgrade.
 */
export type GateReason = 'enforced-off' | 'pro' | 'free-blocked';

export interface GateResult {
  readonly allowed: boolean;
  readonly feature: ProFeature;
  readonly reason: GateReason;
}

/** Inputs a gate decision depends on — kept explicit so the policy is a pure fn. */
export interface GateInputs {
  readonly enforced: boolean;
  readonly isPro: boolean;
}

/**
 * The pure gate policy. Given the world state, decide access for a feature.
 * This is the contract call sites rely on the moment `GATING_ENFORCED` flips;
 * `requireFeature` is just the async wiring that gathers the inputs. A paid or
 * trialing user is `isPro` (the trial credential entitles them); everyone else
 * is blocked with an upgrade offer.
 */
export function decideGate(feature: ProFeature, inputs: GateInputs): GateResult {
  if (!inputs.enforced) return { allowed: true, feature, reason: 'enforced-off' };
  if (inputs.isPro) return { allowed: true, feature, reason: 'pro' };
  return { allowed: false, feature, reason: 'free-blocked' };
}

/**
 * The gating-ready check. Until `GATING_ENFORCED` is true this resolves to
 * `{ allowed: true, reason: 'enforced-off' }` for every feature — call sites
 * can adopt it now with zero behavioural change. Never throws.
 *
 * When enforced, the dual-channel Pro status (offline license ‖ online signed
 * credential, incl. an active server-side trial) decides. Entitlement is only
 * queried when enforcement is on — the off path stays a pure short-circuit.
 */
export async function requireFeature(feature: ProFeature): Promise<GateResult> {
  if (!GATING_ENFORCED) return decideGate(feature, { enforced: false, isPro: false });
  const pro = await getProStatus();
  return decideGate(feature, { enforced: true, isPro: pro });
}

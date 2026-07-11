/**
 * Pro entitlement — dual-channel OR, per the extensionsly licensing standard
 * (ADR-0015):
 *
 *   isPro = offline license key verifies ‖ online signed credential entitles
 *
 * The license key lives in storage.sync (a purchase is a cross-device right;
 * the key is self-verifying so syncing it is safe). Account tokens and the
 * online credential live in storage.local via ./account. Both channels
 * re-verify cryptographically on every read — there is no trusted local
 * boolean anywhere (LIC-01).
 *
 * Shared by the background SW and pages; pages wrap their own reactive state
 * on top. `getCachedPro()` serves synchronous paths (e.g. user-gesture
 * handlers) from a memory cache hydrated by `initProCache()`.
 */

import { browser } from 'wxt/browser';
import { verifyLicense, type LicenseResult } from './license.js';
import { getOnlinePro, onAccountChanged } from './account.js';

/** storage.sync key for the offline license — standard invariant. */
export const LICENSE_STORAGE_KEY = 'proLicense';

export async function getStoredLicense(): Promise<string | null> {
  const raw =
    (await browser.storage.sync.get(LICENSE_STORAGE_KEY))[LICENSE_STORAGE_KEY] ??
    (await browser.storage.local.get(LICENSE_STORAGE_KEY))[LICENSE_STORAGE_KEY];
  return typeof raw === 'string' ? raw : null;
}

/** Offline channel: is the locally stored license valid? Re-verifies the
 * signature every time — tampered storage simply stops validating. */
export async function getOfflinePro(): Promise<boolean> {
  const key = await getStoredLicense();
  if (!key) return false;
  return (await verifyLicense(key)).valid;
}

/** Current Pro status: offline license ‖ online account entitlement. */
export async function getProStatus(): Promise<boolean> {
  return (await getOfflinePro()) || (await getOnlinePro());
}

/** Activate a license: store only if the signature verifies. Returns the
 * verification result so the UI can map the four error reasons. */
export async function activateLicense(key: string): Promise<LicenseResult> {
  const result = await verifyLicense(key);
  if (result.valid) {
    await browser.storage.sync.set({ [LICENSE_STORAGE_KEY]: key.trim() }).catch(async () => {
      // storage.sync unavailable (e.g. some Firefox configs) → local fallback.
      await browser.storage.local.set({ [LICENSE_STORAGE_KEY]: key.trim() });
    });
  }
  return result;
}

/** Remove the license from this machine (does not invalidate the key). */
export async function deactivateLicense(): Promise<void> {
  await browser.storage.sync.remove(LICENSE_STORAGE_KEY).catch(() => {});
  await browser.storage.local.remove(LICENSE_STORAGE_KEY).catch(() => {});
}

// —— Memory cache for synchronous callers (background gesture paths) ——
let cachedPro = false;

export function getCachedPro(): boolean {
  return cachedPro;
}

/** Call once at SW/page startup: hydrates the Pro cache and re-hydrates on
 * any license/account change. Optional `onChange` fires on transitions. */
export async function initProCache(onChange?: (pro: boolean) => void): Promise<boolean> {
  const rehydrate = () =>
    void getProStatus().then((p) => {
      const changed = p !== cachedPro;
      cachedPro = p;
      if (changed) onChange?.(p);
    });
  browser.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' || area === 'local') && LICENSE_STORAGE_KEY in changes) rehydrate();
  });
  onAccountChanged(rehydrate);
  cachedPro = await getProStatus();
  return cachedPro;
}

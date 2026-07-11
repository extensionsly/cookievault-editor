/**
 * Client-side telemetry beacon (ADR-0012).
 *
 * Default OFF. The user must explicitly opt in via the Account section
 * in Options. No URL, cookie-domain, email, or other PII ever leaves
 * the device. The server further strips client IP at ingress.
 *
 * MVP scope: error reports only. Future iterations may add anonymised
 * usage metrics, gated by the same opt-in flag.
 */

import { browser } from 'wxt/browser';
import { z } from 'zod';
import { sha256, toBase64Url } from '@cookievault/shared';
import { getAccessToken, WORKER_BASE_URL, loadPersistedAuth } from './auth.js';
import { fetchWithTimeout } from './http.js';

export const TELEMETRY_OPT_IN_KEY = 'cookievault.telemetry.optIn.v1';

const OptInSchema = z.object({ optIn: z.boolean() }).strict();

export async function getTelemetryOptIn(): Promise<boolean> {
  const r = await browser.storage.local.get(TELEMETRY_OPT_IN_KEY);
  const raw = r[TELEMETRY_OPT_IN_KEY];
  if (raw === undefined) return false;
  const parsed = OptInSchema.safeParse(raw);
  return parsed.success ? parsed.data.optIn : false;
}

export async function setTelemetryOptIn(value: boolean): Promise<void> {
  await browser.storage.local.set({ [TELEMETRY_OPT_IN_KEY]: { optIn: value } });
}

/**
 * Anonymised hash of a string, used to convert an error message into
 * a stable diagnostic key without sending the raw text.
 */
async function digestHash(s: string): Promise<string> {
  // First 12 bytes is enough for grouping; reduces leak surface vs full 32.
  const bytes = (await sha256(s)).slice(0, 12);
  return toBase64Url(bytes);
}

/**
 * Strip anything that looks like a URL, email, or domain from a string.
 * Defense-in-depth — the worker also re-scrubs, but never trust the
 * client either way.
 */
export function sanitiseDiagnosticString(s: string): string {
  return s
    .replace(/https?:\/\/[^\s]+/g, '<url>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+){1,}\b/g, '<domain>')
    .slice(0, 500);
}

const RUNTIME = navigator?.userAgent?.includes('Firefox') ? 'firefox-mv2' : 'chromium-mv3';

const EXT_VERSION = browser.runtime.getManifest().version;

export interface ReportErrorContext {
  feature?: string;
}

/**
 * Report a client-side error. No-op when opted out or not signed in.
 * Fire-and-forget — never blocks the caller.
 */
export async function reportError(err: unknown, ctx: ReportErrorContext = {}): Promise<void> {
  try {
    const optIn = await getTelemetryOptIn();
    if (!optIn) return;
    const auth = await loadPersistedAuth();
    if (!auth) return; // No identity yet → cannot attribute.
    const message = err instanceof Error ? err.message : String(err);
    const errorClass = err instanceof Error ? err.name : 'NonError';
    const sanitised = sanitiseDiagnosticString(message);
    const errorMessageHash = await digestHash(sanitised);
    const accessToken = await getAccessToken().catch(() => '');
    if (!accessToken) return;
    const payload = {
      eventType: 'error',
      feature: ctx.feature ?? 'unknown',
      runtime: RUNTIME,
      extVersion: EXT_VERSION,
      errorClass,
      errorMessageHash,
    };
    await fetchWithTimeout(`${WORKER_BASE_URL.replace(/\/$/, '')}/v1/telemetry/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Telemetry must never throw into application paths.
  }
}

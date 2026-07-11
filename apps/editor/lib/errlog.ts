/**
 * Local error ring buffer — the troubleshooting channel under the zero-telemetry red line
 * (resilience.md §2). Errors are written to `storage.local` (capped, never
 * leaves the browser) so a user can copy diagnostics into a GitHub issue by
 * hand. No SDK, no auto-upload.
 *
 * Every function is failure-proof: logging an error must never throw a new
 * one, and corrupt stored data is treated as empty, not fatal.
 */
import { browser } from 'wxt/browser';

const STORAGE_KEY = 'cookievault.editor.errlog.v1';
const MAX_ENTRIES = 50;
const REPORT_BASE = 'https://github.com/xiaobaocms/CookieVault/issues/new';

export interface ErrEntry {
  /** epoch ms */
  t: number;
  /** entrypoint / context, e.g. "bootstrap", "window.error" */
  ctx: string;
  /** error name + message, truncated */
  msg: string;
  /** first stack line, truncated */
  at?: string;
}

function extVersion(): string {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return 'unknown';
  }
}

function summarize(error: unknown): { msg: string; at?: string } {
  if (error instanceof Error) {
    const first = (error.stack ?? '').split('\n')[1]?.trim();
    return {
      msg: `${error.name}: ${error.message}`.slice(0, 300),
      at: first ? first.slice(0, 200) : undefined,
    };
  }
  return { msg: String(error).slice(0, 300) };
}

/** Append an error to the ring buffer. Never throws. */
export async function logError(error: unknown, ctx: string): Promise<void> {
  try {
    const { msg, at } = summarize(error);
    const entry: ErrEntry = { t: Date.now(), ctx, msg, at };
    const prev = await readErrors();
    const next = [...prev, entry].slice(-MAX_ENTRIES);
    await browser.storage.local.set({ [STORAGE_KEY]: next });
  } catch {
    /* storage full / unavailable — dropping a log line is acceptable, crashing is not */
  }
}

/** Read the ring buffer. Corrupt data reads as empty. Never throws. */
export async function readErrors(): Promise<ErrEntry[]> {
  try {
    const raw = (await browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is ErrEntry =>
        e && typeof e === 'object' && typeof e.t === 'number' && typeof e.msg === 'string',
    );
  } catch {
    return [];
  }
}

/** Clear the ring buffer. Never throws. */
export async function clearErrors(): Promise<void> {
  try {
    await browser.storage.local.remove(STORAGE_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * A prefilled "report a problem" URL: opens a GitHub issue with version,
 * browser UA and the most recent errors in the body. Synchronous best-effort
 * (recent errors passed in) so it can seed the fatal-error screen link.
 */
export function reportUrl(recent: ErrEntry[] = []): string {
  const lines = recent
    .slice(-5)
    .map((e) => `- [${e.ctx}] ${e.msg}${e.at ? ` (${e.at})` : ''}`)
    .join('\n');
  const body = [
    'What happened:',
    '',
    '',
    '---',
    `Extension: CookieVault Editor v${extVersion()}`,
    `Browser: ${navigator.userAgent}`,
    lines ? `Recent errors:\n${lines}` : 'Recent errors: (none captured)',
  ].join('\n');
  const q = new URLSearchParams({ title: '[Editor] ', body, labels: 'bug' });
  return `${REPORT_BASE}?${q.toString()}`;
}

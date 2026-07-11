/**
 * `fetch` with a hard timeout. Worker calls go through here so a slow or
 * black-holed network surfaces as an error in ~10s instead of hanging the
 * popup/options page indefinitely. On timeout the request is aborted and
 * `fetch` rejects with an `AbortError`.
 */

export const DEFAULT_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True for the two "the request never reached/returned from the server"
 * shapes: a network failure (`TypeError` from fetch) or our timeout abort
 * (`AbortError`). Used to show an "offline" message instead of a raw error.
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch network failure
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  return err instanceof Error && err.name === 'AbortError';
}

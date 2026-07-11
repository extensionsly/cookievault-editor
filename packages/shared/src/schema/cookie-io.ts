import {
  type Cookie,
  CookieVaultExportSchema,
  CookieSchema,
  EditThisCookieExportSchema,
  type SameSite,
} from './cookie.js';

/**
 * Compute a URL suitable for `chrome.cookies.{set,remove}` from a
 * cookie's identity fields. Chrome requires a URL whose host matches
 * the cookie's domain (with leading-dot subdomain semantics) and whose
 * scheme is `https` for secure cookies.
 *
 * Rules:
 *   - Strip a leading dot from `domain` (`.example.com` → `example.com`)
 *     since URLs don't carry that marker.
 *   - Default `path` to `/` if empty (Chrome treats both as root).
 *   - `https` when `secure`, otherwise `http`.
 */
export function cookieUrl(c: Pick<Cookie, 'domain' | 'path' | 'secure'>): string {
  const host = c.domain.replace(/^\./, '');
  const path = c.path || '/';
  return `${c.secure ? 'https' : 'http'}://${host}${path}`;
}

const SAME_SITE_VALUES = new Set<SameSite>(['no_restriction', 'lax', 'strict', 'unspecified']);

function coerceSameSite(raw: unknown): SameSite {
  if (typeof raw === 'string' && SAME_SITE_VALUES.has(raw as SameSite)) {
    return raw as SameSite;
  }
  // EditThisCookie sometimes emits null, "no_restriction" capitalised,
  // or omits the field entirely. Default to 'unspecified' so the browser
  // applies its own default treatment.
  return 'unspecified';
}

/**
 * Convert an arbitrary cookie-like record (typically from an
 * EditThisCookie export) into our strict {@link Cookie} shape.
 * Unknown extra fields are dropped.
 */
export function normalizeFromLegacy(raw: unknown): Cookie {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('normalizeFromLegacy: input must be an object');
  }
  const r = raw as Record<string, unknown>;
  return CookieSchema.parse({
    name: String(r.name ?? ''),
    value: String(r.value ?? ''),
    domain: String(r.domain ?? ''),
    hostOnly: Boolean(r.hostOnly),
    path: typeof r.path === 'string' && r.path.length > 0 ? r.path : '/',
    secure: Boolean(r.secure),
    httpOnly: Boolean(r.httpOnly),
    sameSite: coerceSameSite(r.sameSite),
    session: Boolean(r.session),
    expirationDate: typeof r.expirationDate === 'number' ? r.expirationDate : undefined,
    storeId: typeof r.storeId === 'string' ? r.storeId : undefined,
    partitionKey:
      typeof r.partitionKey === 'object' && r.partitionKey !== null
        ? (r.partitionKey as Cookie['partitionKey'])
        : undefined,
  });
}

export interface ParsedImport {
  source: 'cookievault/v1' | 'editthiscookie';
  cookies: Cookie[];
}

/**
 * Parse a JSON string that may be either:
 *   - a CookieVault-native export (`{format: "cookievault/v1", cookies: [...]}`)
 *   - a bare EditThisCookie-style array.
 *
 * Throws if the input is neither valid JSON nor a recognised shape.
 */
export function parseImport(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const native = CookieVaultExportSchema.safeParse(data);
  if (native.success) {
    return { source: 'cookievault/v1', cookies: native.data.cookies };
  }
  const legacy = EditThisCookieExportSchema.safeParse(data);
  if (legacy.success) {
    return {
      source: 'editthiscookie',
      cookies: legacy.data.map(normalizeFromLegacy),
    };
  }
  // Surface the more useful of the two error messages — for an object
  // that's structurally close to CookieVault, the native error is more
  // informative; otherwise the legacy schema's array-of-objects shape
  // gives a better hint.
  const isArrayish = Array.isArray(data);
  const err = isArrayish ? legacy.error : native.error;
  throw new Error(`Unrecognised cookie export format: ${err.issues[0]?.message ?? 'unknown'}`);
}

/** Serialise a list of cookies into the CookieVault v1 export format. */
export function serializeExport(cookies: Cookie[]): string {
  const payload = {
    format: 'cookievault/v1' as const,
    exportedAt: new Date().toISOString(),
    cookies,
  };
  return JSON.stringify(payload, null, 2);
}

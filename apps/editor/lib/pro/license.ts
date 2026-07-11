/**
 * Offline license verification — ECDSA P-256 signature, zero network.
 *
 * Purchases complete on the website's external checkout; the buyer gets a
 * signed license key and activates it here fully offline. The vendor holds
 * the private key (scripts/issue-license.mjs); the extension embeds only the
 * public keys. Clean-room implementation of the extensionsly licensing
 * standard (ADR-0015; chrome-repo docs/licensing.md §2, format **v2**).
 *
 * Format v2: the payload carries `v:2` + `kid` (key id). The verifier holds a
 * **public-key ring** keyed by kid — rotation appends a new kid in a new
 * release and keeps the old ones (every issued key stays honored forever); a
 * v1 key (no kid) falls back to DEFAULT_KID. A **revocation list**
 * (SHA-256 of leaked/refunded keys, shipped per version, zero network) is
 * checked BEFORE verification, since a revoked key's signature is still valid.
 * Signature is over the base64url STRING bytes of the payload.
 */

/**
 * Public-key ring: kid → vendor public key (safe to publish). Private keys
 * live in .keys/ (gitignored) and must never be committed.
 * kid = sha256hex(x + '.' + y).slice(0, 8) (printed by scripts/gen-keypair.mjs).
 */
const PUBLIC_KEY_RING: Record<string, JsonWebKey> = {
  '15b170f5': {
    kty: 'EC',
    crv: 'P-256',
    x: 'ONMGsq_P22TyTtyCItf5sm0kVzS9DCGp1c7YED2xQ_w',
    y: '4IxOaNg8H76aYDTkfp5w-YKWAAVcqDGJ6fFoMxptNic',
  },
};

/** Default key for v1 keys (payload has no kid). */
const DEFAULT_KID = '15b170f5';

/**
 * Revocation list: SHA-256 (lowercase hex) of the FULL text of leaked/refunded
 * keys. Source = the issuance audit (.keys/issued.jsonl `keySha256`); shipped
 * per extension version. Revokes individual bad keys; a full private-key
 * compromise is handled by rotation (append a new kid) per licensing.md §6-1.
 */
const REVOKED_KEY_HASHES: ReadonlySet<string> = new Set<string>([
  // No revocations yet.
]);

/** Product tag baked into every license payload; a key for another
 * extensionsly product must never unlock CookieVault (standard §6.4). */
const PRODUCT = 'cookievault-pro';

export interface LicensePayload {
  /** Format version (v1 keys omit this). */
  v?: number;
  /** Signing key id (ring routing; v1 keys omit this → DEFAULT_KID). */
  kid?: string;
  /** Product identifier — must equal `cookievault-pro`. */
  p: string;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Optional expiry (epoch seconds); lifetime keys omit it. */
  exp?: number;
  /** Optional buyer identifier (email/order id), display-only. */
  sub?: string;
  /** Optional order number (reconciliation / revocation tracing). */
  ord?: string;
}

export interface LicenseResult {
  valid: boolean;
  /** Maps 1:1 to the activation-form error messages. */
  reason?: 'format' | 'signature' | 'product' | 'expired' | 'revoked';
  payload?: LicensePayload;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ringKeyCache = new Map<string, Promise<CryptoKey>>();
function importRingKey(kid: string, jwk: JsonWebKey): Promise<CryptoKey> {
  let p = ringKeyCache.get(kid);
  if (!p) {
    p = crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ]);
    ringKeyCache.set(kid, p);
  }
  return p;
}

/** Decode the (unverified) payload just to read `kid` for ring routing — the
 * signature still covers the full payload bytes. */
function decodePayload(payloadB64: string): LicensePayload | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64))) as LicensePayload;
  } catch {
    return null;
  }
}

/**
 * Verify a license key (format `<payloadB64url>.<sigB64url>`). Fully offline:
 * revocation list → kid-routed ring → signature → product/expiry. Every
 * failure mode is fail-closed with a UI-mappable reason.
 */
export async function verifyLicense(key: string): Promise<LicenseResult> {
  const trimmed = key.trim();
  const dot = trimmed.indexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) return { valid: false, reason: 'format' };
  const payload = decodePayload(trimmed.slice(0, dot));
  if (!payload) return { valid: false, reason: 'format' };
  const kid = payload.kid ?? DEFAULT_KID;
  const jwk = PUBLIC_KEY_RING[kid];
  if (!jwk) return { valid: false, reason: 'signature' }; // unknown kid: nothing to verify against
  return verifyLicenseWithRing(
    trimmed,
    { [kid]: await importRingKey(kid, jwk) },
    kid,
    REVOKED_KEY_HASHES,
  );
}

/**
 * Verify against a SPECIFIC public key (skips ring routing + revocation).
 * Tests cover every branch with a throwaway runtime keypair, so the
 * production private key never appears in the repo; also reused internally
 * once the ring has selected a key.
 */
export async function verifyLicenseWithKey(
  key: string,
  publicKey: CryptoKey,
): Promise<LicenseResult> {
  const trimmed = key.trim();
  const dot = trimmed.indexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) return { valid: false, reason: 'format' };
  const payloadB64 = trimmed.slice(0, dot);
  const sigB64 = trimmed.slice(dot + 1);

  let sig: Uint8Array;
  let payloadBytes: Uint8Array;
  try {
    sig = b64urlToBytes(sigB64);
    payloadBytes = new TextEncoder().encode(payloadB64);
  } catch {
    return { valid: false, reason: 'format' };
  }

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      sig as unknown as BufferSource,
      payloadBytes as unknown as BufferSource,
    );
  } catch {
    return { valid: false, reason: 'signature' };
  }
  if (!ok) return { valid: false, reason: 'signature' };

  const payload = decodePayload(payloadB64);
  if (!payload) return { valid: false, reason: 'format' };
  if (payload.p !== PRODUCT) return { valid: false, reason: 'product', payload };
  if (payload.exp && Date.now() / 1000 > payload.exp) {
    return { valid: false, reason: 'expired', payload };
  }
  return { valid: true, payload };
}

/**
 * Ring-verification core: revocation list (before verification — a revoked
 * key's signature is still valid) → kid routing → signature. `verifyLicense`
 * calls this with the built-in ring/list; tests inject a throwaway ring and
 * list to cover every branch.
 */
export async function verifyLicenseWithRing(
  key: string,
  ring: Record<string, CryptoKey>,
  defaultKid: string,
  revoked: ReadonlySet<string> = new Set(),
): Promise<LicenseResult> {
  const trimmed = key.trim();
  const dot = trimmed.indexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) return { valid: false, reason: 'format' };
  if (revoked.has(await sha256Hex(trimmed))) return { valid: false, reason: 'revoked' };
  const payload = decodePayload(trimmed.slice(0, dot));
  if (!payload) return { valid: false, reason: 'format' };
  const publicKey = ring[payload.kid ?? defaultKid];
  if (!publicKey) return { valid: false, reason: 'signature' };
  return verifyLicenseWithKey(key, publicKey);
}

/** Full key text → revocation-list entry (hex sha256). Issuance audit and
 * revocation ops share this derivation. */
export { sha256Hex as licenseKeyHash };

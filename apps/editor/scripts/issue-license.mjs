// Issue a CookieVault Pro offline license key (format v2: v + kid, ring-routed).
// Run by the vendor after a purchase clears (manual channel — licensing.md §5.1).
// Usage:
//   node scripts/issue-license.mjs --sub buyer@example.com [--ord ORDER-123] [--exp 2027-01-01]
// Private key source: env COOKIEVAULT_LICENSE_PRIVATE_JWK, else .keys/private.jwk.
// Audit (licensing.md §5.3 P1): each issuance appends a line to .keys/issued.jsonl —
//   kid / product / sub / ord / iat / exp + the full key's SHA-256 (the revocation-list
//   entry). The full key itself is NOT recorded.
import { webcrypto, createHash } from 'node:crypto';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sub = arg('sub');
const ord = arg('ord');
const expStr = arg('exp');

let privJwk;
if (process.env.COOKIEVAULT_LICENSE_PRIVATE_JWK) {
  privJwk = JSON.parse(process.env.COOKIEVAULT_LICENSE_PRIVATE_JWK);
} else {
  try {
    privJwk = JSON.parse(readFileSync('.keys/private.jwk', 'utf8'));
  } catch {
    console.error(
      'No private key. Run node scripts/gen-keypair.mjs first, or set COOKIEVAULT_LICENSE_PRIVATE_JWK.',
    );
    process.exit(1);
  }
}

// kid = sha256hex(x + '.' + y).slice(0, 8) — matches gen-keypair.mjs and the ring.
const kid = createHash('sha256').update(`${privJwk.x}.${privJwk.y}`).digest('hex').slice(0, 8);

function b64url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const payload = { v: 2, kid, p: 'cookievault-pro', iat: Math.floor(Date.now() / 1000) };
if (sub) payload.sub = sub;
if (ord) payload.ord = ord;
if (expStr) {
  const exp = Math.floor(new Date(expStr).getTime() / 1000);
  if (!Number.isFinite(exp)) {
    console.error('Invalid --exp date (use YYYY-MM-DD).');
    process.exit(1);
  }
  payload.exp = exp;
}

const key = await webcrypto.subtle.importKey(
  'jwk',
  privJwk,
  { name: 'ECDSA', namedCurve: 'P-256' },
  false,
  ['sign'],
);
// Sign the base64url STRING bytes of the payload — issuer and verifier must
// agree on this exact input (licensing standard §6.3).
const payloadB64 = b64url(new TextEncoder().encode(JSON.stringify(payload)));
const sig = new Uint8Array(
  await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(payloadB64),
  ),
);
const license = `${payloadB64}.${b64url(sig)}`;

// Audit record (no full key; keySha256 = revocation-list entry).
const audit = {
  ts: new Date().toISOString(),
  kid,
  p: payload.p,
  sub: sub ?? null,
  ord: ord ?? null,
  iat: payload.iat,
  exp: payload.exp ?? null,
  keySha256: createHash('sha256').update(license).digest('hex'),
};
if (!existsSync('.keys')) mkdirSync('.keys', { recursive: true, mode: 0o700 });
appendFileSync('.keys/issued.jsonl', JSON.stringify(audit) + '\n', { mode: 0o600 });

console.error('payload:', JSON.stringify(payload));
console.error(
  'audit → .keys/issued.jsonl (to revoke, add keySha256 to license.ts REVOKED_KEY_HASHES)',
);
console.log(license);

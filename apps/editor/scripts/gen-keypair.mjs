// Generate the CookieVault offline-license signing keypair (ECDSA P-256) and
// print a ready-to-paste public-key-ring entry (with its kid).
// Private key goes to .keys/private.jwk (600, gitignored — NEVER committed);
// append the printed entry to lib/pro/license.ts PUBLIC_KEY_RING.
// Rotation = generate a new pair + APPEND a new kid to the ring (keep old kids,
// every issued key stays honored); only remove a kid on full private-key leak.
// Usage: node scripts/gen-keypair.mjs
// Standard: extensionsly licensing (docs/decisions/0015, chrome-repo docs/licensing.md §2.4).
import { webcrypto, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

if (existsSync('.keys/private.jwk')) {
  console.error(
    '⚠ .keys/private.jwk already exists. To rotate, first rename the old key (e.g. private-<kid>.jwk) so it is kept for record, then regenerate.',
  );
  process.exit(1);
}

const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const pub = await webcrypto.subtle.exportKey('jwk', kp.publicKey);
const priv = await webcrypto.subtle.exportKey('jwk', kp.privateKey);

mkdirSync('.keys', { recursive: true, mode: 0o700 });
writeFileSync('.keys/private.jwk', JSON.stringify(priv), { mode: 0o600 });

// kid = sha256hex(x + '.' + y).slice(0, 8) — matches issue-license.mjs and the
// in-extension public-key ring.
const kid = createHash('sha256').update(`${pub.x}.${pub.y}`).digest('hex').slice(0, 8);
const publicJwk = { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y };

console.log(
  `✓ Private key written to .keys/private.jwk (600, secret — never commit) · kid = ${kid}\n`,
);
console.log(
  'Append this entry to lib/pro/license.ts PUBLIC_KEY_RING (ship a version with it BEFORE issuing keys with the new kid):\n',
);
console.log(`  '${kid}': ${JSON.stringify(publicJwk)},`);

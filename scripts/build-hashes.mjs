#!/usr/bin/env node
/**
 * Reproducible-build manifest: SHA-256 of every file in the built extension
 * outputs, so a third party can rebuild from a tagged commit and confirm the
 * bytes match what we published (NO_SALE_PROMISE.md §5).
 *
 * Full reproduction recipe, including the build inputs that must match:
 * see VERIFYING.md at the repository root.
 *
 * We hash the *unzipped* `.output/<target>/` file contents — not the `.zip`
 * wrapper — because zip archives embed timestamps that vary between runs,
 * whereas Vite/WXT's content-hashed chunks are byte-stable given identical
 * inputs (pinned Node via .nvmrc, pnpm via packageManager, committed lockfile).
 *
 * Usage:
 *   node scripts/build-hashes.mjs              # print + write dist/SHA256SUMS.txt
 *   node scripts/build-hashes.mjs --out F      # write to F instead
 *   node scripts/build-hashes.mjs --check F    # compare current vs F, exit 1 on drift
 *
 * Build first (`pnpm build`); this script only hashes existing output.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// (app, target) pairs we publish. Firefox/extra targets are included only
// when present, so a chrome-only build still produces a stable manifest.
const APPS = ['editor', 'guardian'];
const TARGETS = ['chrome-mv3', 'firefox-mv2'];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Produce sorted `<sha256>  <app>/<target>/<relpath>` lines for all outputs. */
function collectHashes() {
  const lines = [];
  let roots = 0;
  for (const app of APPS) {
    for (const target of TARGETS) {
      const outRoot = path.join(ROOT, 'apps', app, '.output', target);
      if (!fs.existsSync(outRoot)) continue;
      roots += 1;
      for (const file of walk(outRoot)) {
        const rel = path.relative(outRoot, file).split(path.sep).join('/');
        lines.push(`${sha256(file)}  ${app}/${target}/${rel}`);
      }
    }
  }
  lines.sort();
  return { lines, roots };
}

const args = process.argv.slice(2);
const checkIdx = args.indexOf('--check');
const outIdx = args.indexOf('--out');

const { lines, roots } = collectHashes();
if (roots === 0) {
  console.error('✗ No build outputs found. Run `pnpm build` first.');
  process.exit(2);
}
const body = lines.join('\n') + '\n';
const aggregate = createHash('sha256').update(body).digest('hex');

if (checkIdx !== -1) {
  const prevPath = args[checkIdx + 1];
  if (!prevPath || !fs.existsSync(prevPath)) {
    console.error(`✗ --check: file not found: ${prevPath ?? '(missing arg)'}`);
    process.exit(2);
  }
  const prev = fs.readFileSync(prevPath, 'utf8');
  if (prev === body) {
    console.log(`✓ Reproducible: ${lines.length} files across ${roots} target(s) match.`);
    console.log(`  aggregate sha256: ${aggregate}`);
    process.exit(0);
  }
  console.error('✗ Build is NOT reproducible — file hashes drifted between builds.');
  const prevSet = new Set(prev.trim().split('\n'));
  const curSet = new Set(lines);
  const added = lines.filter((l) => !prevSet.has(l));
  const removed = [...prevSet].filter((l) => !curSet.has(l));
  for (const l of removed.slice(0, 20)) console.error(`  - ${l}`);
  for (const l of added.slice(0, 20)) console.error(`  + ${l}`);
  process.exit(1);
}

const outPath = outIdx !== -1 ? args[outIdx + 1] : path.join(ROOT, 'dist', 'SHA256SUMS.txt');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, body);

console.log(`✓ Hashed ${lines.length} files across ${roots} target(s).`);
console.log(`  aggregate sha256: ${aggregate}`);
console.log(`  written: ${path.relative(ROOT, outPath)}`);

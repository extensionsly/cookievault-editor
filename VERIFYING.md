# Verifying our builds

We publish this client as open source so you do not have to trust us. This
document is the recipe for checking that the extension you installed from a
browser store was built from the source in this repository.

This backs commitment §5 of [NO_SALE_PROMISE.md](./NO_SALE_PROMISE.md).

## The short version

```bash
git checkout v<version>        # the tag matching the released version
pnpm install --frozen-lockfile # exact dependency tree from the committed lockfile
pnpm build                     # Chrome MV3  → apps/<ext>/.output/chrome-mv3
pnpm build:firefox             # Firefox     → apps/<ext>/.output/firefox-mv2
pnpm build:hashes              # → dist/SHA256SUMS.txt
```

Then compare `dist/SHA256SUMS.txt` with the `SHA256SUMS.txt` attached to the
corresponding GitHub Release. To have the script do the comparison for you:

```bash
node scripts/build-hashes.mjs --check path/to/published/SHA256SUMS.txt
```

It exits `0` and prints `✓ Reproducible` on a match, or `1` with a per-file diff
if anything drifted.

## Why we hash unzipped output

The manifest covers the **file contents under `.output/<target>/`**, not the
`.zip` wrapper. Zip archives embed timestamps that change on every run, whereas
the built files themselves are byte-stable given identical inputs.

## Inputs that must match

Reproducibility only holds if your build inputs match ours:

| Input        | Pinned by                                        |
| ------------ | ------------------------------------------------ |
| Node.js      | `.nvmrc`                                         |
| pnpm         | `packageManager` field in `package.json`         |
| Dependencies | `pnpm-lock.yaml` (use `--frozen-lockfile`)       |
| Source       | the git tag you checked out                      |

Use `nvm use` (or any tool that reads `.nvmrc`) and `corepack enable` so the
pinned pnpm version is the one that runs.

### Editor only: the sync backend URL is baked into the build

CookieVault **Editor** compiles the cloud-sync backend URL into the bundle, so
that value changes the output hashes. A plain `pnpm build` uses the development
default (`http://localhost:8787`) and will **not** match a store build.

To reproduce a released Editor build, set the same values we used, which are
recorded in the release notes:

```bash
COOKIEVAULT_RELEASE_BUILD=true \
COOKIEVAULT_WORKER_URL=https://<url-from-release-notes> \
pnpm build
```

CookieVault **Guardian** does not talk to the sync backend, so its build has no
such input and reproduces with a plain `pnpm build`.

## Current status

The reproduction tooling in this repository is live and usable today. Published
`SHA256SUMS.txt` files appear on GitHub Releases as store builds are shipped; a
tag without an attached manifest means that version was not distributed through
a store.

## If it does not reproduce

That is worth reporting. Open an issue with your `--check` output, your Node and
pnpm versions, and the tag you built. A genuine mismatch between a store build
and its tagged source is exactly the kind of thing this process exists to catch —
please also read [SECURITY.md](./SECURITY.md) if you believe it is malicious.

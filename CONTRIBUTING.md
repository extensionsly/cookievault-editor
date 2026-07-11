# Contributing

Thanks for your interest in CookieVault. This repository is the open-source
client for one of the CookieVault browser extensions.

## Repository layout

This is a self-contained pnpm workspace:

- `apps/<extension>/` — the extension itself (WXT + React, MV3).
- `packages/shared/` — schemas, the AES-256-GCM / PBKDF2 crypto primitives, and
  the cookie cleanup engine. Shared with the other CookieVault extension.
- `packages/ui/` — shared design tokens and React UI primitives.

The cloud sync **backend is closed source** and lives in a separate, private
repository. It is not part of this project. The client here talks to that
backend over an end-to-end-encrypted protocol; the server never sees plaintext.

## Development

Requirements: Node.js >= 22 and pnpm 10.

```bash
pnpm install
pnpm test          # run unit tests
pnpm typecheck     # type-check all packages
pnpm build         # build the Chrome MV3 extension into apps/<ext>/.output
pnpm build:firefox # build the Firefox MV2/MV3 extension
```

Load the unpacked build from `apps/<ext>/.output/chrome-mv3` via
`chrome://extensions` (Developer Mode → Load unpacked).

## Ground rules

- **License.** This code is MIT. By contributing you agree your contribution is
  licensed under MIT. Do **not** paste in code from GPL/AGPL/LGPL projects — this
  project is kept clean-room for licensing reasons.
- **Cross-browser.** Never call the global `chrome.*` API directly; always
  `import { browser } from 'wxt/browser'`. Browser differences must go through an
  explicit branch, not "happens to work on Chrome."
- **No telemetry creep.** The client ships with zero telemetry by default.
  Anything that phones home must be opt-in and reviewed.
- **Formatting.** Run `pnpm format:check` (Prettier) before opening a PR.

## Reporting bugs & security issues

Open a GitHub issue for bugs. For **security vulnerabilities**, follow
[SECURITY.md](./SECURITY.md) and report privately instead.

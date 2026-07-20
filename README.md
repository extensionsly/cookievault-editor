# CookieVault Editor

**Open-source, MV3-native cookie editor for Chrome, Edge, and Firefox.** View,
search, add, edit, delete, import, and export cookies for any site — a modern,
privacy-respecting alternative to legacy cookie editors.

> Part of [CookieVault](https://cookievault.net) — a two-extension toolkit:
> **Editor** (this repo, manual cookie editing) and
> **[Guardian](https://github.com/extensionsly/cookievault-guardian)**
> (allowlist-based automatic cookie cleanup).

## Why open source

CookieVault Editor requests the `cookies` permission and `<all_urls>` host
access — the permissions needed to edit cookies on any site. You should not have
to take that on trust. This repository is the exact client that ships to the
stores, including the encryption primitives, so anyone can audit what the
extension actually does with your data.

**The client is open source. The optional cloud-sync backend is not** — and it
does not need to be trusted either: all encryption happens on your device before
data leaves the browser, and the server only ever stores ciphertext (see
[SECURITY.md](./SECURITY.md)).

## Features

- Full cookie CRUD: view, search, create, edit, and delete cookies per domain.
- Import / export cookie sets (JSON), including an EditThisCookie-compatible
  import path for migrating away from discontinued tools.
- Works across Chromium browsers and Firefox from one codebase.
- Zero telemetry by default. Cloud sync and any account features are opt-in.

## Project layout

This is a self-contained pnpm workspace:

| Path                | What it is                                                          |
| ------------------- | ------------------------------------------------------------------ |
| `apps/editor/`      | The Editor extension (WXT + React, MV3).                           |
| `packages/shared/`  | Schemas, AES-256-GCM / PBKDF2 crypto primitives, cleanup engine.   |
| `packages/ui/`      | Shared design tokens and React UI primitives.                      |

## Build from source

Requirements: **Node.js >= 22** and **pnpm 10**.

```bash
pnpm install
pnpm test          # unit tests
pnpm typecheck
pnpm build         # Chrome/Edge MV3 → apps/editor/.output/chrome-mv3
pnpm build:firefox # Firefox           → apps/editor/.output/firefox-mv2
```

Then open `chrome://extensions`, enable **Developer Mode**, and **Load unpacked**
from `apps/editor/.output/chrome-mv3`.

## Install (end users)

Use the official **[CookieVault product page on Extensionsly](https://extensionsly.com/extensions/cookievault/)**
for the current browser-store routes, verified manual-install package, release
details, and optional Pro checkout. The product home remains
**[cookievault.net](https://cookievault.net)**. Check the publisher name before
installing to avoid look-alike clones.

We do not publish installable builds here: browsers block installs from outside
the stores anyway, and a second download source would only help clones
impersonate us. What we publish instead is **verifiability** — see below.

## Verify what you installed

You do not have to trust that the store build matches this source. Check out the
matching tag, rebuild, and compare SHA-256 manifests:

```bash
pnpm install --frozen-lockfile && pnpm build && pnpm build:hashes
```

Full recipe in **[VERIFYING.md](./VERIFYING.md)**.

## Our promises

We commit publicly to never selling this project out from under its users, and
to never adding spyware. See **[NO_SALE_PROMISE.md](./NO_SALE_PROMISE.md)**.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR: MIT only (no GPL code), always
use `wxt/browser` instead of global `chrome.*`, keep telemetry opt-in.

## License

[MIT](./LICENSE). "CookieVault" and the CookieVault logo are trademarks of the
CookieVault project and are **not** covered by the MIT license.

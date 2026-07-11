# CookieVault Editor

MV3 browser extension. The user-facing job: list, search, edit, import
and export cookies. Profile switching and encrypted sync gate behind
Pro.

## Local development

```bash
# from repo root
pnpm install

# Chrome dev mode (launches a profile, reloads on save)
pnpm --filter editor dev

# Firefox dev mode
pnpm --filter editor dev:firefox

# Production build
pnpm --filter editor build
pnpm --filter editor zip
```

WXT writes the dev / build output to `apps/editor/.output/`. The
generated `.wxt/` directory holds the typed manifest and generated
ambient types — both are gitignored.

## Entrypoints

| Path                        | What it is                                                      |
| --------------------------- | --------------------------------------------------------------- |
| `entrypoints/popup/`        | Toolbar popup. Cookie list, search, future CRUD UI.             |
| `entrypoints/options/`      | Full-page settings (account, subscription, profile management). |
| `entrypoints/background.ts` | Service Worker. Command routing for future CRUD operations.     |

## Manifest

Derived from `wxt.config.ts`. Permissions are minimised; see
[`../../docs/security-model.md` §4](../../docs/security-model.md). If you
need a new permission, update the wxt config, add a justification line
to the CWS listing source (`docs/cws-listing.md`, TBD), and check the
PR template's permissions box.

## Icons

`public/icon/*.png` currently ship placeholder 1×1 transparent PNGs.
Real icon set lands in W4 alongside CWS listing assets; tracked in
`ROADMAP.md`.

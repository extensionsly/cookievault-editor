# Editor store assets

Files used by the Chrome Web Store, Mozilla AMO, and Edge Add-ons
listing pages. Source-of-truth listing copy lives in
[`../../../docs/cws-listing.md`](../../../docs/cws-listing.md).

```
store-assets/
├── fixtures/
│   └── screenshot-cookies.json   — 24 fake cookies for screenshots
├── screenshots/                  — populated by you (see ../../../docs/screenshot-guide.md)
└── promotional-tile.png          — 440×280 CWS small tile (run `pnpm promo`)
```

## Promotional tile

`promotional-tile.png` (440×280) is generated from
`assets/brand/promo-editor.svg` by `pnpm promo` — a deterministic resvg render
using the vendored Liberation Sans (`assets/brand/fonts/`). Edit the SVG
master and re-run to update it; commit the SVG + regenerated PNG together.

## Fixtures

`fixtures/screenshot-cookies.json` is a CookieVault `cookievault/v1`
export containing **24 cookies across 7 RFC-2606 reserved domains**
(`.example.com`, `.example.org`, `.example.net`, `.tracker.test`,
`.acme.test`, `staging.acme.test`, `localhost`). Importing it via the
Editor's own **Import** button will not touch any real site you use,
because none of those TLDs resolve.

The fixture is shaped to produce a varied screenshot:

- mix of session and persistent cookies
- mix of Secure / HttpOnly / Host-only / SameSite=strict / lax / no_restriction
- a sub-path cookie (`/checkout`)
- a JWT-shaped auth token
- **2 CHIPS partitioned cookies** so screenshot #4 ("CHIPS support")
  shows the P tag against a credible real-world third-party-embed scenario
- a `localhost` cookie so screenshot #1's domain list is recognisably
  developer-oriented

## Generating screenshots

See [`../../../docs/screenshot-guide.md`](../../../docs/screenshot-guide.md)
for the step-by-step capture procedure.

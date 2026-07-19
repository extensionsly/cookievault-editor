# The No-Sale Promise

> _Made public on day 0 so future-us cannot quietly walk it back._

CookieVault handles browser cookies, which are equivalent to logged-in
sessions on every site a user visits. The browser-extension ecosystem
has a long history of useful tools being **sold to opaque buyers who
then inject tracking, affiliate hijacking, or outright credential
theft**. Notable examples:

- **Stylish** — sold; new owner injected full-history telemetry; removed
  from browser stores.
- **The Great Suspender** — sold to an undisclosed buyer; new
  maintainer shipped malware; removed.
- **Hover Zoom** — sold multiple times; each cycle introduced spyware.

For a cookie tool the consequence of a sell-out would be
catastrophic — any malicious update could exfiltrate every session
cookie on a user's machine.

We will not put our users in that position.

## Our commitments

1. **No silent sale.** CookieVault (the brand, the extensions, and the
   organisation behind them) will not be sold to a third party without
   **30 days of public notice**, posted as a pinned GitHub Issue in
   **both** public extension repositories
   ([Editor](https://github.com/extensionsly/cookievault-editor) and
   [Guardian](https://github.com/extensionsly/cookievault-guardian))
   and in the CookieVault changelog at https://cookievault.net.
2. **No spyware, ever.** Neither the current maintainers nor any future
   owner may add tracking, affiliate hijacking, or any data collection
   not strictly required for the user-facing feature being used. The
   acceptable telemetry surface is described in [SECURITY.md](./SECURITY.md)
   and published at https://cookievault.net; any expansion requires a
   public announcement in these repositories **before** it ships.
3. **Public offer log.** Every acquisition offer we receive — accepted,
   declined, or ignored — will be summarised (without disclosing
   counter-party PII) in a public offer log published at
   https://cookievault.net and announced as an Issue in these
   repositories. It will be created the first time we receive one.
4. **MIT core.** The extension client code is and will remain
   MIT-licensed. Anyone may fork CookieVault if we ever break these
   promises — and the fork inherits the user base of the brand we will
   have damaged.
5. **Reproducible builds.** Every published `.zip` / `.crx` will have a
   matching tagged commit in this repository and a documented
   reproduction recipe — see [VERIFYING.md](./VERIFYING.md). You can
   rebuild from a tag and confirm the bytes match what we shipped.

## What is open and what is not

Being precise about this is itself part of the promise:

- **Open source (MIT, this repository):** the entire extension client —
  UI, cookie logic, the cleanup engine, and the end-to-end encryption
  primitives in `packages/shared/src/crypto`.
- **Closed source:** the optional cloud-sync backend service. It is a
  thin store-and-forward service that holds **ciphertext only**. All
  encryption and decryption happen on your device; the server has no
  ability to read your cookie data. See [SECURITY.md](./SECURITY.md).

We say "open source" about the client, and we do not claim it about the
sync backend.

## How to verify

- Watch this file's git history **in this public repository**. Material
  changes — softening, hedging, or removal — must always be paired with
  a public Issue thread linked from the commit.
- Watch the public offer log at https://cookievault.net.
- Watch the maintainer set on these repositories.
- Rebuild from a tag and compare hashes ([VERIFYING.md](./VERIFYING.md)).

## If we break these promises

Fork the repository, raise the alarm, and migrate users. That option is
the entire point of staying MIT-licensed.

---

_Inspired by the public "no-sale" pledges made by Hover Zoom+,
SponsorBlock, and uBlock Origin's maintainer._

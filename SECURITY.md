# Security Policy

## Our security model

CookieVault handles browser cookies — sensitive data. Two design commitments
matter for security:

- **End-to-end encryption.** When cloud sync is enabled, your cookie data is
  encrypted on your device (AES-256-GCM with a key derived from your password
  via PBKDF2) before it ever leaves the browser. The sync server stores only
  ciphertext and **cannot decrypt your data**. The key is never uploaded.
- **Auditable client.** The encryption primitives, schema, and cleanup engine
  in this repository are the exact code that ships. You do not have to trust a
  black box — read `packages/shared/src/crypto`.

The sync backend is a separate, closed-source service. It never has the ability
to read plaintext cookie data by design; the client is where all encryption and
decryption happen.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for an
unpatched vulnerability.

- Use GitHub's private vulnerability reporting ("Report a vulnerability" under
  the Security tab), or
- Email the maintainers via the address listed on https://cookievault.net

We aim to acknowledge reports within 72 hours. Coordinated disclosure is
appreciated; we will credit reporters who wish to be named.

## Scope

In scope: this extension's source, the shared crypto/schema/cleanup packages,
and the way the client talks to the sync API. Out of scope: the closed-source
sync backend infrastructure (report those to the same private channel; we triage
across both).

# @cookievault/shared

Cross-app primitives shared between `apps/editor`, `apps/guardian`, and
`apps/worker`.

| Module     | What                                                                |
| ---------- | ------------------------------------------------------------------- |
| `./schema` | Zod schemas + types for `Cookie`, `Profile`, import/export formats. |
| `./crypto` | AES-256-GCM + PBKDF2 facade. **All E2E crypto goes through here.**  |

## Design rules

- **No `chrome.*` calls.** This package must remain platform-neutral so
  the Cloudflare Worker can import schemas too.
- **All crypto** is implemented on top of `crypto.subtle` (Web Crypto
  API). Available natively in browsers, Cloudflare Workers, and Node
  22+.
- **Tests required** for everything under `crypto/`. See
  `src/crypto/__tests__/`.

## Usage

```ts
import { CookieSchema, type Cookie } from '@cookievault/shared/schema';
import { deriveMasterKey, encrypt, decrypt } from '@cookievault/shared/crypto';
```

## Adding a new module

1. Implement under `src/<area>/`.
2. Export from `src/<area>/index.ts`.
3. If it's public API, add to `src/index.ts` barrel.
4. Tests under `src/<area>/__tests__/<name>.test.ts`.
5. Update this README's module table.

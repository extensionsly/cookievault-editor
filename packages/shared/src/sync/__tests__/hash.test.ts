import { describe, expect, it } from 'vitest';
import { sha256Base64Url, sha256OfString } from '../hash.js';

describe('sha256Base64Url', () => {
  it('matches the canonical SHA-256 of an empty input', async () => {
    // Known vector: SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    // base64url (no padding) = 47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU
    expect(await sha256OfString('')).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
  });

  it('matches the canonical SHA-256 of "abc"', async () => {
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    // base64url = ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0
    expect(await sha256OfString('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });

  it('round-trips through Uint8Array input', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Base64Url(bytes)).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });
});

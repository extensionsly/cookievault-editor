import { describe, expect, it } from 'vitest';
import { cookieUrl, normalizeFromLegacy, parseImport, serializeExport } from '../cookie-io.js';
import type { Cookie } from '../cookie.js';

const sampleCookie: Cookie = {
  name: 'sid',
  value: 'abc',
  domain: 'example.com',
  hostOnly: true,
  path: '/',
  secure: true,
  httpOnly: false,
  sameSite: 'lax',
  session: true,
};

describe('cookieUrl', () => {
  it('emits https for secure cookies', () => {
    expect(cookieUrl({ domain: 'example.com', path: '/', secure: true })).toBe(
      'https://example.com/',
    );
  });

  it('emits http for non-secure cookies', () => {
    expect(cookieUrl({ domain: 'example.com', path: '/', secure: false })).toBe(
      'http://example.com/',
    );
  });

  it('strips the leading dot from domain', () => {
    expect(cookieUrl({ domain: '.example.com', path: '/', secure: true })).toBe(
      'https://example.com/',
    );
  });

  it('defaults empty path to /', () => {
    expect(cookieUrl({ domain: 'example.com', path: '', secure: true })).toBe(
      'https://example.com/',
    );
  });

  it('preserves nested paths', () => {
    expect(cookieUrl({ domain: 'example.com', path: '/api/v1', secure: true })).toBe(
      'https://example.com/api/v1',
    );
  });
});

describe('normalizeFromLegacy', () => {
  it('converts an EditThisCookie record into our Cookie shape', () => {
    const legacy = {
      id: 42,
      name: 'sid',
      value: 'abc',
      domain: 'example.com',
      hostOnly: true,
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'lax',
      session: true,
    };
    expect(normalizeFromLegacy(legacy)).toEqual({
      name: 'sid',
      value: 'abc',
      domain: 'example.com',
      hostOnly: true,
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'lax',
      session: true,
    });
  });

  it('coerces null sameSite to "unspecified"', () => {
    const out = normalizeFromLegacy({
      name: 'x',
      value: '',
      domain: 'example.com',
      hostOnly: false,
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: null,
      session: true,
    });
    expect(out.sameSite).toBe('unspecified');
  });

  it('coerces unknown sameSite string to "unspecified"', () => {
    const out = normalizeFromLegacy({
      name: 'x',
      value: '',
      domain: 'example.com',
      hostOnly: false,
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: 'No restriction',
      session: true,
    });
    expect(out.sameSite).toBe('unspecified');
  });

  it('defaults missing path to /', () => {
    const out = normalizeFromLegacy({
      name: 'x',
      value: '',
      domain: 'example.com',
      hostOnly: false,
      secure: false,
      httpOnly: false,
      session: true,
    });
    expect(out.path).toBe('/');
  });

  it('preserves numeric expirationDate', () => {
    const out = normalizeFromLegacy({
      name: 'x',
      value: '',
      domain: 'example.com',
      hostOnly: false,
      path: '/',
      secure: false,
      httpOnly: false,
      sameSite: 'lax',
      session: false,
      expirationDate: 1_800_000_000,
    });
    expect(out.expirationDate).toBe(1_800_000_000);
  });

  it('drops unknown extra fields', () => {
    const out = normalizeFromLegacy({
      ...sampleCookie,
      id: 99,
      extraField: 'ignored',
    });
    expect((out as Record<string, unknown>).id).toBeUndefined();
    expect((out as Record<string, unknown>).extraField).toBeUndefined();
  });

  it('rejects non-objects', () => {
    expect(() => normalizeFromLegacy(null)).toThrow();
    expect(() => normalizeFromLegacy('nope')).toThrow();
  });
});

describe('parseImport', () => {
  it('parses a CookieVault-native export', () => {
    const json = JSON.stringify({
      format: 'cookievault/v1',
      exportedAt: new Date().toISOString(),
      cookies: [sampleCookie],
    });
    const result = parseImport(json);
    expect(result.source).toBe('cookievault/v1');
    expect(result.cookies).toHaveLength(1);
    expect(result.cookies[0]?.name).toBe('sid');
  });

  it('parses an EditThisCookie bare-array export', () => {
    const json = JSON.stringify([
      { ...sampleCookie, id: 1, sameSite: null },
      { ...sampleCookie, id: 2, name: 'csrf' },
    ]);
    const result = parseImport(json);
    expect(result.source).toBe('editthiscookie');
    expect(result.cookies).toHaveLength(2);
    expect(result.cookies[0]?.sameSite).toBe('unspecified');
    expect(result.cookies[1]?.name).toBe('csrf');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseImport('{ not json')).toThrow(/Invalid JSON/);
  });

  it('throws on unrecognised shape', () => {
    expect(() => parseImport(JSON.stringify({ random: 'object' }))).toThrow(/Unrecognised/);
  });

  it('round-trips through serializeExport → parseImport', () => {
    const serialised = serializeExport([sampleCookie]);
    const result = parseImport(serialised);
    expect(result.source).toBe('cookievault/v1');
    expect(result.cookies).toEqual([sampleCookie]);
  });
});

describe('serializeExport', () => {
  it('produces valid CookieVault v1 envelope', () => {
    const out = serializeExport([sampleCookie]);
    const parsed = JSON.parse(out);
    expect(parsed.format).toBe('cookievault/v1');
    expect(typeof parsed.exportedAt).toBe('string');
    expect(parsed.cookies).toEqual([sampleCookie]);
  });

  it('emits pretty-printed JSON (newlines present)', () => {
    expect(serializeExport([sampleCookie])).toContain('\n');
  });
});

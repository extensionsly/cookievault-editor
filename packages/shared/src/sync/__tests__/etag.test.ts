import { describe, expect, it } from 'vitest';
import { formatIfMatch, parseEtagHeader } from '../etag.js';

describe('parseEtagHeader', () => {
  it('parses a weak ETag', () => {
    expect(parseEtagHeader('W/"7"')).toEqual({ version: 7, weak: true });
  });

  it('parses a strong ETag (lenient)', () => {
    expect(parseEtagHeader('"3"')).toEqual({ version: 3, weak: false });
  });

  it('parses version 0', () => {
    expect(parseEtagHeader('W/"0"')).toEqual({ version: 0, weak: true });
  });

  it('tolerates leading/trailing whitespace', () => {
    expect(parseEtagHeader('  W/"42"  ')).toEqual({ version: 42, weak: true });
  });

  it('returns null for null / undefined', () => {
    expect(parseEtagHeader(null)).toBeNull();
    expect(parseEtagHeader(undefined)).toBeNull();
  });

  it('returns null for empty / non-numeric', () => {
    expect(parseEtagHeader('')).toBeNull();
    expect(parseEtagHeader('W/"abc"')).toBeNull();
    expect(parseEtagHeader('W/""')).toBeNull();
    expect(parseEtagHeader('W/"-1"')).toBeNull();
  });

  it('returns null for missing quotes', () => {
    expect(parseEtagHeader('W/7')).toBeNull();
    expect(parseEtagHeader('7')).toBeNull();
  });
});

describe('formatIfMatch', () => {
  it('formats as weak with quoted version', () => {
    expect(formatIfMatch(7)).toBe('W/"7"');
    expect(formatIfMatch(0)).toBe('W/"0"');
  });

  it('rejects non-integers', () => {
    expect(() => formatIfMatch(1.5)).toThrow();
    expect(() => formatIfMatch(-1)).toThrow();
    expect(() => formatIfMatch(NaN)).toThrow();
  });

  it('round-trips through parseEtagHeader', () => {
    for (const v of [0, 1, 7, 42, 1_000_000]) {
      const parsed = parseEtagHeader(formatIfMatch(v));
      expect(parsed).toEqual({ version: v, weak: true });
    }
  });
});

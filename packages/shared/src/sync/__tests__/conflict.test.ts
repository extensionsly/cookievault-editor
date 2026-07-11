import { describe, expect, it } from 'vitest';
import { classifyConflict } from '../conflict.js';

describe('classifyConflict', () => {
  it('returns "identical" when both hints match', () => {
    expect(classifyConflict('h1', 'h1')).toBe('identical');
  });

  it('returns "real-conflict" when hints differ', () => {
    expect(classifyConflict('h1', 'h2')).toBe('real-conflict');
  });

  it('returns "real-conflict" for empty strings (defensive)', () => {
    expect(classifyConflict('', '')).toBe('real-conflict');
    expect(classifyConflict('h1', '')).toBe('real-conflict');
    expect(classifyConflict('', 'h2')).toBe('real-conflict');
  });

  it('returns "real-conflict" for non-string inputs (defensive)', () => {
    // Cast through unknown for the explicit-bad-input test.
    expect(classifyConflict(null as unknown as string, 'h1')).toBe('real-conflict');
    expect(classifyConflict('h1', undefined as unknown as string)).toBe('real-conflict');
  });

  it('is case-sensitive (sha256 hints are base64url, case matters)', () => {
    expect(classifyConflict('AbC', 'abc')).toBe('real-conflict');
  });
});

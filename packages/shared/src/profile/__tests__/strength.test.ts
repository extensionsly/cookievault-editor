import { describe, expect, it } from 'vitest';
import { STRONG_SCORE_THRESHOLD, evaluatePassphrase } from '../strength.js';

describe('evaluatePassphrase', () => {
  it('returns neutral very-weak for empty input without calling zxcvbn', () => {
    const r = evaluatePassphrase('');
    expect(r.score).toBe(0);
    expect(r.isStrong).toBe(false);
    expect(r.label).toBe('very weak');
    expect(r.warning).toBe('');
    expect(r.suggestions).toEqual([]);
  });

  it('classifies obvious common passwords as very weak', () => {
    const r = evaluatePassphrase('password');
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.isStrong).toBe(false);
  });

  it('classifies repeated patterns as weak', () => {
    const r = evaluatePassphrase('aaaaaa');
    expect(r.score).toBeLessThanOrEqual(1);
    expect(r.isStrong).toBe(false);
  });

  it('classifies short numeric strings as weak', () => {
    const r = evaluatePassphrase('123456');
    expect(r.score).toBe(0);
    expect(r.isStrong).toBe(false);
  });

  it('classifies a four-word passphrase as strong', () => {
    const r = evaluatePassphrase('correct horse battery staple');
    expect(r.score).toBeGreaterThanOrEqual(STRONG_SCORE_THRESHOLD);
    expect(r.isStrong).toBe(true);
  });

  it('classifies a random high-entropy string as excellent', () => {
    const r = evaluatePassphrase('Tr0ub4dor&3#Xq!9zP');
    expect(r.score).toBe(4);
    expect(r.label).toBe('excellent');
    expect(r.isStrong).toBe(true);
  });

  it('produces actionable warnings for common words', () => {
    const r = evaluatePassphrase('qwerty');
    // zxcvbn flags qwerty as a common keyboard sequence — it should warn or suggest.
    expect(r.warning.length + r.suggestions.length).toBeGreaterThan(0);
  });

  it('returns a crack-time display string', () => {
    const r = evaluatePassphrase('correct horse battery staple');
    expect(typeof r.crackTimeDisplay).toBe('string');
    expect(r.crackTimeDisplay.length).toBeGreaterThan(0);
  });

  it('STRONG_SCORE_THRESHOLD is the expected industry default', () => {
    expect(STRONG_SCORE_THRESHOLD).toBe(3);
  });

  it('isStrong is exactly score >= threshold', () => {
    // Walk a few inputs across the score spectrum.
    const cases = ['', '1', 'password', 'correct horse battery staple', 'Tr0ub4dor&3#Xq!9zP'];
    for (const c of cases) {
      const r = evaluatePassphrase(c);
      expect(r.isStrong).toBe(r.score >= STRONG_SCORE_THRESHOLD);
    }
  });
});

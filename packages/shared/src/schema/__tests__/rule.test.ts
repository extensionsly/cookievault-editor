import { describe, expect, it } from 'vitest';
import { RuleSchema, findMatchingRule, matchesPattern, newRule, type Rule } from '../rule.js';

describe('matchesPattern', () => {
  it('matches exact host', () => {
    expect(matchesPattern('example.com', 'example.com')).toBe(true);
  });

  it('matches host with leading dot (cookie domain form)', () => {
    expect(matchesPattern('example.com', '.example.com')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesPattern('Example.COM', 'example.com')).toBe(true);
    expect(matchesPattern('example.com', 'EXAMPLE.com')).toBe(true);
  });

  it('plain pattern does NOT match subdomains', () => {
    expect(matchesPattern('example.com', 'foo.example.com')).toBe(false);
  });

  it('*.example.com matches proper subdomains', () => {
    expect(matchesPattern('*.example.com', 'foo.example.com')).toBe(true);
    expect(matchesPattern('*.example.com', 'a.b.example.com')).toBe(true);
  });

  it('*.example.com does NOT match the apex host', () => {
    expect(matchesPattern('*.example.com', 'example.com')).toBe(false);
    expect(matchesPattern('*.example.com', '.example.com')).toBe(false);
  });

  it('*.example.com does NOT match unrelated hosts that share a suffix', () => {
    expect(matchesPattern('*.example.com', 'badexample.com')).toBe(false);
    expect(matchesPattern('*.example.com', 'example.com.evil.com')).toBe(false);
  });

  it('bare * pattern matches nothing (would be rejected at schema layer)', () => {
    // Defensive: even if the rule somehow exists, matchesPattern
    // shouldn't open the floodgates.
    expect(matchesPattern('*.', 'anything.com')).toBe(false);
  });

  it('supports localhost (no dot)', () => {
    expect(matchesPattern('localhost', 'localhost')).toBe(true);
    expect(matchesPattern('localhost', 'other.localhost')).toBe(false);
    expect(matchesPattern('*.localhost', 'app.localhost')).toBe(true);
  });
});

describe('RuleSchema', () => {
  it('accepts a well-formed rule', () => {
    const r = RuleSchema.parse({
      id: crypto.randomUUID(),
      pattern: 'example.com',
      action: 'allow',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(r.pattern).toBe('example.com');
  });

  it('rejects bare wildcard', () => {
    expect(() =>
      RuleSchema.parse({
        id: crypto.randomUUID(),
        pattern: '*',
        action: 'allow',
        createdAt: '',
        updatedAt: '',
      }),
    ).toThrow();
  });

  it('rejects whitespace in pattern', () => {
    expect(() =>
      RuleSchema.parse({
        id: crypto.randomUUID(),
        pattern: 'example .com',
        action: 'allow',
        createdAt: '',
        updatedAt: '',
      }),
    ).toThrow();
  });

  it('rejects empty pattern', () => {
    expect(() =>
      RuleSchema.parse({
        id: crypto.randomUUID(),
        pattern: '',
        action: 'allow',
        createdAt: '',
        updatedAt: '',
      }),
    ).toThrow();
  });

  it('rejects unknown action', () => {
    expect(() =>
      RuleSchema.parse({
        id: crypto.randomUUID(),
        pattern: 'example.com',
        action: 'delete-fast',
        createdAt: '',
        updatedAt: '',
      }),
    ).toThrow();
  });

  it('rejects unknown extra fields (strict)', () => {
    expect(() =>
      RuleSchema.parse({
        id: crypto.randomUUID(),
        pattern: 'example.com',
        action: 'allow',
        createdAt: '',
        updatedAt: '',
        extra: 'forbidden',
      }),
    ).toThrow();
  });
});

describe('newRule', () => {
  it('populates id and timestamps', () => {
    const r = newRule('example.com', 'allow');
    expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(typeof r.createdAt).toBe('string');
    expect(r.createdAt).toBe(r.updatedAt);
  });

  it('two new rules get distinct ids', () => {
    const a = newRule('example.com', 'allow');
    const b = newRule('example.com', 'allow');
    expect(a.id).not.toBe(b.id);
  });

  it('throws on invalid pattern', () => {
    expect(() => newRule('*', 'allow')).toThrow();
    expect(() => newRule('', 'allow')).toThrow();
  });
});

describe('findMatchingRule', () => {
  function rule(pattern: string, action: Rule['action'] = 'allow'): Rule {
    return newRule(pattern, action);
  }

  it('returns null when no rule matches', () => {
    expect(findMatchingRule('example.com', [rule('other.com')])).toBeNull();
  });

  it('returns the first matching rule (order matters)', () => {
    const specific = rule('foo.example.com', 'clean-immediately');
    const generic = rule('*.example.com', 'allow');
    // specific listed first → wins
    expect(findMatchingRule('foo.example.com', [specific, generic])?.action).toBe(
      'clean-immediately',
    );
    // generic listed first → wins
    expect(findMatchingRule('foo.example.com', [generic, specific])?.action).toBe('allow');
  });

  it('matches against a cookie domain with leading dot', () => {
    expect(findMatchingRule('.example.com', [rule('example.com')])).not.toBeNull();
  });

  it('returns null for an empty rule list', () => {
    expect(findMatchingRule('example.com', [])).toBeNull();
  });
});

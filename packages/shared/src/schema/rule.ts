import { z } from 'zod';

/**
 * Three actions a Guardian rule can take.
 *
 *   - `allow` — keep cookies matching this pattern forever (whitelist).
 *   - `clean-on-close` — keep while the origin has at least one open
 *     tab; delete when the last tab closes. Cookie AutoDelete's
 *     "grey list" semantics.
 *   - `clean-immediately` — delete on the next sweep after the cookie is
 *     seen: the 30s safety alarm or a tab-close, whichever comes first.
 *     (The cookies.onChanged observer only records "recent activity"; it
 *     does not itself trigger a delete, to avoid per-cookie scan churn.
 *     So worst-case latency is one alarm period, not truly instant.)
 *
 * What happens when **no** rule matches a cookie is a global default
 * (Guardian setting), not a rule action — modelled separately in
 * cleanup.ts.
 */
export const RuleActionSchema = z.enum(['allow', 'clean-on-close', 'clean-immediately']);
export type RuleAction = z.infer<typeof RuleActionSchema>;

const PATTERN_REJECT = /\s/;

export const RuleSchema = z
  .object({
    id: z.string().uuid(),
    pattern: z
      .string()
      .min(1)
      .refine((s) => !PATTERN_REJECT.test(s) && s !== '*', {
        message: 'pattern must not contain whitespace or be a bare wildcard',
      }),
    action: RuleActionSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type Rule = z.infer<typeof RuleSchema>;

/**
 * Check whether a host matches a rule pattern.
 *
 * Matching rules:
 *   - Case-insensitive on both sides.
 *   - The cookie's leading `.` (the `Domain=.example.com` form that
 *     means "this and subdomains") is stripped before comparison.
 *   - Plain pattern (`example.com`) matches the host exactly.
 *   - `*.example.com` matches **proper subdomains only**:
 *     `foo.example.com` → yes; `a.b.example.com` → yes;
 *     `example.com` itself → no.
 *
 * No regex / glob beyond the leading `*.` shortcut — that level of
 * expressiveness invites footguns (catastrophic backtracking,
 * accidental matches) we don't need.
 */
export function matchesPattern(pattern: string, host: string): boolean {
  const cleanHost = host.replace(/^\./, '').toLowerCase();
  const cleanPattern = pattern.toLowerCase();
  if (cleanPattern.startsWith('*.')) {
    const suffix = cleanPattern.slice(2);
    if (!suffix) return false;
    return cleanHost !== suffix && cleanHost.endsWith('.' + suffix);
  }
  return cleanHost === cleanPattern;
}

/**
 * Find the first rule whose pattern matches the given host.
 * First-match-wins; callers should put more-specific rules earlier
 * (e.g. `foo.example.com` before `*.example.com`).
 */
export function findMatchingRule(host: string, rules: readonly Rule[]): Rule | null {
  for (const r of rules) {
    if (matchesPattern(r.pattern, host)) return r;
  }
  return null;
}

/**
 * Construct a fresh rule with id + timestamps populated. Throws
 * (via RuleSchema.parse) if `pattern` is invalid.
 */
export function newRule(pattern: string, action: RuleAction): Rule {
  const now = new Date().toISOString();
  return RuleSchema.parse({
    id: crypto.randomUUID(),
    pattern,
    action,
    createdAt: now,
    updatedAt: now,
  });
}

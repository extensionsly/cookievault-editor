import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GUARDIAN_SETTINGS,
  type GuardianSettings,
  GuardianSettingsSchema,
  type TabState,
  decideCleanup,
  isProtectedByTabState,
  looksLikeLoginCookie,
} from '../cleanup.js';
import type { Cookie } from '../schema/cookie.js';
import { newRule, type Rule } from '../schema/rule.js';

type DecideCookie = Pick<Cookie, 'domain' | 'hostOnly' | 'name' | 'session' | 'httpOnly'>;

// Plain, non-login cookies (generic name, not session/httpOnly) so the
// login-protection safety net never interferes with the base-logic tests.
const hostOnlyCookie = (domain: string): DecideCookie => ({
  domain,
  hostOnly: true,
  name: 'pref',
  session: false,
  httpOnly: false,
});
const domainCookie = (domain: string): DecideCookie => ({
  domain,
  hostOnly: false,
  name: 'pref',
  session: false,
  httpOnly: false,
});
// A cookie that trips the login heuristic (name contains a hint).
const loginCookie = (domain: string, hostOnly = true): DecideCookie => ({
  domain,
  hostOnly,
  name: 'session_id',
  session: true,
  httpOnly: true,
});

const tabs = (...hosts: string[]): TabState => ({
  hostsWithOpenTabs: new Set(hosts),
});
const noTabs: TabState = { hostsWithOpenTabs: new Set() };

const settings = (
  defaultAction: GuardianSettings['defaultAction'],
  protectLogins = true,
): GuardianSettings => ({
  defaultAction,
  protectLogins,
  clearSiteData: false,
});

describe('isProtectedByTabState', () => {
  it('host-only cookie protected only by exact-host tab', () => {
    expect(isProtectedByTabState(hostOnlyCookie('example.com'), new Set(['example.com']))).toBe(
      true,
    );
    expect(isProtectedByTabState(hostOnlyCookie('example.com'), new Set(['foo.example.com']))).toBe(
      false,
    );
  });

  it('domain cookie protected by exact OR subdomain tab', () => {
    expect(isProtectedByTabState(domainCookie('.example.com'), new Set(['example.com']))).toBe(
      true,
    );
    expect(isProtectedByTabState(domainCookie('.example.com'), new Set(['foo.example.com']))).toBe(
      true,
    );
    expect(isProtectedByTabState(domainCookie('.example.com'), new Set(['a.b.example.com']))).toBe(
      true,
    );
  });

  it('unrelated open tabs do not protect', () => {
    expect(isProtectedByTabState(domainCookie('.example.com'), new Set(['other.com']))).toBe(false);
  });

  it('suffix-only matches do not protect (badexample.com vs example.com)', () => {
    expect(isProtectedByTabState(domainCookie('.example.com'), new Set(['badexample.com']))).toBe(
      false,
    );
  });

  it('empty tab state never protects', () => {
    expect(isProtectedByTabState(hostOnlyCookie('example.com'), new Set())).toBe(false);
  });

  it('is case-insensitive on the open-host side', () => {
    expect(isProtectedByTabState(hostOnlyCookie('example.com'), new Set(['EXAMPLE.com']))).toBe(
      true,
    );
  });
});

describe('decideCleanup — no rules', () => {
  it('default allow → keep', () => {
    expect(decideCleanup(hostOnlyCookie('a.com'), [], noTabs, settings('allow'))).toBe('keep');
  });

  it('default clean-immediately → delete', () => {
    expect(decideCleanup(hostOnlyCookie('a.com'), [], noTabs, settings('clean-immediately'))).toBe(
      'delete',
    );
  });

  it('default clean-on-close + no open tab → delete', () => {
    expect(decideCleanup(hostOnlyCookie('a.com'), [], noTabs, settings('clean-on-close'))).toBe(
      'delete',
    );
  });

  it('default clean-on-close + open tab on same host → protect', () => {
    expect(
      decideCleanup(hostOnlyCookie('a.com'), [], tabs('a.com'), settings('clean-on-close')),
    ).toBe('protect-while-tab-open');
  });
});

describe('decideCleanup — with rules', () => {
  function allowRule(pattern: string): Rule {
    return newRule(pattern, 'allow');
  }
  function closeRule(pattern: string): Rule {
    return newRule(pattern, 'clean-on-close');
  }
  function killRule(pattern: string): Rule {
    return newRule(pattern, 'clean-immediately');
  }

  it('allow rule overrides default-clean-immediately', () => {
    expect(
      decideCleanup(
        hostOnlyCookie('example.com'),
        [allowRule('example.com')],
        noTabs,
        settings('clean-immediately'),
      ),
    ).toBe('keep');
  });

  it('clean-immediately rule overrides default-allow', () => {
    expect(
      decideCleanup(
        hostOnlyCookie('example.com'),
        [killRule('example.com')],
        tabs('example.com'),
        settings('allow'),
      ),
    ).toBe('delete');
  });

  it('clean-on-close rule + open tab on same host → protect', () => {
    expect(
      decideCleanup(
        hostOnlyCookie('example.com'),
        [closeRule('example.com')],
        tabs('example.com'),
        settings('allow'),
      ),
    ).toBe('protect-while-tab-open');
  });

  it('clean-on-close rule + no open tab → delete', () => {
    expect(
      decideCleanup(
        hostOnlyCookie('example.com'),
        [closeRule('example.com')],
        noTabs,
        settings('allow'),
      ),
    ).toBe('delete');
  });

  it('first-match-wins (more-specific rule before generic)', () => {
    const cookie = hostOnlyCookie('foo.example.com');
    const decision = decideCleanup(
      cookie,
      [allowRule('foo.example.com'), killRule('*.example.com')],
      noTabs,
      settings('clean-immediately'),
    );
    expect(decision).toBe('keep');
  });

  it('first-match-wins (generic rule before specific masks it)', () => {
    const cookie = hostOnlyCookie('foo.example.com');
    const decision = decideCleanup(
      cookie,
      [killRule('*.example.com'), allowRule('foo.example.com')],
      noTabs,
      settings('clean-immediately'),
    );
    expect(decision).toBe('delete');
  });

  it('cookie with leading-dot domain matches rule on bare domain', () => {
    expect(
      decideCleanup(
        domainCookie('.example.com'),
        [allowRule('example.com')],
        noTabs,
        settings('clean-immediately'),
      ),
    ).toBe('keep');
  });

  it('subdomain cookie protected by parent-domain rule via *.', () => {
    expect(
      decideCleanup(
        hostOnlyCookie('foo.example.com'),
        [closeRule('*.example.com')],
        tabs('foo.example.com'),
        settings('clean-immediately'),
      ),
    ).toBe('protect-while-tab-open');
  });
});

describe('looksLikeLoginCookie', () => {
  const c = (
    name: string,
    extra: Partial<Pick<Cookie, 'session' | 'httpOnly'>> = {},
  ): Pick<Cookie, 'name' | 'session' | 'httpOnly'> => ({
    name,
    session: extra.session ?? false,
    httpOnly: extra.httpOnly ?? false,
  });

  it('matches common auth/session name hints (case-insensitive)', () => {
    for (const name of [
      'SID',
      'PHPSESSID',
      'auth_token',
      'jwt',
      'csrf',
      'remember_me',
      '__Host-x',
    ]) {
      expect(looksLikeLoginCookie(c(name))).toBe(true);
    }
  });

  it('matches a session + httpOnly cookie even with a neutral name', () => {
    expect(looksLikeLoginCookie(c('x', { session: true, httpOnly: true }))).toBe(true);
  });

  it('does not match a plain tracking-style cookie', () => {
    expect(looksLikeLoginCookie(c('_ga'))).toBe(false);
    expect(looksLikeLoginCookie(c('pref', { session: true, httpOnly: false }))).toBe(false);
  });
});

describe('GuardianSettingsSchema migration defaults', () => {
  it('fills protectLogins=true and clearSiteData=false for legacy settings', () => {
    const parsed = GuardianSettingsSchema.parse({ defaultAction: 'clean-on-close' });
    expect(parsed).toEqual({
      defaultAction: 'clean-on-close',
      protectLogins: true,
      clearSiteData: false,
    });
  });

  it('preserves explicit values', () => {
    const parsed = GuardianSettingsSchema.parse({
      defaultAction: 'allow',
      protectLogins: false,
      clearSiteData: true,
    });
    expect(parsed.protectLogins).toBe(false);
    expect(parsed.clearSiteData).toBe(true);
  });
});

describe('DEFAULT_GUARDIAN_SETTINGS (UX audit F1 / Plan A)', () => {
  // Deliberate product decision: fresh installs auto-clean unlisted sites on
  // tab close so the promise ("auto-delete") is true out of the box, with
  // protectLogins as the safety net. Guard against an accidental revert to the
  // old whitelist-only default. If this changes, it's a product decision, not
  // a refactor — update the onboarding copy + popup tagline together.
  it('cleans on close by default, with login protection on', () => {
    expect(DEFAULT_GUARDIAN_SETTINGS.defaultAction).toBe('clean-on-close');
    expect(DEFAULT_GUARDIAN_SETTINGS.protectLogins).toBe(true);
    expect(DEFAULT_GUARDIAN_SETTINGS.clearSiteData).toBe(false);
  });
});

describe('decideCleanup — login-protection safety net', () => {
  function killRule(pattern: string): Rule {
    return newRule(pattern, 'clean-immediately');
  }

  it('keeps a login cookie that default-clean-on-close would delete (tab closed)', () => {
    expect(decideCleanup(loginCookie('app.com'), [], noTabs, settings('clean-on-close'))).toBe(
      'protect-login',
    );
  });

  it('keeps a login cookie under default clean-immediately', () => {
    expect(decideCleanup(loginCookie('app.com'), [], noTabs, settings('clean-immediately'))).toBe(
      'protect-login',
    );
  });

  it('still deletes a login cookie when an EXPLICIT clean-immediately rule matches', () => {
    expect(
      decideCleanup(loginCookie('app.com'), [killRule('app.com')], noTabs, settings('allow')),
    ).toBe('delete');
  });

  it('does not protect when protectLogins is off', () => {
    expect(
      decideCleanup(loginCookie('app.com'), [], noTabs, settings('clean-immediately', false)),
    ).toBe('delete');
  });

  it('does not change non-login cookies (still deleted)', () => {
    expect(
      decideCleanup(hostOnlyCookie('app.com'), [], noTabs, settings('clean-immediately')),
    ).toBe('delete');
  });

  it('login cookie with an open tab is protect-while-tab-open, not protect-login', () => {
    expect(
      decideCleanup(loginCookie('app.com'), [], tabs('app.com'), settings('clean-on-close')),
    ).toBe('protect-while-tab-open');
  });
});

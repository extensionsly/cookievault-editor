import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logError, readErrors, clearErrors, reportUrl, type ErrEntry } from './errlog.js';

const KEY = 'cookievault.editor.errlog.v1';

/** In-memory storage.local, mirroring the pattern in auth.test.ts. */
let store: Map<string, unknown>;
function installStorage(seed: Record<string, unknown> = {}): void {
  store = new Map(Object.entries(seed));
  (globalThis as unknown as { chrome: { storage: { local: unknown } } }).chrome.storage.local = {
    get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
    set: async (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) store.set(k, v);
    },
    remove: async (key: string) => void store.delete(key),
    onChanged: { addListener() {}, removeListener() {} },
  };
}

beforeEach(() => installStorage());
afterEach(() => installStorage());

describe('errlog ring buffer', () => {
  it('appends errors with context and a message summary', async () => {
    await logError(new Error('boom'), 'bootstrap');
    const [e] = await readErrors();
    expect(e?.ctx).toBe('bootstrap');
    expect(e?.msg).toContain('Error: boom');
    expect(typeof e?.t).toBe('number');
  });

  it('caps at 50 entries, keeping the most recent', async () => {
    for (let i = 0; i < 60; i++) await logError(new Error(`e${i}`), 'loop');
    const all = await readErrors();
    expect(all.length).toBe(50);
    expect(all[0]?.msg).toContain('e10'); // oldest kept
    expect(all[49]?.msg).toContain('e59'); // newest
  });

  it('reads corrupt / non-array storage as empty instead of throwing', async () => {
    installStorage({ [KEY]: 'not-an-array' });
    await expect(readErrors()).resolves.toEqual([]);
    installStorage({ [KEY]: [{ garbage: true }, { t: 1, msg: 'ok', ctx: 'x' }] });
    const kept = await readErrors();
    expect(kept.length).toBe(1);
    expect(kept[0]?.msg).toBe('ok');
  });

  it('summarizes non-Error throwables', async () => {
    await logError('plain string failure', 'weird');
    const [e] = await readErrors();
    expect(e?.msg).toBe('plain string failure');
    expect(e?.at).toBeUndefined();
  });

  it('clearErrors empties the buffer', async () => {
    await logError(new Error('x'), 'c');
    await clearErrors();
    expect(await readErrors()).toEqual([]);
  });

  it('never throws when storage itself fails', async () => {
    (globalThis as unknown as { chrome: { storage: { local: unknown } } }).chrome.storage.local = {
      get: async () => {
        throw new Error('storage down');
      },
      set: async () => {
        throw new Error('storage down');
      },
      remove: async () => {
        throw new Error('storage down');
      },
    };
    await expect(logError(new Error('x'), 'c')).resolves.toBeUndefined();
    await expect(readErrors()).resolves.toEqual([]);
    await expect(clearErrors()).resolves.toBeUndefined();
  });
});

describe('reportUrl', () => {
  it('builds a GitHub issue URL with version, UA and recent errors prefilled', () => {
    const recent: ErrEntry[] = [{ t: 1, ctx: 'bootstrap', msg: 'Error: boom', at: 'at foo (x:1)' }];
    const url = reportUrl(recent);
    expect(url.startsWith('https://github.com/xiaobaocms/CookieVault/issues/new?')).toBe(true);
    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).toContain('CookieVault Editor');
    expect(body).toContain('bootstrap');
    expect(body).toContain('Error: boom');
  });

  it('handles no recent errors', () => {
    const body = new URL(reportUrl()).searchParams.get('body') ?? '';
    expect(body).toContain('(none captured)');
  });
});

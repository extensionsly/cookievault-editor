import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountApp } from './mount.js';

const SCREEN = {
  title: 'Fatal title',
  body: 'Fatal body',
  reportLabel: 'Report',
  reportHref: 'https://example.test/i',
};

/** React 19 createRoot renders concurrently; let it flush before asserting. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('mountApp bootstrap', () => {
  it('mounts the app when prepare and render succeed', async () => {
    await mountApp({ rootId: 'root', app: <p>hello</p>, screen: SCREEN });
    await flush();
    expect(document.getElementById('root')?.textContent).toContain('hello');
  });

  it('shows the fatal screen (not a white page) when prepare throws', async () => {
    const onError = vi.fn();
    await mountApp({
      rootId: 'root',
      app: <p>never</p>,
      prepare: () => {
        throw new Error('init blew up');
      },
      onError,
      screen: SCREEN,
    });
    const root = document.getElementById('root');
    expect(root?.textContent).toContain('Fatal title');
    expect(root?.textContent).toContain('Fatal body');
    // renderErrorScreen marks the mount element itself as the alert region.
    expect(root?.getAttribute('role')).toBe('alert');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'bootstrap');
  });

  it('reports a missing root element without throwing', async () => {
    document.body.innerHTML = ''; // no #root
    const onError = vi.fn();
    await expect(
      mountApp({ rootId: 'root', app: <p>x</p>, onError, screen: SCREEN }),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'bootstrap');
  });

  it('a throwing onError never escapes bootstrap', async () => {
    await expect(
      mountApp({
        rootId: 'root',
        app: <p>x</p>,
        prepare: () => {
          throw new Error('boom');
        },
        onError: () => {
          throw new Error('logger boom');
        },
        screen: SCREEN,
      }),
    ).resolves.toBeUndefined();
    expect(document.getElementById('root')?.textContent).toContain('Fatal title');
  });
});

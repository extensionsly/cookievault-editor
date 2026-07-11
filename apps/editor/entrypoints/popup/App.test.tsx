import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// Mock the chrome-touching lib + the ProfileBar subtree (which has its own
// vault/auth wiring we don't want to exercise here). Everything the hoisted
// vi.mock factory references must come from vi.hoisted (mocks hoist above the
// module's own imports + consts).
const { removeCookie, listCookies } = vi.hoisted(() => {
  const cookie = {
    name: 'sid',
    value: 'abc',
    domain: 'example.com',
    hostOnly: true,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    session: false,
    expirationDate: 9_999_999_999,
    storeId: '0',
  };
  return {
    removeCookie: vi.fn(async () => {}),
    listCookies: vi.fn(async () => [cookie]),
  };
});
vi.mock('../../lib/cookies.js', () => ({
  listCookies,
  removeCookie,
  saveCookie: vi.fn(async () => {}),
  importCookies: vi.fn(async () => ({ ok: 0, total: 0, failed: [], source: 'x' })),
  downloadExport: vi.fn(),
}));
vi.mock('./ProfileBar.js', () => ({ ProfileBar: () => null }));

import { App } from './App.js';

beforeEach(() => removeCookie.mockClear());
afterEach(cleanup);

describe('Editor popup', () => {
  it('deletes a cookie only after the ConfirmDialog is confirmed', async () => {
    render(<App />);

    // Row renders the cookie + a labelled delete button.
    const del = await screen.findByRole('button', { name: 'Delete sid' });
    fireEvent.click(del);
    // Nothing deleted yet — confirmation is pending.
    expect(removeCookie).not.toHaveBeenCalled();

    // The confirm button is labelled "Delete" (exact, distinct from "Delete sid").
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(removeCookie).toHaveBeenCalledTimes(1));
    expect(removeCookie).toHaveBeenCalledWith(expect.objectContaining({ name: 'sid' }));
  });

  it('clears the filter from the empty state', async () => {
    render(<App />);
    const search = await screen.findByLabelText('Filter cookies by domain or name');
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    const clear = await screen.findByRole('button', { name: 'Clear filter' });
    fireEvent.click(clear);
    // Filter cleared → cookie visible again.
    await screen.findByText('sid');
  });
});

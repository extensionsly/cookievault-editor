import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { switchProfile } = vi.hoisted(() => ({
  switchProfile: vi.fn(async () => ({
    rolledBack: false,
    applied: 1,
    failures: [],
    affectedTabs: 0,
    attempted: 1,
  })),
}));

vi.mock('../../lib/profile-store.js', () => ({
  getSessionKey: vi.fn(async () => ({}) as unknown as CryptoKey),
  loadVault: vi.fn(async () => ({ format: 'cookievault.vault/v1' })),
  readProfiles: vi.fn(async () => [
    { id: 'p1', name: 'Acct A', createdAt: '', updatedAt: '', cookies: [] },
  ]),
  lock: vi.fn(async () => {}),
}));
vi.mock('../../lib/profile.js', () => ({
  switchProfile,
  reloadScopeTabs: vi.fn(async () => 0),
}));

import { ProfileBar } from './ProfileBar.js';

beforeEach(() => switchProfile.mockClear());
afterEach(cleanup);

describe('ProfileBar', () => {
  it('switches a profile only after the confirm dialog is accepted', async () => {
    render(<ProfileBar onToast={vi.fn()} />);

    // Unlocked view renders the saved profile.
    await screen.findByText('Acct A');
    // Row "Switch" button opens the confirm dialog; nothing switches yet.
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(switchProfile).not.toHaveBeenCalled();

    // Now both the row button and the dialog confirm read "Switch"; the
    // dialog's is the last one rendered.
    const confirms = await screen.findAllByRole('button', { name: 'Switch' });
    fireEvent.click(confirms[confirms.length - 1]);
    await waitFor(() => expect(switchProfile).toHaveBeenCalledTimes(1));
  });
});

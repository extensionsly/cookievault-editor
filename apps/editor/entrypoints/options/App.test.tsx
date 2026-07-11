import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// No vault yet → the options page shows the setup screen.
vi.mock('../../lib/profile-store.js', () => ({
  loadVault: vi.fn(async () => null),
  getSessionKey: vi.fn(async () => null),
  readProfiles: vi.fn(async () => []),
  initialiseVault: vi.fn(async () => {}),
  unlockVault: vi.fn(async () => {}),
  resetVault: vi.fn(async () => {}),
  lock: vi.fn(async () => {}),
  loadRateLimit: vi.fn(async () => ({ failures: 0 })),
  saveRateLimit: vi.fn(async () => {}),
  clearRateLimit: vi.fn(async () => {}),
  writeProfiles: vi.fn(async () => {}),
}));
vi.mock('../../lib/profile.js', () => ({
  listCookiesInScope: vi.fn(async () => []),
  reloadScopeTabs: vi.fn(async () => 0),
  switchProfile: vi.fn(),
}));
vi.mock('./AccountPanel.js', () => ({ AccountPanel: () => null }));

import { App } from './App.js';

afterEach(cleanup);

describe('Editor options', () => {
  it('shows the vault setup screen when no vault exists', async () => {
    render(<App />);
    await screen.findByText('Set up profile vault');
    screen.getByRole('button', { name: 'Create vault' });
  });
});

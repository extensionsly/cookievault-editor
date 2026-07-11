import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { requestMagicLink, verifyMagicToken } = vi.hoisted(() => ({
  requestMagicLink: vi.fn(async () => {}),
  verifyMagicToken: vi.fn(async () => ({
    accessToken: 'a',
    accessExpiresAt: 0,
    refreshToken: 'r',
    refreshExpiresAt: 0,
    userId: 'u1',
    email: 'qa@example.com',
    kdfSalt: 's',
  })),
}));

vi.mock('../../lib/auth.js', () => ({
  loadPersistedAuth: vi.fn(async () => null),
  requestMagicLink,
  verifyMagicToken,
  signOut: vi.fn(async () => {}),
  clearPersistedAuth: vi.fn(async () => {}),
}));
vi.mock('../../lib/sync-state.js', () => ({
  loadSyncState: vi.fn(async () => ({
    lastEtag: null,
    lastSyncedAt: null,
    conflictRemoteSha256Hint: null,
    pendingPush: false,
  })),
  syncNow: vi.fn(),
  keepMine: vi.fn(),
  takeTheirs: vi.fn(),
}));
vi.mock('../../lib/profile-store.js', () => ({ loadVault: vi.fn(async () => null) }));
vi.mock('../../lib/telemetry.js', () => ({
  TELEMETRY_OPT_IN_KEY: 'cookievault.telemetry.optIn.v1',
  getTelemetryOptIn: vi.fn(async () => false),
  setTelemetryOptIn: vi.fn(async () => {}),
}));

import { AccountPanel } from './AccountPanel.js';

beforeEach(() => {
  requestMagicLink.mockClear();
  verifyMagicToken.mockClear();
});
afterEach(cleanup);

describe('AccountPanel', () => {
  it('requests a sign-in code and shows the sent confirmation', async () => {
    render(<AccountPanel />);

    const email = await screen.findByLabelText('Email');
    fireEvent.change(email, { target: { value: 'qa@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));

    await waitFor(() => expect(requestMagicLink).toHaveBeenCalledWith('qa@example.com'));
    await screen.findByText(/Sign-in code sent/);
  });

  it('exchanges a pasted code via verifyMagicToken (POST, not a link)', async () => {
    render(<AccountPanel />);

    const email = await screen.findByLabelText('Email');
    fireEvent.change(email, { target: { value: 'qa@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));

    const code = await screen.findByLabelText('Sign-in code');
    fireEvent.change(code, { target: { value: 'the-pasted-code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finish sign-in' }));

    await waitFor(() =>
      expect(verifyMagicToken).toHaveBeenCalledWith('the-pasted-code', 'qa@example.com'),
    );
  });
});

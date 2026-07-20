import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

type TestSession = { access: string; refresh: string; email: string };

const { requestCode, signIn, getSession } = vi.hoisted(() => ({
  requestCode: vi.fn(async () => ({ ok: true })),
  signIn: vi.fn(async () => ({ ok: true })),
  getSession: vi.fn<() => Promise<TestSession | null>>(async () => ({
    access: 'a',
    refresh: 'r',
    email: 'qa@example.com',
  })),
}));

vi.mock('../../lib/pro/account.js', () => ({
  ACCOUNT_SESSION_KEY: 'account.session',
  getSession,
  requestCode,
  signIn,
  signOut: vi.fn(async () => {}),
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
  requestCode.mockClear();
  signIn.mockClear();
  getSession.mockClear();
  getSession.mockResolvedValue(null);
});
afterEach(cleanup);

describe('AccountPanel', () => {
  it('requests a sign-in code and shows the sent confirmation', async () => {
    render(<AccountPanel />);

    const email = await screen.findByLabelText('Email');
    fireEvent.change(email, { target: { value: 'qa@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));

    await waitFor(() => expect(requestCode).toHaveBeenCalledWith('qa@example.com'));
    await screen.findByText(/Sign-in code sent/);
  });

  it('exchanges a pasted code through the Extensionsly account API', async () => {
    render(<AccountPanel />);

    const email = await screen.findByLabelText('Email');
    fireEvent.change(email, { target: { value: 'qa@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in code' }));

    const code = await screen.findByLabelText('Sign-in code');
    fireEvent.change(code, { target: { value: 'the-pasted-code' } });
    getSession.mockResolvedValue({
      access: 'a',
      refresh: 'r',
      email: 'qa@example.com',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Finish sign-in' }));

    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith('qa@example.com', 'the-pasted-code'),
    );
  });
});

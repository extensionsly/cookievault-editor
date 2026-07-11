import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { Cookie } from '@cookievault/shared/schema';
import { EditDialog } from './EditDialog.js';

afterEach(cleanup);

const COOKIE: Cookie = {
  name: 'sid',
  value: 'abc',
  domain: 'example.com',
  hostOnly: true,
  path: '/',
  secure: false,
  httpOnly: false,
  sameSite: 'unspecified',
  session: true,
  storeId: '0',
};

describe('EditDialog', () => {
  it('edits a field and submits the updated cookie via onSave', async () => {
    const onSave = vi.fn(async () => {});
    render(<EditDialog cookie={COOKIE} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'session-id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'session-id', domain: 'example.com' }),
    );
  });

  it('surfaces an error thrown by onSave without closing', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('Invalid domain');
    });
    render(<EditDialog cookie={COOKIE} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Invalid domain')).toBeTruthy();
  });
});

import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addPasskey, deletePasskey, listPasskeys, renamePasskey } = vi.hoisted(() => ({
  addPasskey: vi.fn(),
  deletePasskey: vi.fn(),
  listPasskeys: vi.fn(),
  renamePasskey: vi.fn(),
}));

vi.mock('../../../src/lib/auth-client', () => ({
  passkey: { addPasskey },
}));

vi.mock('../../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        passkeys: {
          $get: listPasskeys,
          ':id': { $patch: renamePasskey, $delete: deletePasskey },
        },
      },
    },
  },
}));

import { PasskeysSection } from '../../../src/components/settings/passkeys-section';

interface PasskeyFixture {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  aaguid: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
}

const CREATED_AT = new Date('2026-08-30T17:00:00.000Z');

function passkeyFixture(overrides: Partial<PasskeyFixture>): PasskeyFixture {
  return {
    id: 'passkey-1',
    name: 'MacBook passkey',
    deviceType: 'singleDevice',
    backedUp: false,
    transports: ['internal'],
    aaguid: '00000000-0000-0000-0000-000000000000',
    createdAt: CREATED_AT.toISOString(),
    lastUsedAt: null,
    ...overrides,
  };
}

function wrapper(): ({ children }: { children: ReactNode }) => JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderPasskeys(records: PasskeyFixture[]): void {
  listPasskeys.mockResolvedValue(
    new Response(JSON.stringify({ items: records }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  render(<PasskeysSection />, { wrapper: wrapper() });
}

beforeEach(() => {
  addPasskey.mockReset().mockResolvedValue({ data: {}, error: null });
  deletePasskey
    .mockReset()
    .mockResolvedValue(new Response(JSON.stringify({ status: true, credentialId: 'credential' })));
  listPasskeys.mockReset();
  renamePasskey.mockReset().mockResolvedValue(new Response(JSON.stringify(passkeyFixture({}))));
});

afterEach(cleanup);

describe('PasskeysSection', () => {
  it('starts the platform ceremony from one Add passkey click without asking for a name', async () => {
    renderPasskeys([passkeyFixture({})]);

    fireEvent.click(await screen.findByRole('button', { name: 'Add passkey' }));

    await waitFor(() => {
      expect(addPasskey).toHaveBeenCalledWith();
    });
    expect(screen.queryByRole('dialog', { name: 'Add a passkey' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
  });

  it('describes and illustrates each passkey by authenticator kind', async () => {
    renderPasskeys([
      passkeyFixture({
        id: 'synced',
        name: 'iCloud Keychain',
        deviceType: 'multiDevice',
        backedUp: true,
        transports: ['internal', 'hybrid'],
      }),
      passkeyFixture({ id: 'device', name: 'MacBook Touch ID' }),
      passkeyFixture({
        id: 'security-key',
        name: 'YubiKey',
        transports: ['usb', 'nfc'],
      }),
      passkeyFixture({ id: 'phone', name: 'Nearby phone', transports: ['hybrid'] }),
      passkeyFixture({ id: 'unknown', name: 'Other passkey', transports: [] }),
    ]);

    await screen.findByText('iCloud Keychain');

    const syncedRow = screen.getByText('iCloud Keychain').closest('li');
    const deviceRow = screen.getByText('MacBook Touch ID').closest('li');
    const keyRow = screen.getByText('YubiKey').closest('li');
    const phoneRow = screen.getByText('Nearby phone').closest('li');
    const unknownRow = screen.getByText('Other passkey').closest('li');
    expect(syncedRow).not.toBeNull();
    expect(deviceRow).not.toBeNull();
    expect(keyRow).not.toBeNull();
    expect(phoneRow).not.toBeNull();
    expect(unknownRow).not.toBeNull();
    if (!syncedRow || !deviceRow || !keyRow || !phoneRow || !unknownRow) return;

    expect(syncedRow).toHaveTextContent('Synced passkey');
    expect(within(syncedRow).getByTestId('CloudSyncOutlinedIcon')).toBeInTheDocument();
    expect(deviceRow).toHaveTextContent('Device passkey');
    expect(within(deviceRow).getByTestId('FingerprintIcon')).toBeInTheDocument();
    expect(keyRow).toHaveTextContent('Security key');
    expect(within(keyRow).getByTestId('UsbOutlinedIcon')).toBeInTheDocument();
    expect(phoneRow).toHaveTextContent('Nearby-device passkey');
    expect(within(phoneRow).getByTestId('PhonelinkLockOutlinedIcon')).toBeInTheDocument();
    expect(unknownRow).toHaveTextContent('Passkey');
    expect(within(unknownRow).getByTestId('KeyOutlinedIcon')).toBeInTheDocument();
  });

  it('keeps the generated name readable until the person chooses Rename', async () => {
    renderPasskeys([passkeyFixture({ name: 'Chrome on macOS' })]);

    await screen.findByText('Chrome on macOS');
    expect(screen.queryByRole('textbox', { name: 'Passkey name' })).not.toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: 'Actions for Chrome on macOS' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const name = screen.getByRole('textbox', { name: 'Passkey name' });
    expect(name).toHaveValue('Chrome on macOS');
    fireEvent.change(name, { target: { value: 'Personal MacBook' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => {
      expect(renamePasskey).toHaveBeenCalledWith({
        param: { id: 'passkey-1' },
        json: { name: 'Personal MacBook' },
      });
    });
  });

  it('shows when a passkey was last used', async () => {
    renderPasskeys([
      passkeyFixture({ lastUsedAt: new Date('2026-08-31T17:00:00.000Z').toISOString() }),
    ]);

    const row = (await screen.findByText('MacBook passkey')).closest('li');
    expect(row).toHaveTextContent('Last used');
  });
});

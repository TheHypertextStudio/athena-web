import '@testing-library/jest-dom/vitest';

import { IntegrationOut } from '@docket/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GtasksAccountRow } from '../../../src/components/settings/gtasks-account-row';

afterEach(cleanup);

const CONNECTED_ACCOUNT = IntegrationOut.parse({
  id: '01M04MDQ20DB0N3QCN0AA9KQKN',
  organizationId: '01KY1N724K30F3MCPQMRC7GVD3',
  provider: 'gtasks',
  pattern: 'connector',
  roles: ['work'],
  connection: { account: 'hello@example.com' },
  status: 'connected',
  config: {},
  externalAccountId: 'google-account',
  syncMode: 'mirror',
  writeBack: true,
  lastSyncStatus: null,
  lastSyncedAt: null,
  lastError: null,
  lastErrorAt: null,
  lastErrorKind: null,
  syncCadenceMinutes: 60,
  createdAt: '2026-08-24T00:00:00.000Z',
});

function renderAccount(status: 'connected' | 'error', error = ''): void {
  render(
    <GtasksAccountRow
      orgId="org-1"
      teams={[]}
      canManage
      row={{
        account: IntegrationOut.parse({ ...CONNECTED_ACCOUNT, status }),
        label: 'hello@example.com',
        state: {
          busyReconnect: false,
          busySync: false,
          busyDisconnect: false,
          error,
          feedback: '',
          configOpen: false,
        },
        actions: {
          reconnect: vi.fn(),
          sync: vi.fn(),
          toggleConfig: vi.fn(),
          requestDisconnect: vi.fn(),
        },
      }}
    />,
  );
}

describe('GtasksAccountRow', () => {
  it('shows the account and what Google Tasks syncs on a healthy card', () => {
    renderAccount('connected');

    expect(screen.getByText('hello@example.com')).toBeInTheDocument();
    expect(screen.getByText('Sync tasks and lists with Google Tasks.')).toBeInTheDocument();
    expect(screen.queryByText('Two-way · all lists')).not.toBeInTheDocument();
  });

  it('keeps the account and purpose visible when an action fails', () => {
    renderAccount('error', 'Could not reconnect this account.');

    expect(screen.getByRole('alert')).toHaveTextContent('Could not reconnect this account.');
    expect(screen.getByText('hello@example.com')).toBeInTheDocument();
    expect(screen.getByText('Sync tasks and lists with Google Tasks.')).toBeInTheDocument();
  });
});

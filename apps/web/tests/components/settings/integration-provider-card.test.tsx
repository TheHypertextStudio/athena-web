import '@testing-library/jest-dom/vitest';

import { IntegrationOut, type IntegrationDirectoryProvider } from '@docket/types';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationProviderCard } from '../../../src/components/settings/integration-provider-card';

afterEach(cleanup);

const NOTION: IntegrationDirectoryProvider = {
  provider: 'notion',
  name: 'Notion',
  roles: ['work'],
  syncable: true,
} as IntegrationDirectoryProvider;

const PENDING_NOTION = IntegrationOut.parse({
  id: '01M04MDQ20DB0N3QCN0AA9KQKN',
  organizationId: '01KY1N724K30F3MCPQMRC7GVD3',
  provider: 'notion',
  pattern: 'connector',
  roles: ['work'],
  connection: {},
  status: 'pending',
  config: {},
  externalAccountId: 'notion-account',
  syncMode: 'mirror',
  writeBack: true,
  lastSyncStatus: null,
  lastSyncedAt: null,
  lastError: null,
  lastErrorAt: null,
  lastErrorKind: null,
  syncCadenceMinutes: null,
  createdAt: '2026-08-24T00:00:00.000Z',
});

describe('IntegrationProviderCard', () => {
  it('shows an interrupted setup as repairable instead of pretending no connection exists', () => {
    render(
      <IntegrationProviderCard
        provider={NOTION}
        existing={PENDING_NOTION}
        canManage
        actionLabel="Connect"
        connectHint="Keep it in sync"
        busy={false}
        syncing={false}
        disconnecting={false}
        syncFeedback={null}
        actionError="Could not validate this connection."
        configurable={false}
        configOpen={false}
        configPanel={null}
        onConnect={vi.fn()}
        onReconnect={vi.fn()}
        onSync={vi.fn()}
        onDisconnect={vi.fn()}
        onToggleConfig={vi.fn()}
      />,
    );

    expect(screen.getByText('Finishing setup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeInTheDocument();
    expect(screen.getByText('Could not validate this connection.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
  });
});

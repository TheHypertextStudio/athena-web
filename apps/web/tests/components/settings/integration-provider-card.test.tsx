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

const CONNECTED_NOTION = IntegrationOut.parse({
  ...PENDING_NOTION,
  status: 'connected',
  connection: {
    account: 'Las Vegans for Better Transit',
    externalWorkspaceName: 'Las Vegans for Better Transit',
  },
  lastSyncStatus: 'succeeded',
  lastSyncedAt: '2026-08-24T01:00:00.000Z',
  syncCadenceMinutes: 60,
});

const FAILED_NOTION = IntegrationOut.parse({
  ...PENDING_NOTION,
  status: 'error',
  connection: { account: 'Las Vegans for Better Transit' },
  lastError: 'oauth token expired',
  lastErrorAt: '2026-08-24T01:00:00.000Z',
});

function renderNotion(existing: IntegrationOut | undefined): void {
  render(
    <IntegrationProviderCard
      provider={NOTION}
      existing={existing}
      canManage
      actionLabel="Connect"
      connectHint="Keep it in sync"
      effect="Keep your Notion databases and Docket tasks in sync."
      busy={false}
      syncing={false}
      disconnecting={false}
      syncFeedback={null}
      actionError={null}
      configurable={false}
      configOpen={false}
      configPanel={null}
      manageHref="/orgs/org-1/settings/connections/notion"
      onConnect={vi.fn()}
      onReconnect={vi.fn()}
      onSync={vi.fn()}
      onDisconnect={vi.fn()}
      onToggleConfig={vi.fn()}
    />,
  );
}

describe('IntegrationProviderCard', () => {
  it('keeps the provider purpose visible for a healthy connection', () => {
    renderNotion(CONNECTED_NOTION);

    expect(
      screen.getByText('Keep your Notion databases and Docket tasks in sync.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Notion' })).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByText(/Last synced/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Syncs hourly/)).not.toBeInTheDocument();
  });

  it('keeps the provider purpose visible while repair is required', () => {
    renderNotion(FAILED_NOTION);

    expect(
      screen.getByText('Keep your Notion databases and Docket tasks in sync.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.queryByText(/Never synced/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Problem detected|Last synced|restore syncing/i),
    ).not.toBeInTheDocument();
  });

  it('shows one sentence and one action before a provider is connected', () => {
    renderNotion(undefined);

    expect(
      screen.getByText('Keep your Notion databases and Docket tasks in sync.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

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

    expect(screen.getByText('Keep it in sync')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeInTheDocument();
    expect(screen.getByText('Could not validate this connection.')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
  });
});

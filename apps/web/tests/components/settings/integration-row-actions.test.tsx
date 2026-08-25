import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationRowActions } from '../../../src/components/settings/integration-row-actions';

afterEach(cleanup);

function renderActions(
  overrides: Partial<ComponentProps<typeof IntegrationRowActions>> = {},
): void {
  render(
    <IntegrationRowActions
      provider="github"
      providerName="GitHub"
      status="connected"
      canManage
      syncable
      isMigration={false}
      configurable={false}
      configOpen={false}
      manageHref={null}
      busyReconnect={false}
      busySync={false}
      busyDisconnect={false}
      onReconnect={vi.fn()}
      onSync={vi.fn()}
      onDisconnect={vi.fn()}
      onToggleConfig={vi.fn()}
      {...overrides}
    />,
  );
}

describe('IntegrationRowActions', () => {
  it('keeps a healthy provider to one manage action and one overflow menu', async () => {
    const onSync = vi.fn();
    const onDisconnect = vi.fn();
    renderActions({
      provider: 'notion',
      providerName: 'Notion',
      manageHref: '/orgs/org-1/settings/connections/notion',
      onSync,
      onDisconnect,
    });

    expect(screen.getByRole('link', { name: 'Manage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for Notion' })).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();

    const trigger = screen.getByRole('button', { name: 'Actions for Notion' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Sync now' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sync now' }));
    expect(onSync).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('uses Manage for a connected GitHub installation', () => {
    renderActions();

    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
  });

  it('lets a person finish an interrupted connection without creating another one', () => {
    renderActions({ status: 'pending' });

    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeInTheDocument();
  });

  it('does not offer sync while a connection needs repair', async () => {
    renderActions({ provider: 'gmail', providerName: 'Gmail', status: 'error' });

    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Actions for Gmail' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Disconnect' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('menuitem', { name: 'Sync now' })).not.toBeInTheDocument();
  });

  it('keeps sync progress visible after the overflow menu closes', () => {
    renderActions({ busySync: true });

    expect(screen.getByRole('status')).toHaveTextContent('Syncing…');
  });
});

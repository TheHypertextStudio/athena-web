import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
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
      status="connected"
      canManage
      syncable
      isMigration={false}
      configurable={false}
      configOpen={false}
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
  it('lets a connected GitHub workspace choose a different App installation', () => {
    renderActions();

    expect(screen.getByRole('button', { name: 'Change GitHub installation' })).toBeInTheDocument();
  });

  it('never presents a pending integration as a second Finish connecting action', () => {
    renderActions({ status: 'pending' });

    expect(screen.queryByRole('button', { name: /finish connecting/i })).not.toBeInTheDocument();
  });
});

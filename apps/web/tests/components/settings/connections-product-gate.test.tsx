import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { useConnectionsController } = vi.hoisted(() => ({
  useConnectionsController: vi.fn(),
}));

vi.mock('../../../src/components/settings/use-connections-controller', () => ({
  useConnectionsController,
}));

import { ConnectionsPanel } from '../../../src/components/settings/connections-panel';

describe('ConnectionsPanel product availability', () => {
  it('explains Docket Pro inline without blocking the settings surface', () => {
    useConnectionsController.mockReturnValue({
      orgId: 'org-1',
      canManage: true,
      teams: [],
      loading: false,
      loadError: null,
      productRequired: true,
      intro: { crossHref: '/orgs/org-1/settings/import', crossText: 'Import' },
      scope: { linkedAccountsHref: '/settings/connected-accounts' },
      gtasks: null,
      calendar: null,
      categories: [],
      confirm: { target: null, confirm: vi.fn(), cancel: vi.fn() },
    });

    render(<ConnectionsPanel orgId="org-1" canManage />);

    expect(
      screen.getByRole('heading', { name: 'Connect external tools with Docket Pro' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Docket Pro' })).toHaveAttribute(
      'href',
      '/orgs/org-1/settings/billing',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

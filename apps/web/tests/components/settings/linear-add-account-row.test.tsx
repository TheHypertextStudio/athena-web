import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LinearAddAccountRow } from '../../../src/components/settings/linear-add-account-row';

afterEach(cleanup);

function renderRow(connectedCount: number): void {
  render(
    <LinearAddAccountRow
      model={{
        available: [],
        selectedId: '',
        setSelectedId: vi.fn(),
        busy: false,
        connect: vi.fn(),
        addAccountsHref: '/settings/connected-accounts',
        connectedCount,
      }}
    />,
  );
}

describe('LinearAddAccountRow', () => {
  it('does not call the first Linear connection another account', () => {
    renderRow(0);

    expect(screen.getByText('Connect Linear')).toBeInTheDocument();
    expect(screen.queryByText('Connect another Linear account')).not.toBeInTheDocument();
    expect(screen.getByTestId('LayersIcon')).toBeInTheDocument();
  });

  it('names the add-another state after a Linear connection exists', () => {
    renderRow(1);

    expect(screen.getByText('Connect another Linear account')).toBeInTheDocument();
  });
});

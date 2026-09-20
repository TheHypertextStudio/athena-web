import '@testing-library/jest-dom/vitest';

import { OrganizationId, TeamId } from '@docket/identity-access/ids';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeamDetail } from '../../src/lib/contracts/team';

const { teamPatch } = vi.hoisted(() => ({ teamPatch: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          teams: { ':teamId': { $patch: teamPatch } },
        },
      },
    },
  },
}));

import { TeamCycleSettings } from '../../src/components/team-detail/team-cycle-settings';
import { jsonResponse } from '../support/http';

const TEAM = {
  id: TeamId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  organizationId: OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW'),
  name: 'Operations',
  key: 'OPS',
  summary: null,
  workflowStates: [],
  triageEnabled: true,
  cycleCadenceDays: 7,
  cycleCadenceAnchor: '2024-01-01',
  cycleCadenceRevision: 4,
  cycleCadenceEarliestAnchor: '2026-09-21',
  cycleCadenceProviderOwned: false,
} as TeamDetail;

beforeEach(() => {
  teamPatch.mockReset().mockResolvedValue(
    jsonResponse(true, {
      ...TEAM,
      cycleCadenceDays: 1,
      cycleCadenceAnchor: '2026-09-21',
      cycleCadenceRevision: 5,
      cadenceChange: { effectiveAnchor: '2026-09-21', removedEmptyCycles: 2 },
    }),
  );
});

afterEach(cleanup);

function renderSettings(team: TeamDetail = TEAM): void {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TeamCycleSettings orgId="01ARZ3NDEKTSV4RRFFQ69G5FAW" team={team} />
    </QueryClientProvider>,
  );
}

describe('TeamCycleSettings', () => {
  it('previews and saves a one-day cadence with the loaded revision', async () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText('Cycle length'), { target: { value: '1' } });

    expect(screen.getByText('Sep 21 – Sep 21')).toBeInTheDocument();
    expect(screen.getByText('Sep 22 – Sep 22')).toBeInTheDocument();
    expect(screen.getByText('Sep 23 – Sep 23')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save cadence' }));

    await waitFor(() => {
      expect(teamPatch).toHaveBeenCalledOnce();
    });
    expect(teamPatch.mock.calls[0]?.[0]).toEqual({
      param: {
        orgId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        teamId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      },
      json: {
        cycleCadenceDays: 1,
        cycleCadenceAnchor: '2026-09-21',
        cycleCadenceRevision: 4,
      },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Removed 2 empty future cycles. Existing assignments did not move.',
    );
  });

  it('rejects values outside the 1 through 365 day range before sending', () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText('Cycle length'), { target: { value: '366' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 through 365.');
    expect(screen.getByRole('button', { name: 'Save cadence' })).toBeDisabled();
    expect(teamPatch).not.toHaveBeenCalled();
  });

  it('renders provider-owned cadence as read-only guidance', () => {
    renderSettings({ ...TEAM, cycleCadenceProviderOwned: true });

    expect(screen.getByText(/connected provider manages this team’s cycle cadence/i)).toBeVisible();
    expect(screen.queryByLabelText('Cycle length')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save cadence' })).not.toBeInTheDocument();
  });

  it('shows application-owned feedback when another manager changed the cadence', async () => {
    teamPatch.mockResolvedValue(
      jsonResponse(false, { code: 'cadence_changed', title: 'private provider text' }, 409),
    );
    renderSettings();
    fireEvent.change(screen.getByLabelText('Cycle length'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save cadence' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save cycle settings.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('private provider text');
  });
});

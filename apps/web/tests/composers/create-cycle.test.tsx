import { OrganizationId, TeamId, type TeamOut } from '@docket/types';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cyclePost } = vi.hoisted(() => ({ cyclePost: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          cycles: { $post: cyclePost },
        },
      },
    },
  },
}));

import { CreateCycleDialog } from '../../src/components/cycles/create-cycle';
import { firstJson, jsonResponse } from '../support/http';

const ORG_ID = '0RG00000000000000000000001';
const TEAM_ID = 'TEAM0000000000000000000002';
const TEAM: TeamOut = {
  id: TeamId.parse(TEAM_ID),
  organizationId: OrganizationId.parse(ORG_ID),
  name: 'General',
  key: 'GEN',
  summary: null,
  triageEnabled: true,
};

beforeEach(() => {
  cyclePost.mockReset();
  cyclePost
    .mockResolvedValueOnce(jsonResponse(true, { id: 'cycle_1', name: 'First' }))
    .mockResolvedValueOnce(jsonResponse(true, { id: 'cycle_2', name: 'Second' }));
});

afterEach(cleanup);

describe('CreateCycleDialog continuation', () => {
  it('advances a non-overlapping window and sequence before the parent roster refreshes', async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CreateCycleDialog
        orgId={ORG_ID}
        cycleNoun="Cycle"
        teams={[TEAM]}
        defaultTeamId={TEAM_ID}
        teamsLoading={false}
        nextNumberForTeam={() => 7}
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Expand editor' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Create more' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    fireEvent.change(screen.getByLabelText(/name optional/), { target: { value: 'First' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Create more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Cycle' }));

    await waitFor(() => {
      expect(cyclePost).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText(/name optional/)).toHaveValue('');
    });
    const first = firstJson(cyclePost.mock.calls) as {
      startsAt: string;
      endsAt: string;
      number: number;
    };

    fireEvent.change(screen.getByLabelText(/name optional/), { target: { value: 'Second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Cycle' }));

    await waitFor(() => {
      expect(cyclePost).toHaveBeenCalledTimes(2);
    });
    const second = firstJson(cyclePost.mock.calls.slice(1)) as {
      startsAt: string;
      endsAt: string;
      number: number;
    };
    const dayAfterFirstEnd = new Date(`${first.endsAt}T00:00:00`);
    dayAfterFirstEnd.setDate(dayAfterFirstEnd.getDate() + 1);

    expect(second.startsAt).toBe(dayAfterFirstEnd.toISOString().slice(0, 10));
    expect(Date.parse(second.endsAt) - Date.parse(second.startsAt)).toBe(
      Date.parse(first.endsAt) - Date.parse(first.startsAt),
    );
    expect([first.number, second.number]).toEqual([7, 8]);
    expect(onCreated).toHaveBeenCalledTimes(2);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Cycle created. Ready to create another.');
  });
});

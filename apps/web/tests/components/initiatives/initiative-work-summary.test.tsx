import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { InitiativeWorkSummary } from '../../../src/components/initiatives/initiative-work-summary';

afterEach(cleanup);

it('offers project creation from an empty initiative without a misleading health legend', async () => {
  const create = vi.fn();
  render(
    <InitiativeWorkSummary
      connectedWork={[]}
      distribution={{ onTrack: 0, atRisk: 0, offTrack: 0, unknown: 0 }}
      loading={false}
      canEdit
      initiativeNoun="Initiative"
      programNoun="Program"
      projectNoun="Project"
      onCreateProject={create}
    />,
  );
  expect(screen.getByText('No projects advance this initiative yet.')).toBeVisible();
  expect(screen.queryByRole('list')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'New project' }));
  expect(create).toHaveBeenCalledOnce();
});

it('keeps the empty overview readable without offering creation to a viewer', () => {
  render(
    <InitiativeWorkSummary
      connectedWork={[]}
      distribution={{ onTrack: 0, atRisk: 0, offTrack: 0, unknown: 0 }}
      loading={false}
      canEdit={false}
      initiativeNoun="Goal"
      programNoun="Program"
      projectNoun="Event"
      onCreateProject={vi.fn()}
    />,
  );
  expect(screen.getByText('No events advance this goal yet.')).toBeVisible();
  expect(screen.queryByRole('button')).toBeNull();
});

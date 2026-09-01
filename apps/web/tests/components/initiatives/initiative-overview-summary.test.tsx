import type { InitiativeDetail } from '@docket/work/initiative-contract';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { InitiativeOverviewSummary } from '../../../src/components/initiatives/initiative-overview-summary';

describe('InitiativeOverviewSummary', () => {
  it('shows connected work as a health rollup without rendering task work', () => {
    const initiative = {
      childMix: { programs: 2, projects: 3 },
      distribution: { onTrack: 2, atRisk: 1, offTrack: 1, unknown: 1 },
      rolledUpHealth: 'off_track',
    } as InitiativeDetail;

    render(
      <InitiativeOverviewSummary
        initiative={initiative}
        programNoun="Program"
        projectNoun="Project"
      />,
    );

    expect(screen.getByRole('region', { name: 'Connected work rollup' })).toBeTruthy();
    expect(screen.getByText('Rollup: Off track')).toBeTruthy();
    expect(screen.getByText('Programs')).toBeTruthy();
    expect(screen.getByText('Projects')).toBeTruthy();
    expect(screen.queryByText(/Task dependencies/)).toBeNull();
  });
});

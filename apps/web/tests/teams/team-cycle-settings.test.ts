import { describe, expect, it } from 'vitest';

import { cycleCadencePreview } from '../../src/components/team-detail/team-cycle-settings';
import { teamDetailTabs } from '../../src/components/team-detail/team-detail-tabs';

describe('teamDetailTabs', () => {
  it('shows Settings only to members with manage capability', () => {
    expect(teamDetailTabs(false).map(({ label }) => label)).not.toContain('Settings');
    expect(teamDetailTabs(true).map(({ label }) => label)).toContain('Settings');
  });
});

describe('cycleCadencePreview', () => {
  it('previews three daily cycles as distinct calendar days', () => {
    expect(
      cycleCadencePreview('2026-03-07', 1).map(({ startDate, endDate }) => ({
        startDate,
        endDate,
      })),
    ).toEqual([
      { startDate: '2026-03-07', endDate: '2026-03-07' },
      { startDate: '2026-03-08', endDate: '2026-03-08' },
      { startDate: '2026-03-09', endDate: '2026-03-09' },
    ]);
  });
});

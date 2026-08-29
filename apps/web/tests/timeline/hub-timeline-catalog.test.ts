import { HubProjectBar } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { buildHubTimelineCatalog } from '../../src/components/portfolio/hub-timeline-catalog';

describe('Hub timeline interaction policy', () => {
  it('keeps cross-workspace Project identity without exposing writes or drag', () => {
    const bar = HubProjectBar.parse({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FD0',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      name: 'Cross-workspace Project',
      status: 'started',
      health: 'on_track',
      startDate: '2026-08-01',
      targetDate: '2026-08-31',
      milestones: [],
    });

    expect(buildHubTimelineCatalog().interaction({ bar, programName: null })).toEqual({
      object: {
        kind: 'project',
        id: bar.id,
        organizationId: bar.organizationId,
        title: bar.name,
      },
      dragDisabled: true,
      actionScope: 'reference',
    });
  });
});

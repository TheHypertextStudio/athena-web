import type { InitiativeDetailAggregate } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { patchInitiativeAggregate } from '@/lib/use-initiative-mutations';

const aggregate = {
  target: 'initiative',
  snapshot: {
    target: 'initiative',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    name: 'Original',
    status: 'active',
    priority: 'none',
    health: 'on_track',
    updatedAt: '2026-08-23T12:00:00.000Z',
  },
  viewer: { actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
  capabilities: { comment: true, contribute: true, assign: true, manage: true },
  references: {
    owner: { actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAX', displayName: 'Original owner', avatar: null },
  },
  defaultView: {
    initiative: {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      name: 'Original',
      description: null,
      summary: null,
      ownerId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      status: 'active',
      priority: 'none',
      updateCadence: 'monthly',
      targetDate: null,
      targetDateResolution: null,
      targetDateFiscalYearStartMonth: null,
      health: 'on_track',
      createdAt: '2026-08-23T12:00:00.000Z',
      childMix: { programs: 0, projects: 0 },
      distribution: { onTrack: 0, atRisk: 0, offTrack: 0, unknown: 0 },
      rolledUpHealth: null,
    },
  },
} as InitiativeDetailAggregate;

describe('patchInitiativeAggregate', () => {
  it('keeps the cached navigation snapshot aligned with optimistic Initiative changes', () => {
    const patched = patchInitiativeAggregate(aggregate, (initiative) => ({
      ...initiative,
      name: 'Renamed',
      status: 'completed',
      priority: 'high',
      health: 'at_risk',
      ownerId: null,
    }));

    expect(patched?.snapshot).toMatchObject({
      name: 'Renamed',
      status: 'completed',
      priority: 'high',
      health: 'at_risk',
    });
    expect(patched?.references.owner).toBeNull();
  });
});

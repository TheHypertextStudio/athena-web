import { EntityAssociation } from '@docket/connections/event-contract';
import { describe, expect, it } from 'vitest';

import { entityAssociation } from '../src/enums';

describe('entity_association enum', () => {
  it('matches the domain enum in the same order', () => {
    // Two independent declarations of one closed set: the value the firehose writes, and the value
    // Postgres will accept. Order is asserted rather than sorted because both declarations claim to
    // be order-locked, and `ALTER TYPE ... ADD VALUE` positions new members relative to existing
    // ones — a silent reorder here is a migration that no longer means what it says.
    expect(entityAssociation.enumValues).toEqual(EntityAssociation.options);
  });

  it('keeps pending distinct from unmatched', () => {
    // Both leave `entity.docketEntityId` null, and collapsing them would either strand rows the
    // re-association sweep should retry or make it re-scan rows already proven to have no match.
    expect(EntityAssociation.parse('pending')).toBe('pending');
    expect(EntityAssociation.parse('unmatched')).toBe('unmatched');
    expect(EntityAssociation.safeParse('resolved').success).toBe(false);
  });
});

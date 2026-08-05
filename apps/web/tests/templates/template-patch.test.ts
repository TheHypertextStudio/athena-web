/**
 * Turning a stored template payload into a composer-draft patch.
 *
 * @remarks
 * The mapping is deliberately almost an identity — a payload is modelled as a partial of the
 * entity's create body, so the only work is dropping the discriminant. What is worth pinning is
 * the guard: a payload of the wrong kind must contribute nothing rather than scatter another
 * entity's fields across the draft.
 */
import { describe, expect, it } from 'vitest';

import { sortTemplates, templatePatch } from '../../src/components/templates/queries';

import type { TemplateOut } from '@docket/types';

/**
 * Build a template row with only the fields these assertions read.
 *
 * @remarks
 * The overrides are plain strings rather than a `Partial<TemplateOut>` because `id` and
 * `organizationId` are branded, and branding a fixture id would say something about ULID validity
 * that these tests are not making a claim about.
 */
function template(overrides: {
  id: string;
  name: string;
  scope: TemplateOut['scope'];
}): TemplateOut {
  return {
    organizationId: 'org_1',
    targetType: 'task',
    description: null,
    ownerActorId: null,
    teamId: null,
    payload: { targetType: 'task' },
    isSeed: true,
    createdAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  } as unknown as TemplateOut;
}

describe('templatePatch', () => {
  it('strips the discriminant and keeps every other field', () => {
    expect(
      templatePatch({ targetType: 'task', title: 'Escalation: ', priority: 'urgent' }, 'task'),
    ).toEqual({ title: 'Escalation: ', priority: 'urgent' });
  });

  it('returns an empty patch when the payload describes another kind', () => {
    expect(templatePatch({ targetType: 'project', name: 'Launch' }, 'task')).toEqual({});
  });

  it('carries an absent field through as absent, so a merge leaves it alone', () => {
    const patch = templatePatch(
      { targetType: 'initiative', description: '## Overview' },
      'initiative',
    );
    expect(patch).toEqual({ description: '## Overview' });
    expect('priority' in patch).toBe(false);
  });
});

describe('sortTemplates', () => {
  it('lists shared templates before private ones, alphabetically within each scope', () => {
    const sorted = sortTemplates([
      template({ id: 'c', name: 'My scratch', scope: 'personal' }),
      template({ id: 'b', name: 'Bug report', scope: 'organization' }),
      template({ id: 'a', name: 'Architecture note', scope: 'organization' }),
      template({ id: 'd', name: 'Team ritual', scope: 'team' }),
    ]);

    expect(sorted.map((t) => t.name)).toEqual([
      'Architecture note',
      'Bug report',
      'Team ritual',
      'My scratch',
    ]);
  });

  it('does not mutate its input', () => {
    const input = [
      template({ id: 'z', name: 'Zed', scope: 'personal' }),
      template({ id: 'a', name: 'Aye', scope: 'organization' }),
    ];
    sortTemplates(input);
    expect(input.map((t) => t.id)).toEqual(['z', 'a']);
  });
});

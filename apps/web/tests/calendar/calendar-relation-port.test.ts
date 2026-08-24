import { describe, expect, it, vi } from 'vitest';

import { createCalendarRelationCommandPort } from '../../src/components/calendar/calendar-relation-port';

describe('Calendar relation command port', () => {
  it.each([
    ['calendar-item.related', 'related'],
    ['calendar-item.contained', 'contained'],
    ['calendar-item.follow-up', 'follow_up'],
  ] as const)('maps %s to the Calendar role %s', async (relationId, role) => {
    const relate = vi.fn(async () => 'applied' as const);
    const port = createCalendarRelationCommandPort({ relate });

    await expect(
      port.execute({
        relationId,
        effect: 'link',
        subjects: [{ kind: 'calendar_item', id: 'item-1', organizationId: null }],
        target: { kind: 'calendar_item', id: 'item-2', organizationId: null },
      }),
    ).resolves.toEqual({ status: 'applied' });
    expect(relate).toHaveBeenCalledWith('item-1', 'item-2', role);
  });

  it('returns unchanged for an existing edge', async () => {
    const port = createCalendarRelationCommandPort({
      relate: vi.fn(async () => 'unchanged' as const),
    });
    await expect(
      port.execute({
        relationId: 'calendar-item.related',
        effect: 'link',
        subjects: [{ kind: 'calendar_item', id: 'item-1', organizationId: null }],
        target: { kind: 'calendar_item', id: 'item-2', organizationId: null },
      }),
    ).resolves.toEqual({ status: 'unchanged' });
  });
});

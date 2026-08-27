import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRegisterCalendarActions } from '../../src/components/calendar/calendar-actions';
import { InteractionProvider } from '../../src/lib/actions/interaction-provider';
import { createActionRegistry } from '../../src/lib/actions/registry';

const { open, relationsPost } = vi.hoisted(() => ({
  open: vi.fn(),
  relationsPost: vi.fn(),
}));

vi.mock('../../src/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open }),
}));
vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      me: {
        calendar: {
          items: {
            ':id': { relations: { $post: relationsPost } },
          },
        },
      },
    },
  },
}));

const SOURCE_ID = '01BX5ZZKBKACTAV9WEVGEMMVS1';
const TARGET_ID = '01BX5ZZKBKACTAV9WEVGEMMVT1';

function Registration(): null {
  useRegisterCalendarActions();
  return null;
}

afterEach(() => {
  open.mockClear();
  relationsPost.mockReset();
});

describe('Calendar relation actions', () => {
  it.each([
    ['calendar.related', 'calendar-item.related'],
    ['calendar.contained', 'calendar-item.contained'],
    ['calendar.followUp', 'calendar-item.follow-up'],
  ] as const)('opens the shared target picker for %s', async (actionId, relationId) => {
    const registry = createActionRegistry();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const objects = [
      { kind: 'calendar_event' as const, id: 'item-1', organizationId: null, title: 'Review' },
    ];
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <Registration />
        </InteractionProvider>
      </QueryClientProvider>,
    );

    await registry.invoke(actionId, () => ({
      objects,
      source: 'command-palette',
      organizationId: null,
    }));

    expect(open).toHaveBeenCalledWith({
      kind: 'relation-target',
      relationId,
      organizationId: null,
      subjects: objects,
    });
  });

  it.each(['drag', 'shortcut'] as const)(
    'stores a %s into a time block as an outgoing contained edge from the block',
    async (source) => {
      relationsPost.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
      const registry = createActionRegistry();
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <InteractionProvider registry={registry}>
            <Registration />
          </InteractionProvider>
        </QueryClientProvider>,
      );

      await registry.invoke('calendar.related', () => ({
        objects: [
          {
            kind: 'calendar_event',
            id: SOURCE_ID,
            organizationId: null,
            title: 'Research review',
          },
        ],
        target: {
          kind: 'time_block',
          id: TARGET_ID,
          organizationId: null,
          title: 'Launch window',
        },
        source,
        organizationId: null,
      }));

      expect(relationsPost).toHaveBeenCalledWith({
        param: { id: TARGET_ID },
        json: { targetItemId: SOURCE_ID, role: 'contained' },
      });
    },
  );

  it('keeps a picker relation directed from the selected source item', async () => {
    relationsPost.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
    const registry = createActionRegistry();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <Registration />
        </InteractionProvider>
      </QueryClientProvider>,
    );

    await registry.invoke('calendar.contained', () => ({
      objects: [
        {
          kind: 'time_block',
          id: SOURCE_ID,
          organizationId: null,
          title: 'Launch window',
        },
      ],
      target: {
        kind: 'calendar_event',
        id: TARGET_ID,
        organizationId: null,
        title: 'Research review',
      },
      source: 'button',
      organizationId: null,
    }));

    expect(relationsPost).toHaveBeenCalledWith({
      param: { id: SOURCE_ID },
      json: { targetItemId: TARGET_ID, role: 'contained' },
    });
  });
});

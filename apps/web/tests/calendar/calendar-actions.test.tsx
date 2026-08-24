import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useRegisterCalendarActions } from '../../src/components/calendar/calendar-actions';
import { InteractionProvider } from '../../src/lib/actions/interaction-provider';
import { createActionRegistry } from '../../src/lib/actions/registry';

const open = vi.fn();
vi.mock('../../src/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open }),
}));

function Registration(): null {
  useRegisterCalendarActions();
  return null;
}

afterEach(() => {
  open.mockClear();
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
});

import '@testing-library/jest-dom/vitest';

import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InteractionProvider } from '@/lib/actions/interaction-provider';
import { createActionRegistry } from '@/lib/actions/registry';
import { useRegisterTaskActions } from '@/components/tasks/task-actions';
import { makeQueryWrapper } from '../../support/query';

afterEach(() => {
  vi.restoreAllMocks();
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const open = vi.fn();
vi.mock('@/components/pickers/picker-overlay', () => ({
  usePickerOverlay: () => ({ open }),
}));

/** The one component a domain mounts to publish its actions. */
function TaskActionRegistration(): null {
  useRegisterTaskActions();
  return null;
}

describe('task.label registration', () => {
  it('registers a multi-object, organize-section action with an L shortcut hint', () => {
    const registry = createActionRegistry();
    const { client } = makeQueryWrapper();
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <TaskActionRegistration />
        </InteractionProvider>
      </QueryClientProvider>,
    );
    expect(registry.snapshot().ids).toContain('task.label');
  });

  it('opens the picker overlay for the context objects on run', async () => {
    open.mockClear();
    const registry = createActionRegistry();
    const { client } = makeQueryWrapper();
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <TaskActionRegistration />
        </InteractionProvider>
      </QueryClientProvider>,
    );
    const context = {
      objects: [{ kind: 'task' as const, id: 't1', organizationId: 'org_1', title: 'Ship it' }],
      source: 'context-menu' as const,
      organizationId: 'org_1',
    };
    await registry.invoke('task.label', () => context);
    expect(open).toHaveBeenCalledWith({
      kind: 'labels',
      organizationId: 'org_1',
      objects: context.objects,
    });
  });

  it('does nothing when the context has no bound organization', async () => {
    open.mockClear();
    const registry = createActionRegistry();
    const { client } = makeQueryWrapper();
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <TaskActionRegistration />
        </InteractionProvider>
      </QueryClientProvider>,
    );
    const context = {
      objects: [{ kind: 'task' as const, id: 't1', organizationId: null, title: 'Ship it' }],
      source: 'context-menu' as const,
      organizationId: null,
    };
    await registry.invoke('task.label', () => context);
    expect(open).not.toHaveBeenCalled();
  });
});

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
      actionScope: 'all' as const,
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
      actionScope: 'all' as const,
      organizationId: null,
    };
    await registry.invoke('task.label', () => context);
    expect(open).not.toHaveBeenCalled();
  });
});

describe('task hierarchy action registration', () => {
  it('registers create, multi-object reparent, and top-level actions', () => {
    const registry = createActionRegistry();
    const { client } = makeQueryWrapper();
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <TaskActionRegistration />
        </InteractionProvider>
      </QueryClientProvider>,
    );

    expect(registry.get('task.addSubtask')?.label).toBe('Create subtask');
    expect(registry.get('task.makeSubtaskOf')?.multi).toBe(true);
    expect(registry.getByRelation('task.parent')?.id).toBe('task.makeSubtaskOf');
    expect(registry.get('task.moveToTopLevel')?.multi).toBe(true);
  });

  it('opens one parent picker for every selected task', async () => {
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
    const subjects = [
      { kind: 'task' as const, id: 't1', organizationId: 'org_1', title: 'One' },
      { kind: 'task' as const, id: 't2', organizationId: 'org_1', title: 'Two' },
    ];

    await registry.invoke('task.makeSubtaskOf', () => ({
      objects: subjects,
      source: 'context-menu',
      actionScope: 'all',
      organizationId: 'org_1',
    }));

    expect(open).toHaveBeenCalledWith({
      kind: 'task-hierarchy',
      organizationId: 'org_1',
      subjects,
    });
  });

  it('offers top-level movement only when at least one selected root is nested', () => {
    const registry = createActionRegistry();
    const { client } = makeQueryWrapper();
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <TaskActionRegistration />
        </InteractionProvider>
      </QueryClientProvider>,
    );
    const action = registry.get('task.moveToTopLevel');
    const base = {
      source: 'context-menu' as const,
      actionScope: 'all' as const,
      organizationId: 'org_1',
    };

    expect(
      action?.appliesTo?.({
        ...base,
        objects: [
          {
            kind: 'task',
            id: 'top',
            organizationId: 'org_1',
            title: 'Top',
            meta: { parentTaskId: null },
          },
        ],
      }),
    ).toBe(false);
    expect(
      action?.appliesTo?.({
        ...base,
        objects: [
          {
            kind: 'task',
            id: 'child',
            organizationId: 'org_1',
            title: 'Child',
            meta: { parentTaskId: 'parent' },
          },
        ],
      }),
    ).toBe(true);
  });
});

describe('task placement relation actions', () => {
  it('opens a keyboard-accessible relation target picker when no drop target is injected', async () => {
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
    const subjects = [{ kind: 'task' as const, id: 't1', organizationId: 'org_1', title: 'One' }];

    await registry.invoke('task.moveToProject', () => ({
      objects: subjects,
      source: 'context-menu',
      actionScope: 'all',
      organizationId: 'org_1',
    }));

    expect(open).toHaveBeenCalledWith({
      kind: 'relation-target',
      relationId: 'task.project',
      organizationId: 'org_1',
      subjects,
    });
  });
});

describe('task action responsiveness metadata', () => {
  it('keeps painted mutation owners separate from adapter-owned relation feedback', () => {
    const registry = createActionRegistry();
    const { client } = makeQueryWrapper();
    render(
      <QueryClientProvider client={client}>
        <InteractionProvider registry={registry}>
          <TaskActionRegistration />
        </InteractionProvider>
      </QueryClientProvider>,
    );

    expect(registry.get('task.toggleComplete')?.responsiveness).toMatchObject({
      ownership: 'root',
      interactionId: 'app.mutation',
      category: 'mutation',
      routeTemplateId: '/tasks/[taskId]',
    });
    expect(registry.get('task.addSubtask')?.responsiveness).toMatchObject({ ownership: 'root' });
    expect(registry.get('task.copyLink')?.responsiveness).toMatchObject({ ownership: 'root' });
    expect(registry.get('task.open')?.responsiveness).toBeUndefined();
    expect(registry.get('task.label')?.responsiveness).toMatchObject({ ownership: 'autonomous' });
    expect(registry.get('task.makeSubtaskOf')?.responsiveness).toMatchObject({
      ownership: 'autonomous',
    });
    expect(registry.get('task.moveToTopLevel')?.responsiveness).toBeUndefined();
    expect(registry.get('task.showInGraph')?.responsiveness).toBeUndefined();
  });
});

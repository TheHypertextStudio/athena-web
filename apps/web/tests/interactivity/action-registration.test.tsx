import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useCallback, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { InteractionProvider } from '../../src/lib/actions/interaction-provider';
import {
  type ActionRegistry,
  createActionRegistry,
  defineActionDomain,
} from '../../src/lib/actions/registry';
import {
  useActionDispatch,
  useRegisterActionDomain,
  useResolvedActions,
} from '../../src/lib/actions/registry-context';
import type { ActionContext } from '../../src/lib/actions/types';

import { taskRef } from './harness';

afterEach(() => {
  cleanup();
});

const invocations: ActionContext[] = [];

/**
 * A domain's action set as a module-level constant — the shape every registration module must
 * export, and the reason re-registration can be recognized as identical.
 */
const TASK_ACTIONS = defineActionDomain('task', [
  {
    id: 'task.complete',
    label: 'Complete',
    objectKinds: ['task'],
    multi: true,
    run: (context) => {
      invocations.push(context);
    },
  },
  {
    id: 'task.delete',
    label: 'Delete',
    objectKinds: ['task'],
    section: 'danger',
    destructive: true,
    run: (context) => {
      invocations.push(context);
    },
  },
]);

const PROJECT_ACTIONS = defineActionDomain('project', [
  { id: 'project.rename', label: 'Rename', objectKinds: ['project'], run: () => undefined },
]);

/** The one component a domain mounts to publish its actions. */
function TaskActionRegistration(): null {
  useRegisterActionDomain('task', TASK_ACTIONS);
  return null;
}

/** A second domain, mounted and unmounted to simulate navigating between surfaces. */
function ProjectActionRegistration(): null {
  useRegisterActionDomain('project', PROJECT_ACTIONS);
  return null;
}

describe('action registration is idempotent', () => {
  it('holds the same actions after strict-mode double invocation', () => {
    const registry = createActionRegistry();
    render(
      <StrictMode>
        <InteractionProvider registry={registry}>
          <TaskActionRegistration />
        </InteractionProvider>
      </StrictMode>,
    );
    // Strict mode runs mount → cleanup → mount. A registry that appended rather than replaced
    // would show four actions here, and a menu would show every item twice.
    expect(registry.snapshot()).toEqual({
      count: 2,
      ids: ['task.complete', 'task.delete'],
      domains: ['task'],
    });
  });

  it('is byte-identical after navigating away and back', () => {
    const registry = createActionRegistry();
    const { rerender } = render(
      <InteractionProvider registry={registry}>
        <TaskActionRegistration />
        <ProjectActionRegistration />
      </InteractionProvider>,
    );
    const atBoot = registry.snapshot();
    expect(atBoot.count).toBe(3);

    // Navigate to a surface that does not mount the project domain…
    rerender(
      <InteractionProvider registry={registry}>
        <TaskActionRegistration />
      </InteractionProvider>,
    );
    expect(registry.snapshot().domains).toEqual(['task']);

    // …and back.
    rerender(
      <InteractionProvider registry={registry}>
        <TaskActionRegistration />
        <ProjectActionRegistration />
      </InteractionProvider>,
    );
    expect(registry.snapshot()).toEqual(atBoot);
  });

  it('survives two surfaces holding the same domain at once', () => {
    // One unmounting must not pull the registration out from under the other.
    const registry = createActionRegistry();
    const { rerender } = render(
      <InteractionProvider registry={registry}>
        <TaskActionRegistration />
        <TaskActionRegistration />
      </InteractionProvider>,
    );
    expect(registry.snapshot().count).toBe(2);

    rerender(
      <InteractionProvider registry={registry}>
        <TaskActionRegistration />
      </InteractionProvider>,
    );
    expect(registry.snapshot().count).toBe(2);
  });
});

/** A button that dispatches through the universal handler with a call-site context. */
function CompleteButton({
  registry: _registry,
}: {
  readonly registry: ActionRegistry;
}): JSX.Element {
  const dispatch = useActionDispatch();
  const task = taskRef('9');
  return (
    <button
      type="button"
      onClick={() => {
        void dispatch('task.complete', () => ({
          objects: [task],
          source: 'button',
          organizationId: 'org1',
        }));
      }}
    >
      Complete
    </button>
  );
}

/** A palette-like list rendered from whatever the registry says applies. */
function PaletteList(): JSX.Element {
  const task = taskRef('9');
  const resolveContext = useCallback(
    (): ActionContext => ({
      objects: [task],
      source: 'command-palette',
      organizationId: 'org1',
    }),
    [task],
  );
  const actions = useResolvedActions(resolveContext);
  return (
    <ul>
      {actions.map((action) => (
        <li key={action.id}>
          <button
            type="button"
            onClick={() => {
              void action.invoke();
            }}
          >
            {action.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

describe('one definition, many entry points', () => {
  it('a button and a palette row run the same registered action', async () => {
    invocations.length = 0;
    const registry = createActionRegistry();
    render(
      <InteractionProvider registry={registry}>
        <TaskActionRegistration />
        <CompleteButton registry={registry} />
        <PaletteList />
      </InteractionProvider>,
    );

    // The palette lists whatever applies; it holds no copy of the action, so both entry points
    // read "Complete" and both reach the one definition.
    const completeButtons = screen.getAllByRole('button', { name: 'Complete' });
    expect(completeButtons).toHaveLength(2);

    fireEvent.click(completeButtons[0]!);
    await waitFor(() => {
      expect(invocations).toHaveLength(1);
    });
    expect(invocations[0]?.source).toBe('button');

    fireEvent.click(completeButtons[1]!);
    await waitFor(() => {
      expect(invocations).toHaveLength(2);
    });
    expect(invocations[1]?.source).toBe('command-palette');
  });

  it('a late domain registration appears in an already-rendered list', async () => {
    const registry = createActionRegistry();
    const { rerender } = render(
      <InteractionProvider registry={registry}>
        <PaletteList />
      </InteractionProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Complete' })).not.toBeInTheDocument();

    rerender(
      <InteractionProvider registry={registry}>
        <TaskActionRegistration />
        <PaletteList />
      </InteractionProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Complete' })).toBeInTheDocument();
    });
  });
});

import '@testing-library/jest-dom/vitest';

import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { objectTargetProps, type ObjectRef } from '../../src/lib/actions/object';
import { InteractionProvider } from '../../src/lib/actions/interaction-provider';
import {
  type ActionRegistry,
  createActionRegistry,
  defineActionDomain,
} from '../../src/lib/actions/registry';
import type { ActionContext } from '../../src/lib/actions/types';
import { SelectionProvider } from '../../src/components/selection/selection-context';
import { useObjectContextMenu } from '../../src/components/context-menu/object-context-menu';

import { TaskList, taskRef } from './harness';

afterEach(() => {
  cleanup();
});

const project: ObjectRef = {
  kind: 'project',
  id: 'p1',
  organizationId: 'org1',
  title: 'Launch',
};

/** Dispatch a real, cancelable `contextmenu` event and report whether the app claimed it. */
function rightClick(element: Element, point = { clientX: 120, clientY: 80 }): MouseEvent {
  const event = createEvent.contextMenu(element, { ...point, bubbles: true, cancelable: true });
  fireEvent(element, event);
  return event as MouseEvent;
}

/** A registry with distinct task and project actions, plus one that is disabled with a reason. */
function menuRegistry(seen: ActionContext[]): ActionRegistry {
  const registry = createActionRegistry();
  registry.register(
    'task',
    defineActionDomain('task', [
      {
        id: 'task.complete',
        label: (context) =>
          context.objects.length > 1 ? `Complete ${context.objects.length} tasks` : 'Complete task',
        objectKinds: ['task'],
        multi: true,
        run: (context) => {
          seen.push(context);
        },
      },
      {
        id: 'task.archive',
        label: 'Archive task',
        objectKinds: ['task'],
        section: 'danger',
        destructive: true,
        disabledReason: () => 'Complete the task before archiving it.',
        run: () => undefined,
      },
    ]),
  );
  registry.register(
    'project',
    defineActionDomain('project', [
      {
        id: 'project.rename',
        label: 'Rename project',
        objectKinds: ['project'],
        run: (context) => {
          seen.push(context);
        },
      },
    ]),
  );
  return registry;
}

/** A registry that makes the reference boundary visible in one menu. */
function referenceRegistry(): ActionRegistry {
  const registry = createActionRegistry();
  registry.register(
    'task',
    defineActionDomain('task', [
      { id: 'task.open', label: 'Open task', objectKinds: ['task'], run: () => undefined },
      {
        id: 'task.copy',
        label: (context) => `Copy ${context.objects.length} tasks`,
        objectKinds: ['task'],
        multi: true,
        run: () => undefined,
      },
      {
        id: 'task.move',
        label: 'Move tasks',
        objectKinds: ['task'],
        multi: true,
        run: () => undefined,
      },
    ]),
  );
  return registry;
}

/** Open the shared menu from a button inside a stamped reference host. */
function ReferenceMenuButton(): JSX.Element {
  const menu = useObjectContextMenu();
  return (
    <div {...objectTargetProps(taskRef('9'), 'reference')}>
      <button
        type="button"
        onClick={(event) => {
          menu?.openFor(event.currentTarget);
        }}
      >
        More task actions
      </button>
    </div>
  );
}

/** Try the programmatic API without an object host. */
function OutsideMenuButton(): JSX.Element {
  const menu = useObjectContextMenu();
  return (
    <button
      type="button"
      onClick={(event) => {
        menu?.openFor(event.currentTarget);
      }}
    >
      Outside actions
    </button>
  );
}

/** A page with a task list, a bare project row, and a text field. */
function Page({ registry }: { readonly registry: ActionRegistry }): JSX.Element {
  const items = [taskRef('1'), taskRef('2'), taskRef('3')];
  return (
    <InteractionProvider registry={registry}>
      <SelectionProvider items={items} surfaceId="tasks" organizationId="org1" actionScope="all">
        <TaskList items={items} />
      </SelectionProvider>
      <div data-testid="project-row" {...objectTargetProps(project)}>
        {project.title}
      </div>
      <input data-testid="note" aria-label="Note" defaultValue="type here" />
      <p data-testid="prose">Just some text</p>
    </InteractionProvider>
  );
}

describe('object context menu: claiming the right-click', () => {
  it('replaces the browser menu on an object and anchors an app menu', async () => {
    render(<Page registry={menuRegistry([])} />);
    const event = rightClick(screen.getByTestId('row-1'));
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });
    expect(screen.getByRole('menuitem', { name: /Complete task/ })).toBeInTheDocument();
  });

  it('leaves the browser menu alone inside a text field', () => {
    // Spellcheck, paste, and "look up" are worth more than app actions where text is being edited.
    render(<Page registry={menuRegistry([])} />);
    const event = rightClick(screen.getByTestId('note'));
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('leaves the browser menu alone where no object was clicked', () => {
    render(<Page registry={menuRegistry([])} />);
    const event = rightClick(screen.getByTestId('prose'));
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('leaves the browser menu alone when the object has no applicable actions', () => {
    // An empty app menu reads as broken; the native one is strictly better than nothing.
    const registry = createActionRegistry();
    registry.register(
      'project',
      defineActionDomain('project', [
        {
          id: 'project.rename',
          label: 'Rename',
          objectKinds: ['project'],
          run: () => undefined,
        },
      ]),
    );
    render(<Page registry={registry} />);
    const event = rightClick(screen.getByTestId('row-1'));
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('object context menu: contents come from the object', () => {
  it('derives the same reference action set for programmatic openFor', async () => {
    render(
      <InteractionProvider registry={referenceRegistry()}>
        <ReferenceMenuButton />
      </InteractionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'More task actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Open task' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Copy 1 tasks' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Move tasks' })).toBeNull();
  });

  it('rechecks a row action scope when an already-open menu invokes a write', async () => {
    const move = vi.fn();
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        { id: 'task.open', label: 'Open task', objectKinds: ['task'], run: () => undefined },
        { id: 'task.copy', label: 'Copy task', objectKinds: ['task'], run: () => undefined },
        { id: 'task.move', label: 'Move task', objectKinds: ['task'], run: move },
      ]),
    );
    render(
      <InteractionProvider registry={registry}>
        <div data-testid="changing-scope-row" {...objectTargetProps(taskRef('scope'))}>
          Scoped task
        </div>
      </InteractionProvider>,
    );

    const row = screen.getByTestId('changing-scope-row');
    rightClick(row);
    const moveItem = await screen.findByRole('menuitem', { name: 'Move task' });
    row.setAttribute('data-object-action-scope', 'reference');
    fireEvent.click(moveItem);

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    expect(move).not.toHaveBeenCalled();
  });

  it('refuses a write when virtualization recycles the open menu host for another object', async () => {
    const move = vi.fn();
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        { id: 'task.open', label: 'Open task', objectKinds: ['task'], run: () => undefined },
        { id: 'task.copy', label: 'Copy task', objectKinds: ['task'], run: () => undefined },
        { id: 'task.move', label: 'Move task', objectKinds: ['task'], run: move },
      ]),
    );
    render(
      <InteractionProvider registry={registry}>
        <div data-testid="recycled-row" {...objectTargetProps(taskRef('before'))}>
          Original task
        </div>
      </InteractionProvider>,
    );

    const row = screen.getByTestId('recycled-row');
    rightClick(row);
    const moveItem = await screen.findByRole('menuitem', { name: 'Move task' });
    row.setAttribute('data-object-id', 'after');
    row.setAttribute('data-object-title', 'Replacement task');
    fireEvent.click(moveItem);

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    expect(move).not.toHaveBeenCalled();
  });

  it('refuses programmatic openFor outside a stamped object surface', () => {
    render(
      <InteractionProvider registry={referenceRegistry()}>
        <OutsideMenuButton />
      </InteractionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Outside actions' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('inherits a reference selection and offers multi-Copy without Open or writes', async () => {
    const items = [taskRef('1'), taskRef('2')];
    render(
      <InteractionProvider registry={referenceRegistry()}>
        <SelectionProvider
          items={items}
          surfaceId="reference-tasks"
          organizationId="org1"
          actionScope="reference"
        >
          <TaskList items={items} />
        </SelectionProvider>
      </InteractionProvider>,
    );
    fireEvent.click(screen.getByTestId('row-1'));
    fireEvent.click(screen.getByTestId('row-2'), { metaKey: true });

    expect(rightClick(screen.getByTestId('row-1')).defaultPrevented).toBe(true);
    expect(await screen.findByRole('menuitem', { name: 'Copy 2 tasks' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Open task' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Move tasks' })).toBeNull();
  });

  it('offers different items for a task and for a project', async () => {
    render(<Page registry={menuRegistry([])} />);

    rightClick(screen.getByTestId('row-1'));
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Complete task/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('menuitem', { name: /Rename project/ })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    rightClick(screen.getByTestId('project-row'));
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Rename project/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('menuitem', { name: /Complete task/ })).not.toBeInTheDocument();
  });

  it('carries the exact record that was right-clicked into the action', async () => {
    const seen: ActionContext[] = [];
    render(<Page registry={menuRegistry(seen)} />);
    rightClick(screen.getByTestId('row-3'));
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Complete task/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('menuitem', { name: /Complete task/ }));
    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(seen[0]?.objects.map((object) => object.id)).toEqual(['3']);
    expect(seen[0]?.source).toBe('context-menu');
    expect(seen[0]?.surfaceId).toBe('tasks');
  });

  it('finishes closing before invoking an action that may open another overlay', async () => {
    let invoked = false;
    let menuAtInvocation: HTMLElement | null = null;
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.openPicker',
          label: 'Open picker',
          objectKinds: ['task'],
          run: () => {
            invoked = true;
            menuAtInvocation = screen.queryByRole('menu');
          },
        },
      ]),
    );
    render(<Page registry={registry} />);

    rightClick(screen.getByTestId('row-1'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open picker' }));
    expect(invoked).toBe(false);

    await waitFor(() => {
      expect(invoked).toBe(true);
    });
    expect(menuAtInvocation).not.toBeInTheDocument();
  });

  it('acts on the whole selection when the right-clicked row is part of one', async () => {
    // Otherwise multi-select is a lie the moment a menu opens.
    const seen: ActionContext[] = [];
    render(<Page registry={menuRegistry(seen)} />);
    fireEvent.click(screen.getByTestId('row-1'));
    fireEvent.click(screen.getByTestId('row-3'), { shiftKey: true });

    rightClick(screen.getByTestId('row-2'));
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Complete 3 tasks/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('menuitem', { name: /Complete 3 tasks/ }));
    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(seen[0]?.objects.map((object) => object.id)).toEqual(['1', '2', '3']);
  });

  it('acts on the single row when the right-click lands outside the selection', async () => {
    const seen: ActionContext[] = [];
    render(<Page registry={menuRegistry(seen)} />);
    fireEvent.click(screen.getByTestId('row-1'));

    rightClick(screen.getByTestId('row-3'));
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Complete task/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('menuitem', { name: /Complete task/ }));
    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    expect(seen[0]?.objects.map((object) => object.id)).toEqual(['3']);
  });

  it('states why a disabled item is unavailable instead of sitting there inert', async () => {
    render(<Page registry={menuRegistry([])} />);
    rightClick(screen.getByTestId('row-1'));
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /Archive task/ })).toBeInTheDocument();
    });
    const archive = screen.getByRole('menuitem', { name: /Archive task/ });
    expect(archive).toHaveAttribute('data-disabled');
    expect(archive).toHaveTextContent('Complete the task before archiving it.');
  });
});

describe('object context menu: keyboard and focus', () => {
  it('closes on Escape and returns focus to the object it opened from', async () => {
    render(<Page registry={menuRegistry([])} />);
    const row = screen.getByTestId('row-2');
    row.focus();
    rightClick(row);
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    // Focus landing on <body> is how a menu strands a keyboard user mid-list.
    expect(document.activeElement).toBe(row);
  });

  it('opens from the keyboard, anchoring to the focused object rather than the origin', async () => {
    // Shift+F10 and the Menu key raise `contextmenu` with no useful coordinates.
    render(<Page registry={menuRegistry([])} />);
    const row = screen.getByTestId('row-2');
    row.focus();
    const event = rightClick(row, { clientX: 0, clientY: 0 });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });
  });
});

describe('object context menu: exactly one handler', () => {
  it('installs a single document listener however many surfaces are mounted', () => {
    const add = vi.spyOn(document, 'addEventListener');
    render(<Page registry={menuRegistry([])} />);
    const contextMenuListeners = add.mock.calls.filter(([type]) => type === 'contextmenu');
    expect(contextMenuListeners).toHaveLength(1);
    add.mockRestore();
  });
});

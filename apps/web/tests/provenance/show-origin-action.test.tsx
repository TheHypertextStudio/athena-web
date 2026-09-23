/**
 * Show origin: offered for one task, project, or initiative from the right-click menu and the
 * command palette, and never for a multi-object selection.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PageCommandsProvider,
  usePageCommandMatches,
} from '../../src/components/command-palette/page-commands';
import type { PaletteOpening } from '../../src/components/command-palette/subject-commands';
import { objectReferenceActions } from '../../src/components/actions/object-reference-actions';
import { isObjectPage, showOriginAction } from '../../src/components/provenance/show-origin-action';
import { SelectionProvider } from '../../src/components/selection/selection-context';
import { InteractionProvider } from '../../src/lib/actions/interaction-provider';
import {
  OBJECT_PAGE_ATTRIBUTE,
  objectHref,
  objectTargetProps,
  type ObjectRef,
} from '../../src/lib/actions/object';
import {
  type ActionRegistry,
  createActionRegistry,
  defineActionDomain,
} from '../../src/lib/actions/registry';
import { clearOriginRequest, readOriginRequest } from '../../src/lib/provenance/origin-request';
import { TaskList, taskRef } from '../interactivity/harness';

const push = vi.fn();
const NAVIGATOR = { push };
const SHOW_ORIGIN_LABEL = showOriginAction('task', NAVIGATOR).label;

const project: ObjectRef = { kind: 'project', id: 'p1', organizationId: 'org1', title: 'Launch' };

/**
 * A registry holding the real task and project reference actions, and one multi-object task
 * action so a multi-selection still opens a menu.
 */
function registry(): ActionRegistry {
  const actions = createActionRegistry();
  const [copy, showOrigin] = objectReferenceActions('task', () => undefined, NAVIGATOR);
  actions.register(
    'task',
    defineActionDomain('task', [
      copy,
      showOrigin,
      {
        id: 'task.complete',
        label: 'Complete',
        objectKinds: ['task'],
        multi: true,
        run: () => undefined,
      },
    ]),
  );
  actions.register(
    'project',
    defineActionDomain('project', [showOriginAction('project', NAVIGATOR)]),
  );
  return actions;
}

function rightClick(element: Element): void {
  fireEvent(
    element,
    createEvent.contextMenu(element, { clientX: 40, clientY: 40, bubbles: true, cancelable: true }),
  );
}

/** Props for {@link TaskPage}. */
interface TaskPageProps {
  readonly actions: ActionRegistry;
}

/** A list of three tasks, the surface the menu and the palette read the selection from. */
function TaskPage({ actions }: TaskPageProps): JSX.Element {
  const items = [taskRef('1'), taskRef('2'), taskRef('3')];
  return (
    <InteractionProvider registry={actions}>
      <SelectionProvider items={items} surfaceId="tasks" organizationId="org1" actionScope="all">
        <TaskList items={items} />
      </SelectionProvider>
    </InteractionProvider>
  );
}

beforeEach(() => {
  push.mockReset();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  clearOriginRequest();
});

describe('Show origin in the right-click menu', () => {
  it('is offered for one task and opens its page', async () => {
    render(<TaskPage actions={registry()} />);

    rightClick(screen.getByTestId('row-1'));
    fireEvent.click(await screen.findByRole('menuitem', { name: SHOW_ORIGIN_LABEL }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(objectHref(taskRef('1')));
    });
    expect(readOriginRequest()).toMatchObject({ kind: 'task', id: '1' });
  });

  it('is not offered for a multi-object selection', async () => {
    render(<TaskPage actions={registry()} />);
    fireEvent.click(screen.getByTestId('row-1'));
    fireEvent.click(screen.getByTestId('row-2'), { metaKey: true });

    rightClick(screen.getByTestId('row-1'));

    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: SHOW_ORIGIN_LABEL })).not.toBeInTheDocument();
  });
});

/** The ids of the palette's page-section commands, for the latest opening. */
function PaletteProbe(): JSX.Element {
  const { label, items } = usePageCommandMatches('', true);
  return (
    <section aria-label="Palette page commands" data-heading={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          data-command-id={item.id}
          onClick={() => {
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </section>
  );
}

/** Props for {@link PaletteHarness}. */
interface PaletteHarnessProps {
  readonly actions: ActionRegistry;
  /** The element that holds focus when the palette opens. */
  readonly opener: () => Element | null;
}

/** A task list plus the palette's page commands, opened from `opener`. */
function PaletteHarness({ actions, opener }: PaletteHarnessProps): JSX.Element {
  const [opening, setOpening] = useState<PaletteOpening | null>(null);
  return (
    <InteractionProvider registry={actions}>
      <PageCommandsProvider opening={opening}>
        <TaskPage actions={actions} />
        <button
          type="button"
          onClick={() => {
            setOpening({ element: opener() });
          }}
        >
          Open palette
        </button>
        <PaletteProbe />
      </PageCommandsProvider>
    </InteractionProvider>
  );
}

function paletteCommandIds(): readonly (string | null)[] {
  const section = screen.getByRole('region', { name: 'Palette page commands' });
  return [...section.querySelectorAll('[data-command-id]')].map((node) =>
    node.getAttribute('data-command-id'),
  );
}

describe('Show origin in the command palette', () => {
  it('is offered for the one selected task', () => {
    const actions = registry();
    render(<PaletteHarness actions={actions} opener={() => screen.getByTestId('row-1')} />);
    fireEvent.click(screen.getByTestId('row-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Open palette' }));

    expect(paletteCommandIds()).toContain('subject:task.showOrigin');
    expect(screen.getByRole('region', { name: 'Palette page commands' }).dataset['heading']).toBe(
      taskRef('1').title,
    );
  });

  it('is not offered for a multi-object selection', () => {
    const actions = registry();
    render(<PaletteHarness actions={actions} opener={() => screen.getByTestId('row-1')} />);
    fireEvent.click(screen.getByTestId('row-1'));
    fireEvent.click(screen.getByTestId('row-2'), { metaKey: true });

    fireEvent.click(screen.getByRole('button', { name: 'Open palette' }));

    expect(paletteCommandIds()).not.toContain('subject:task.showOrigin');
  });

  it('is offered for the object whose page is open, without navigating', async () => {
    const actions = registry();
    window.history.replaceState({}, '', objectHref(project));
    render(
      <>
        <header {...objectTargetProps(project)} {...{ [OBJECT_PAGE_ATTRIBUTE]: '' }} />
        <PaletteHarness actions={actions} opener={() => document.body} />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open palette' }));
    const command = screen
      .getByRole('region', { name: 'Palette page commands' })
      .querySelector('[data-command-id="subject:project.showOrigin"]');
    expect(command).not.toBeNull();
    if (command) fireEvent.click(command);

    await waitFor(() => {
      expect(readOriginRequest()).toMatchObject({ kind: 'project', id: 'p1' });
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('offers nothing before the palette has opened', () => {
    render(<PaletteHarness actions={registry()} opener={() => null} />);

    expect(paletteCommandIds()).toEqual([]);
  });
});

describe('isObjectPage', () => {
  it('matches the page and its tabs, not a sibling id', () => {
    expect(isObjectPage('/orgs/o/tasks/t1', '/orgs/o/tasks/t1')).toBe(true);
    expect(isObjectPage('/orgs/o/tasks/t1', '/orgs/o/tasks/t1/activity')).toBe(true);
    expect(isObjectPage('/orgs/o/tasks/t1', '/orgs/o/tasks/t10')).toBe(false);
  });
});

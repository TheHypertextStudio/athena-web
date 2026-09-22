/**
 * Behavior tests for {@link ObjectMoreButton}, the visible route into an object's action menu for
 * pointers that cannot right-click.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ObjectMoreButton } from '../../../src/components/context-menu';
import { InteractionProvider } from '../../../src/lib/actions/interaction-provider';
import { objectTargetProps, type ObjectRef } from '../../../src/lib/actions/object';
import { createActionRegistry, defineActionDomain } from '../../../src/lib/actions/registry';

afterEach(cleanup);

const task: ObjectRef = { kind: 'task', id: 't1', organizationId: 'org1', title: 'Draft the kit' };

/** A registry with one task action. */
function registry(run: () => void) {
  const actions = createActionRegistry();
  actions.register(
    'task',
    defineActionDomain('task', [
      { id: 'task.complete', label: 'Complete task', objectKinds: ['task'], run },
    ]),
  );
  return actions;
}

describe('ObjectMoreButton', () => {
  it("opens the row's object menu without activating the row", async () => {
    const run = vi.fn();
    const onRowClick = vi.fn();
    render(
      <InteractionProvider registry={registry(run)}>
        <div {...objectTargetProps(task)} onClick={onRowClick}>
          <ObjectMoreButton title={task.title} />
        </div>
      </InteractionProvider>,
    );

    const button = screen.getByRole('button', { name: new RegExp(task.title) });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(button);

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Complete task' }));
    await waitFor(() => {
      expect(run).toHaveBeenCalledOnce();
    });
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('renders nothing outside the object menu provider', () => {
    render(
      <div {...objectTargetProps(task)}>
        <ObjectMoreButton title={task.title} />
      </div>,
    );

    expect(screen.queryByRole('button')).toBeNull();
  });
});

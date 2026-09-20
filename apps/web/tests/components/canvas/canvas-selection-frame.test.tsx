import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';

import CanvasSelectionFrame from '../../../src/components/canvas/canvas-selection-frame';
import { SelectionProvider, useSelectableRow } from '../../../src/components/selection';
import type { ObjectRef } from '../../../src/lib/actions';

const items: readonly ObjectRef[] = [
  { kind: 'task', id: 'task-a', title: 'Task A', organizationId: 'org-1' },
  { kind: 'task', id: 'task-b', title: 'Task B', organizationId: 'org-1' },
];

function Row({ object }: { object: ObjectRef }): React.JSX.Element {
  const { rowProps } = useSelectableRow(object);
  return (
    <div role="treeitem" {...rowProps}>
      {object.title}
    </div>
  );
}

describe('CanvasSelectionFrame', () => {
  it('has no serious or critical automated semantic violations', async () => {
    const { container } = render(
      <SelectionProvider
        items={items}
        surfaceId="task-canvas"
        organizationId="org-1"
        actionScope="all"
      >
        <CanvasSelectionFrame label="Task graph">
          {items.map((item) => (
            <Row key={item.id} object={item} />
          ))}
        </CanvasSelectionFrame>
      </SelectionProvider>,
    );

    const results = await axe.run(container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(
      results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'),
    ).toEqual([]);
  });

  it('shows focus on the graph boundary and gives nested controls coarse-pointer room', () => {
    render(
      <SelectionProvider items={[]} surfaceId="task-canvas" actionScope="all">
        <CanvasSelectionFrame label="Task graph">
          <button type="button">Canvas action</button>
        </CanvasSelectionFrame>
      </SelectionProvider>,
    );

    expect(screen.getByRole('tree', { name: 'Task graph' })).toHaveClass(
      'focus-visible:ring-2',
      'focus-visible:ring-inset',
      '[@media(pointer:coarse)]:[&_button]:min-h-10',
      '[@media(pointer:coarse)]:[&_button]:min-w-10',
    );
  });

  it('registers the tree container so roving focus follows keyboard selection', () => {
    render(
      <SelectionProvider
        items={items}
        surfaceId="task-canvas"
        organizationId="org-1"
        actionScope="all"
      >
        <CanvasSelectionFrame label="Task graph">
          {items.map((item) => (
            <Row key={item.id} object={item} />
          ))}
        </CanvasSelectionFrame>
      </SelectionProvider>,
    );
    const first = screen.getByRole('treeitem', { name: 'Task A' });
    const second = screen.getByRole('treeitem', { name: 'Task B' });
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    fireEvent.keyDown(first, { key: 'ArrowDown' });

    expect(document.activeElement).toBe(second);
  });
});

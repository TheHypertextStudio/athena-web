import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
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
  it('registers the tree container so roving focus follows keyboard selection', () => {
    render(
      <SelectionProvider items={items} surfaceId="task-canvas" organizationId="org-1">
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

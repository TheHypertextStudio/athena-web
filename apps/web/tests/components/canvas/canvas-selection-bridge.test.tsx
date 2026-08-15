/** `@docket/web` — xyflow-to-object selection bridge tests. */
import { act, render, waitFor } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

import CanvasSelectionBridge from '@/components/canvas/canvas-selection-bridge';
import { SelectionProvider, readSelectionSurface } from '@/components/selection';
import type { ObjectRef } from '@/lib/actions';

let notifySelection: ((change: { nodes: Node[] }) => void) | null = null;

vi.mock('@xyflow/react', () => ({
  useOnSelectionChange: ({ onChange }: { onChange: (change: { nodes: Node[] }) => void }) => {
    notifySelection = onChange;
  },
  useReactFlow: () => ({ setNodes: vi.fn() }),
}));

const items: ObjectRef[] = [
  { kind: 'task', id: 'task-a', title: 'Task A', organizationId: 'org-1' },
  { kind: 'task', id: 'task-b', title: 'Task B', organizationId: 'org-1' },
];

describe('CanvasSelectionBridge', () => {
  it('registers the complete selected task set for global actions', async () => {
    render(
      <SelectionProvider items={items} surfaceId="task-graph" organizationId="org-1">
        <CanvasSelectionBridge />
      </SelectionProvider>,
    );

    act(() => {
      notifySelection?.({
        nodes: [
          { id: 'task-a', type: 'taskBranch', position: { x: 0, y: 0 }, data: {} },
          { id: 'task-b', type: 'taskBranch', position: { x: 0, y: 0 }, data: {} },
        ],
      });
    });

    await waitFor(() => {
      expect(readSelectionSurface('task-graph')?.selectedObjects.map(({ id }) => id)).toEqual([
        'task-a',
        'task-b',
      ]);
    });
  });
});

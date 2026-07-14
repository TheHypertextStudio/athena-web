'use client';

/**
 * `components/canvas/bulk-actions-bar` — batch actions over a multi-selection.
 *
 * @remarks
 * Rendered inside the flow (under `ReactFlowProvider`) so it can read xyflow's own selection via
 * `useOnSelectionChange` — no selection state is threaded through the host. Shift-drag (xyflow's
 * default box-select) or shift-click selects several task nodes; when two or more are selected and
 * the viewer may edit, a small bar offers a bulk state toggle. Actions come from the shared
 * {@link useCanvasActions} context, so the bar stays host-agnostic.
 */
import { type Node, Panel, useOnSelectionChange } from '@xyflow/react';
import { Button } from '@docket/ui/primitives';
import { useCallback, useState } from 'react';

import { stateTypeOf } from '@/lib/work-state';

import { useCanvasActions } from './canvas-actions-context';
import { taskData } from './task-node';

/** The floating bulk-actions bar (renders nothing unless a multi-selection is editable). */
export default function BulkActionsBar(): React.JSX.Element | null {
  const [selected, setSelected] = useState<Node[]>([]);
  useOnSelectionChange({
    onChange: useCallback(({ nodes }: { nodes: Node[] }) => {
      setSelected(nodes.filter((n) => n.type === 'task'));
    }, []),
  });
  const actions = useCanvasActions();

  if (selected.length < 2 || !actions?.canEdit) return null;

  const allDone = selected.every((n) => stateTypeOf(taskData(n).state) === 'completed');
  const applyState = (state: string): void => {
    for (const n of selected) actions.setState(n.id, state);
  };

  return (
    <Panel position="top-center">
      <div className="border-outline-variant bg-surface-container text-on-surface flex items-center gap-3 rounded-lg border px-3 py-1.5 shadow-lg">
        <span className="text-body-medium">{selected.length} selected</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            applyState(allDone ? 'todo' : 'done');
          }}
        >
          {allDone ? 'Reopen all' : 'Mark all done'}
        </Button>
      </div>
    </Panel>
  );
}

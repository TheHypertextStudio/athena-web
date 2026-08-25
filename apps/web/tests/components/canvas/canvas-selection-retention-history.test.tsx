import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ObjectCommandIn, ObjectCommandResult } from '@docket/types';

import type { CanvasPropertySnapshot, ObjectRef } from '@/lib/actions';

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn() }));

vi.mock('@/lib/query', () => ({
  apiQueryOptions: vi.fn(() => ({})),
  unwrap: vi.fn(),
  useApiMutation: () => ({ mutateAsync, isPending: false }),
  useApiQuery: () => ({ data: undefined, isFetching: false, refetch: vi.fn() }),
}));

import {
  CanvasSelectionRetentionProvider,
  useCanvasPropertySnapshots,
} from '@/components/canvas/canvas-selection-retention';
import { useCanvasCommandHistory } from '@/components/canvas/use-canvas-command-history';
import { useSelection } from '@/components/selection';
import { objectKey } from '@/lib/actions';

const taskRef: ObjectRef = {
  kind: 'task',
  id: 'task-1',
  title: 'Move me',
  organizationId: 'org-1',
};

const taskSnapshot: Extract<CanvasPropertySnapshot, { kind: 'task' }> = {
  kind: 'task',
  id: 'task-1',
  organizationId: 'org-1',
  state: 'backlog',
  priority: 'none',
  assigneeId: null,
  projectId: 'project-before',
  programId: null,
  milestoneId: null,
  cycleId: null,
  labelIds: [],
  teamId: 'team-1',
  startDate: null,
  dueDate: null,
  estimate: null,
};

function HistoryControls(): React.JSX.Element {
  const selection = useSelection();
  const snapshots = useCanvasPropertySnapshots();
  const history = useCanvasCommandHistory('org-1', 'tasks:project-before', []);
  const selectedSnapshot = snapshots.find(({ id }) => id === 'task-1');
  const selectedProjectId = selectedSnapshot?.kind === 'task' ? selectedSnapshot.projectId : null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          selection.dispatch({ type: 'replace', key: objectKey(taskRef) });
        }}
      >
        Select Task
      </button>
      <button
        type="button"
        onClick={() => {
          void history.execute(
            {
              commandId: 'move-task',
              objectKind: 'task',
              objectIds: ['task-1'],
              operation: {
                type: 'replace_property',
                property: 'projectId',
                value: 'project-after',
              },
            } as ObjectCommandIn,
            {
              historyLabel: 'Change Project',
              title: 'Project changed',
              detail: 'Task is now set to Project after',
              unchangedTitle: 'Project unchanged',
              unchangedDetail: 'Task is already set to Project after',
            },
          );
        }}
      >
        Move Task
      </button>
      <output aria-label="Retained Project">{selectedProjectId}</output>
    </>
  );
}

function Harness({ visible }: { readonly visible: boolean }): React.JSX.Element {
  return (
    <CanvasSelectionRetentionProvider
      scopeKey="tasks:project-before"
      items={visible ? [taskRef] : []}
      propertySnapshots={visible ? [taskSnapshot] : []}
      surfaceId="task-canvas"
      organizationId="org-1"
    >
      <HistoryControls />
    </CanvasSelectionRetentionProvider>
  );
}

describe('canvas command retained snapshots', () => {
  it('applies a successful hidden-object receipt before the next dependent edit', async () => {
    const result: ObjectCommandResult = {
      appliedIds: ['task-1'],
      conflictingIds: [],
      deniedIds: [],
      receipt: {
        commandId: 'move-task',
        objectKind: 'task',
        action: 'replace_property',
        entries: [
          {
            kind: 'object',
            objectId: 'task-1',
            property: 'projectId',
            before: 'project-before',
            after: 'project-after',
          },
        ],
      },
    };
    mutateAsync.mockResolvedValueOnce(result);
    const rendered = render(<Harness visible />);

    fireEvent.click(screen.getByRole('button', { name: 'Select Task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Task' }));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledOnce();
    });
    rendered.rerender(<Harness visible={false} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Retained Project')).toHaveTextContent('project-after');
    });
  });
});

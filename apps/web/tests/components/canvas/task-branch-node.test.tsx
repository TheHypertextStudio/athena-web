/** `@docket/web` — transparent task hierarchy branch rendering tests. */
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TaskBranchNode from '@/components/canvas/task-branch-node';
import { SelectionProvider } from '@/components/selection';
import type { ObjectRef } from '@/lib/actions';

const props = {
  id: 'task-parent',
  type: 'taskBranch',
  selected: false,
  dragging: false,
  zIndex: 0,
  isConnectable: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  data: {
    orgId: 'org-1',
    title: 'Parent task',
    state: 'todo',
    stateType: 'unstarted',
    statusName: 'To do',
    priority: 'normal',
    projectId: null,
    projectName: null,
    teamId: 'team-1',
    milestoneId: null,
    parentTaskId: null,
    assigneeId: null,
    assignee: null,
    isBlocked: false,
    isReady: true,
    dueDate: null,
    onCriticalPath: false,
    isBottleneck: false,
    density: 'compact',
    hierarchyChildYs: [96, 164],
  },
} as unknown as NodeProps;
const editableProps = { ...props, isConnectable: true } as NodeProps;

describe('TaskBranchNode', () => {
  it('keeps the compound bounds transparent and exposes only the task header as its drag handle', () => {
    render(
      <SelectionProvider
        items={[
          {
            kind: 'task',
            id: 'task-parent',
            title: 'Parent task',
            organizationId: 'org-1',
          } satisfies ObjectRef,
        ]}
        organizationId="org-1"
        actionScope="all"
      >
        <ReactFlowProvider>
          <TaskBranchNode {...props} />
        </ReactFlowProvider>
      </SelectionProvider>,
    );

    expect(screen.getByTestId('task-branch')).toHaveClass('bg-transparent');
    expect(screen.getByText('Parent task').closest('.task-branch-header')).toBeInTheDocument();
    expect(screen.getByTestId('task-hierarchy-rails').querySelectorAll('path')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /collapse/i })).not.toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Parent task/ })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('treeitem', { name: /Parent task/ })).toHaveAttribute('tabindex', '0');
  });

  it('gives editable handles a named 32px target around a 12px marker', () => {
    render(
      <SelectionProvider
        items={[
          {
            kind: 'task',
            id: 'task-parent',
            title: 'Parent task',
            organizationId: 'org-1',
          } satisfies ObjectRef,
        ]}
        organizationId="org-1"
        actionScope="all"
      >
        <ReactFlowProvider>
          <TaskBranchNode {...editableProps} />
        </ReactFlowProvider>
      </SelectionProvider>,
    );

    const handles = screen.getAllByRole('button', { name: /Parent task/ });
    expect(handles.map((handle) => handle.getAttribute('aria-label'))).toEqual([
      'Connect into Parent task',
      'Connect from Parent task',
    ]);
    for (const handle of handles) {
      expect(handle).toHaveClass('!size-8', '!border-0', '!bg-transparent');
      expect(handle).toHaveAttribute('tabindex', '0');
      expect(handle.querySelector('[data-canvas-handle-marker]')).toHaveClass('size-3');
    }
  });
});

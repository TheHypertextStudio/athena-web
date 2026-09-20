import '@testing-library/jest-dom/vitest';

import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/components/entity-display/use-work-status', () => ({
  useWorkStatus: () => ({ name: 'Planned', category: 'backlog' }),
}));

import ProjectNode from '../../../src/components/canvas/project-node';
import { SelectionProvider } from '../../../src/components/selection';

const props = {
  id: 'project-a',
  type: 'project',
  selected: false,
  dragging: false,
  zIndex: 0,
  isConnectable: false,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
  data: {
    name: 'Project Alpha',
    orgId: 'org-1',
    status: 'planned',
    health: null,
    progress: 0,
    taskCount: 0,
    completedTaskCount: 0,
    targetDate: null,
    waitingCount: 0,
    density: 'compact',
  },
} as unknown as NodeProps;
const editableProps = { ...props, isConnectable: true } as NodeProps;

describe('ProjectNode selection semantics', () => {
  it('registers the node root as one roving tree item', () => {
    render(
      <SelectionProvider
        items={[
          {
            kind: 'project',
            id: 'project-a',
            title: 'Project Alpha',
            organizationId: 'org-1',
          },
        ]}
        organizationId="org-1"
        actionScope="all"
      >
        <ReactFlowProvider>
          <ProjectNode {...props} />
        </ReactFlowProvider>
      </SelectionProvider>,
    );

    const node = screen.getByRole('treeitem');
    expect(node).toHaveAttribute('aria-selected', 'false');
    expect(node).toHaveAttribute('tabindex', '0');
  });

  it('gives editable handles a named mobile-safe target around a contrasted 12px marker', () => {
    const { container } = render(
      <SelectionProvider
        items={[
          {
            kind: 'project',
            id: 'project-a',
            title: 'Project Alpha',
            organizationId: 'org-1',
          },
        ]}
        organizationId="org-1"
        actionScope="all"
      >
        <ReactFlowProvider>
          <ProjectNode {...editableProps} />
        </ReactFlowProvider>
      </SelectionProvider>,
    );

    const handles = screen.getAllByRole('button', { name: /Project Alpha/ });
    expect(handles.map((handle) => handle.getAttribute('aria-label'))).toEqual([
      'Connect into Project Alpha',
      'Connect from Project Alpha',
    ]);
    for (const handle of handles) {
      expect(handle).toHaveClass(
        '!size-8',
        '[@media(pointer:coarse)]:!size-10',
        '!border-0',
        '!bg-transparent',
      );
      expect(handle).toHaveAttribute('tabindex', '0');
      expect(handle.querySelector('[data-canvas-handle-marker]')).toHaveClass(
        'size-3',
        'bg-outline',
      );
    }
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(2);
  });

  it('routes Enter and Space through the same click connection path', () => {
    render(
      <SelectionProvider
        items={[
          {
            kind: 'project',
            id: 'project-a',
            title: 'Project Alpha',
            organizationId: 'org-1',
          },
        ]}
        organizationId="org-1"
        actionScope="all"
      >
        <ReactFlowProvider>
          <ProjectNode {...editableProps} />
        </ReactFlowProvider>
      </SelectionProvider>,
    );
    const source = screen.getByRole('button', { name: 'Connect from Project Alpha' });
    const click = vi.fn();
    source.addEventListener('click', click);

    fireEvent.keyDown(source, { key: 'Enter' });
    fireEvent.keyDown(source, { key: ' ' });

    expect(click).toHaveBeenCalledTimes(2);
  });

  it('keeps read-only handles out of the tab order and accessibility tree', () => {
    const { container } = render(
      <SelectionProvider
        items={[
          {
            kind: 'project',
            id: 'project-a',
            title: 'Project Alpha',
            organizationId: 'org-1',
          },
        ]}
        organizationId="org-1"
        actionScope="all"
      >
        <ReactFlowProvider>
          <ProjectNode {...props} />
        </ReactFlowProvider>
      </SelectionProvider>,
    );

    expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
    for (const handle of container.querySelectorAll('.react-flow__handle')) {
      expect(handle).toHaveAttribute('aria-hidden', 'true');
      expect(handle).toHaveAttribute('tabindex', '-1');
    }
  });
});

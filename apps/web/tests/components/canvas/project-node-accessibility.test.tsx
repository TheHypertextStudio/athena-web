import '@testing-library/jest-dom/vitest';

import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
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
});

/** `@docket/web` — task graph projection tests. */
import { GraphOut } from '@docket/work/task-model';
import { describe, expect, it } from 'vitest';

import { taskGraphToFlow } from '@/components/canvas/use-task-graph';

const node = (id: string, parentTaskId: string | null) => ({
  id,
  title: id,
  state: 'todo',
  priority: 'medium',
  teamId: '01J00000000000000000000001',
  projectId: null,
  programId: '01J00000000000000000000002',
  labelIds: ['01J00000000000000000000003'],
  assigneeId: null,
  parentTaskId,
  startDate: null,
  dueDate: null,
  estimate: null,
  milestoneId: null,
  cycleId: null,
});

describe('taskGraphToFlow', () => {
  it('carries hierarchy on nodes and renders dependency edges only', () => {
    const graph = GraphOut.parse({
      nodes: [
        node('01J00000000000000000000010', null),
        node('01J00000000000000000000011', '01J00000000000000000000010'),
      ],
      edges: [
        {
          id: 'sub:parent:child',
          source: '01J00000000000000000000010',
          target: '01J00000000000000000000011',
          kind: 'subtask',
        },
        {
          id: 'dep:parent:child',
          source: '01J00000000000000000000010',
          target: '01J00000000000000000000011',
          kind: 'dependency',
        },
      ],
    });

    const flow = taskGraphToFlow(
      graph,
      'org-1',
      'compact',
      undefined,
      (key) => ({ key, name: key, category: 'unstarted' }),
      {},
    );

    expect(flow.nodes[1]?.data['parentTaskId']).toBe('01J00000000000000000000010');
    expect(flow.nodes[0]?.data).toMatchObject({
      programId: '01J00000000000000000000002',
      labelIds: ['01J00000000000000000000003'],
      cycleId: null,
      startDate: null,
      estimate: null,
    });
    expect(flow.edges).toHaveLength(1);
    expect(flow.edges[0]).toMatchObject({ id: 'dep:parent:child', reconnectable: false });
  });
});

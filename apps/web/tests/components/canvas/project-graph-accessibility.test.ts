import type { ProjectOverviewItem } from '@/lib/contracts/project';
import { describe, expect, it } from 'vitest';

import { projectRowsToDependencyEdges } from '@/components/canvas/project-graph-panel-support';

const project = (
  id: string,
  name: string,
  blockedByIds: readonly string[] = [],
): ProjectOverviewItem =>
  ({ id, name, blockedByIds, blocksIds: [] }) as unknown as ProjectOverviewItem;

describe('Project dependency accessibility', () => {
  it('names each dependency with the projects it connects', () => {
    expect(
      projectRowsToDependencyEdges([
        project('project-a', 'Alpha'),
        project('project-b', 'Beta', ['project-a']),
      ]),
    ).toEqual([
      expect.objectContaining({
        source: 'project-a',
        target: 'project-b',
        ariaLabel: 'Alpha blocks Beta',
      }),
    ]);
  });
});

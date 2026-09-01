/** `@docket/web` — approved canvas property snapshot projection. */
import type { ProjectOverviewItem } from '../../../src/lib/contracts/project';
import type { Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import {
  projectRowsToPropertySnapshots,
  taskNodesToPropertySnapshots,
} from '@/components/canvas/canvas-properties-model';
import type { TaskNodeData } from '@/components/canvas/task-node';

describe('canvas property snapshot projection', () => {
  it('retains every approved Project value from overview rows', () => {
    const row = {
      id: 'project-1',
      status: 'active',
      health: 'at_risk',
      priority: 'high',
      leadId: 'actor-1',
      teamId: 'team-1',
      programId: 'program-1',
      labelIds: ['label-1'],
      initiativeIds: ['initiative-1'],
      startDate: '2026-04-01T00:00:00.000Z',
      startDateResolution: 'quarter',
      startDateFiscalYearStartMonth: 0,
      targetDate: '2026-12-31T00:00:00.000Z',
      targetDateResolution: 'year',
      targetDateFiscalYearStartMonth: 0,
    } as ProjectOverviewItem;

    expect(projectRowsToPropertySnapshots([row], 'org-1')[0]).toEqual({
      kind: 'project',
      id: 'project-1',
      organizationId: 'org-1',
      status: 'active',
      health: 'at_risk',
      priority: 'high',
      leadId: 'actor-1',
      teamId: 'team-1',
      programId: 'program-1',
      labelIds: ['label-1'],
      initiativeIds: ['initiative-1'],
      startTimeframe: { date: '2026-04-01', resolution: 'quarter', fiscalYearStartMonth: 0 },
      targetTimeframe: { date: '2026-12-31', resolution: 'year', fiscalYearStartMonth: 0 },
    });
  });

  it('retains every approved Task value from filtered nodes', () => {
    const data = {
      orgId: 'org-1',
      title: 'Task',
      state: 'started',
      stateType: 'started',
      statusName: 'Started',
      priority: 'urgent',
      assigneeId: 'actor-1',
      projectId: 'project-1',
      projectName: 'Project',
      programId: 'program-1',
      milestoneId: 'milestone-1',
      cycleId: 'cycle-1',
      labelIds: ['label-1'],
      teamId: 'team-1',
      parentTaskId: null,
      startDate: '2026-08-01',
      dueDate: '2026-08-31',
      estimate: 5,
      assignee: null,
      isBlocked: false,
      isReady: true,
      onCriticalPath: false,
      isBottleneck: false,
      density: 'full',
    } satisfies TaskNodeData;
    const nodes = [{ id: 'task-1', position: { x: 0, y: 0 }, data }] as Node[];

    expect(taskNodesToPropertySnapshots(nodes, 'org-1')[0]).toEqual({
      kind: 'task',
      id: 'task-1',
      organizationId: 'org-1',
      state: 'started',
      priority: 'urgent',
      assigneeId: 'actor-1',
      projectId: 'project-1',
      programId: 'program-1',
      milestoneId: 'milestone-1',
      cycleId: 'cycle-1',
      labelIds: ['label-1'],
      teamId: 'team-1',
      startDate: '2026-08-01',
      dueDate: '2026-08-31',
      estimate: 5,
    });
  });
});

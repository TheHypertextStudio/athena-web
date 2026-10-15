import { describe, expect, it } from 'vitest';
import {
  InitiativeViewRow,
  ProgramViewRow,
  ProjectViewRow,
  TaskViewRow,
} from '@docket/work/work-view-contract';
import { entityNavigationSnapshotFromWorkViewRow } from '../../src/lib/contracts/entity-navigation';

const organizationId = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const id = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const updatedAt = '2026-08-21T12:00:00.000Z';
const common = { organizationId, id, updatedAt, manualRank: 'a0' };
const rows = [
  {
    row: TaskViewRow.parse({
      ...common,
      target: 'task',
      title: 'Publish rider guide',
      description: 'Private task notes',
      status: 'started',
      priority: 'high',
      assignee: null,
      delegate: null,
      team: id,
      project: null,
      program: null,
      cycle: null,
      milestone: null,
      parent: null,
      labels: [],
      creator: null,
      startDate: null,
      dueDate: null,
      createdAt: updatedAt,
      estimate: null,
      estimateMinutes: null,
      blocked: false,
      blocking: false,
      unfiled: false,
      archived: false,
    }),
    want: {
      target: 'task',
      organizationId,
      id,
      title: 'Publish rider guide',
      status: 'started',
      priority: 'high',
      updatedAt,
    },
  },
  {
    row: ProjectViewRow.parse({
      ...common,
      target: 'project',
      name: 'Launch v2',
      summary: 'Private project notes',
      status: 'started',
      priority: 'high',
      health: 'at_risk',
      lead: null,
      members: [],
      teams: [],
      program: null,
      initiatives: [],
      labels: [],
      startDate: null,
      targetDate: null,
      creator: null,
      createdAt: updatedAt,
      progress: 0.25,
      taskCount: 8,
      dependencyCount: 1,
    }),
    want: {
      target: 'project',
      organizationId,
      id,
      name: 'Launch v2',
      status: 'started',
      priority: 'high',
      health: 'at_risk',
      updatedAt,
    },
  },
  {
    row: ProgramViewRow.parse({
      ...common,
      target: 'program',
      name: 'Service improvements',
      summary: 'Private program notes',
      status: 'active',
      health: 'on_track',
      owner: null,
      initiatives: [],
      labels: [],
      visibility: 'private',
      creator: null,
      projectCount: 2,
      taskCount: 8,
      activity: { weeks: [0, 0, 0, 0, 0, 0, 0, 1], latestOccurredAt: updatedAt },
    }),
    want: {
      target: 'program',
      organizationId,
      id,
      name: 'Service improvements',
      status: 'active',
      health: 'on_track',
      updatedAt,
    },
  },
  {
    row: InitiativeViewRow.parse({
      ...common,
      target: 'initiative',
      organization: organizationId,
      name: 'Regional expansion',
      summary: 'Private initiative notes',
      status: 'started',
      priority: 'high',
      health: null,
      owner: null,
      leadTeam: null,
      labels: [],
      targetDate: null,
      updateCadence: 'monthly',
      latestUpdate: null,
      parent: null,
    }),
    want: {
      target: 'initiative',
      organizationId,
      id,
      name: 'Regional expansion',
      status: 'started',
      priority: 'high',
      health: null,
      updatedAt,
    },
  },
];

describe('work-row navigation identities', () => {
  it.each(rows)(
    'projects $row.target into its exact compact identity without body or provider data',
    ({ row, want }) => {
      const richRow = { ...row, providerPayload: { secret: 'private-provider-data' } };
      expect(entityNavigationSnapshotFromWorkViewRow(richRow)).toEqual(want);
    },
  );

  it('rejects a malformed recency field rather than retaining an unusable navigation snapshot', () => {
    const row = rows[0]?.row;
    if (!row) throw new Error('The task row fixture is missing.');
    const invalidRow = { ...row };
    Reflect.set(invalidRow, 'updatedAt', 'not-a-timestamp');
    expect(() => entityNavigationSnapshotFromWorkViewRow(invalidRow)).toThrow();
  });
});

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  DetailCapabilities,
  EntityDetailAggregate,
  type TaskId,
  type TaskNavigationSnapshot,
} from '../src';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const TASK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

describe('EntityDetailAggregate', () => {
  it('keeps a task snapshot and its detailed entity on the same branded identity', () => {
    const aggregate = EntityDetailAggregate.parse({
      target: 'task',
      snapshot: {
        target: 'task',
        organizationId: ORG_ID,
        id: TASK_ID,
        title: 'Publish the rider guide',
        status: 'in_progress',
        priority: 'high',
        updatedAt: '2026-08-23T12:00:00.000Z',
      },
      viewer: { actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAY' },
      capabilities: { comment: true, contribute: true, assign: false, manage: false },
      references: {
        workflowStates: [{ key: 'in_progress', name: 'In progress', type: 'started', position: 1 }],
      },
      defaultView: {
        task: {
          id: TASK_ID,
          organizationId: ORG_ID,
          title: 'Publish the rider guide',
          description: null,
          teamId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
          state: 'in_progress',
          priority: 'high',
          assigneeId: null,
          delegateId: null,
          projectId: null,
          programId: null,
          parentTaskId: null,
          estimateMinutes: null,
          startDate: null,
          dueDate: null,
          provenance: { source: 'native' },
          labels: [],
          createdAt: '2026-08-23T12:00:00.000Z',
          updatedAt: '2026-08-23T12:00:00.000Z',
          milestoneId: null,
          cycleId: null,
          estimate: null,
          completedAt: null,
          canceledAt: null,
          blocking: [],
          blockedBy: [],
          subtasks: [],
        },
      },
    });

    if (aggregate.target !== 'task') throw new Error('Expected Task aggregate.');
    expect(aggregate.snapshot.id).toBe(TASK_ID);
    expectTypeOf(aggregate.snapshot).toEqualTypeOf<TaskNavigationSnapshot>();
    expectTypeOf(aggregate.defaultView.task.id).toEqualTypeOf<TaskId>();
  });

  it('does not admit unknown capability or roster fields', () => {
    expect(
      DetailCapabilities.safeParse({
        comment: true,
        contribute: false,
        assign: false,
        manage: false,
        administer: true,
      }).success,
    ).toBe(false);
  });

  it('requires the authenticated actor identity without shipping the member roster', () => {
    expect(
      EntityDetailAggregate.safeParse({
        target: 'task',
        snapshot: {
          target: 'task',
          organizationId: ORG_ID,
          id: TASK_ID,
          title: 'Publish the rider guide',
          status: 'in_progress',
          priority: 'high',
          updatedAt: '2026-08-23T12:00:00.000Z',
        },
        capabilities: { comment: true, contribute: true, assign: false, manage: false },
        references: { workflowStates: [] },
        defaultView: {
          task: {
            id: TASK_ID,
            organizationId: ORG_ID,
            title: 'Publish the rider guide',
            description: null,
            teamId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
            state: 'in_progress',
            priority: 'high',
            assigneeId: null,
            delegateId: null,
            projectId: null,
            programId: null,
            parentTaskId: null,
            estimateMinutes: null,
            startDate: null,
            dueDate: null,
            provenance: { source: 'native' },
            labels: [],
            createdAt: '2026-08-23T12:00:00.000Z',
            milestoneId: null,
            cycleId: null,
            estimate: null,
            completedAt: null,
            canceledAt: null,
            blocking: [],
            blockedBy: [],
            subtasks: [],
          },
        },
      }).success,
    ).toBe(false);
  });
});

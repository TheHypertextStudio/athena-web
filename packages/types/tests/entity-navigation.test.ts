import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CommentCreate,
  CommentListQuery,
  EntityNavigationSnapshot,
  entityNavigationSnapshotFromWorkViewRow,
  InitiativeViewRow,
  ProgramViewRow,
  ProjectViewRow,
  SubjectRef,
  TaskViewRow,
  UpdateCreate,
  UpdateListQuery,
  type EntityNavigationSnapshot as EntityNavigationSnapshotValue,
  type InitiativeId,
  type OrganizationId,
  type ProjectId,
  type ProgramId,
  type TaskId,
} from '../src';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ENTITY_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const UPDATED_AT = '2026-08-23T12:00:00.000Z';

describe('EntityNavigationSnapshot', () => {
  it('keeps each entity id correlated with its discriminator', () => {
    const task = EntityNavigationSnapshot.parse({
      target: 'task',
      organizationId: ORG_ID,
      id: ENTITY_ID,
      title: 'Publish rider guide',
      status: 'started',
      priority: 'high',
      updatedAt: UPDATED_AT,
    });

    expect(task.target).toBe('task');
    if (task.target !== 'task') throw new Error('Expected a Task snapshot.');
    expectTypeOf(task.organizationId).toEqualTypeOf<OrganizationId>();
    expectTypeOf(task.id).toEqualTypeOf<TaskId>();
  });

  it('rejects a snapshot with a missing identity field', () => {
    expect(
      EntityNavigationSnapshot.safeParse({
        target: 'project',
        organizationId: ORG_ID,
        id: ENTITY_ID,
        status: 'planned',
        priority: 'normal',
        health: null,
        updatedAt: UPDATED_AT,
      }).success,
    ).toBe(false);
  });

  it('narrows every snapshot variant exhaustively', () => {
    function title(snapshot: EntityNavigationSnapshotValue): string {
      switch (snapshot.target) {
        case 'task':
          return snapshot.title;
        case 'project':
        case 'program':
        case 'initiative':
          return snapshot.name;
      }
    }

    expect(
      title(
        EntityNavigationSnapshot.parse({
          target: 'initiative',
          organizationId: ORG_ID,
          id: ENTITY_ID,
          name: 'Frequent service',
          status: 'active',
          priority: 'high',
          health: 'on_track',
          updatedAt: UPDATED_AT,
        }),
      ),
    ).toBe('Frequent service');
  });

  it('projects one exact navigation snapshot from a work-view row', () => {
    const row = ProjectViewRow.parse({
      target: 'project',
      organizationId: ORG_ID,
      manualRank: 'a0',
      isContext: false,
      id: ENTITY_ID,
      name: 'Bus buddies',
      summary: 'Pilot service planning',
      status: 'active',
      priority: 'high',
      health: 'on_track',
      lead: null,
      leadActor: null,
      display: null,
      members: [],
      teams: [],
      program: null,
      initiatives: [],
      labels: [],
      startDate: null,
      targetDate: null,
      creator: null,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
      progress: 0.5,
      taskCount: 4,
      dependencyCount: 0,
      milestones: [],
      blockedByIds: [],
      blocksIds: [],
    });

    expect(entityNavigationSnapshotFromWorkViewRow(row)).toEqual({
      target: 'project',
      organizationId: ORG_ID,
      id: ENTITY_ID,
      name: 'Bus buddies',
      status: 'active',
      priority: 'high',
      health: 'on_track',
      updatedAt: UPDATED_AT,
    });
  });

  it('projects Task, Program, and Initiative rows through their target-specific snapshots', () => {
    const shared = {
      organizationId: ORG_ID,
      manualRank: 'a0',
      isContext: false,
      id: ENTITY_ID,
      updatedAt: UPDATED_AT,
    };

    expect(
      entityNavigationSnapshotFromWorkViewRow(
        TaskViewRow.parse({
          ...shared,
          target: 'task',
          title: 'Publish rider guide',
          description: null,
          status: 'started',
          priority: 'high',
          assignee: null,
          assigneeActor: null,
          delegate: null,
          team: ENTITY_ID,
          project: null,
          program: null,
          cycle: null,
          milestone: null,
          parent: null,
          labels: [],
          creator: null,
          startDate: null,
          dueDate: null,
          createdAt: UPDATED_AT,
          estimate: null,
          estimateMinutes: null,
          blocked: false,
          blocking: false,
          unfiled: true,
          archived: false,
        }),
      ),
    ).toEqual({
      target: 'task',
      organizationId: ORG_ID,
      id: ENTITY_ID,
      title: 'Publish rider guide',
      status: 'started',
      priority: 'high',
      updatedAt: UPDATED_AT,
    });

    expect(
      entityNavigationSnapshotFromWorkViewRow(
        ProgramViewRow.parse({
          ...shared,
          target: 'program',
          name: 'Bus frequency',
          summary: null,
          status: 'active',
          health: 'on_track',
          owner: null,
          ownerActor: null,
          initiatives: [],
          labels: [],
          visibility: 'private',
          creator: null,
          projectCount: 2,
          taskCount: 5,
          activity: {
            weeks: [0, 0, 0, 0, 0, 0, 0, 0],
            latestOccurredAt: null,
          },
        }),
      ),
    ).toEqual({
      target: 'program',
      organizationId: ORG_ID,
      id: ENTITY_ID,
      name: 'Bus frequency',
      status: 'active',
      health: 'on_track',
      updatedAt: UPDATED_AT,
    });

    expect(
      entityNavigationSnapshotFromWorkViewRow(
        InitiativeViewRow.parse({
          ...shared,
          target: 'initiative',
          name: 'Frequent service',
          summary: null,
          status: 'active',
          priority: 'high',
          health: 'on_track',
          owner: null,
          ownerActor: null,
          display: null,
          leadTeam: null,
          labels: [],
          targetDate: null,
          updateCadence: 'monthly',
          latestUpdate: null,
          parent: null,
          parentLinkId: null,
          organization: ORG_ID,
          contributingProjects: [],
        }),
      ),
    ).toEqual({
      target: 'initiative',
      organizationId: ORG_ID,
      id: ENTITY_ID,
      name: 'Frequent service',
      status: 'active',
      priority: 'high',
      health: 'on_track',
      updatedAt: UPDATED_AT,
    });
  });
});

describe('SubjectRef', () => {
  it('brands the subject id from the subject type', () => {
    const project = SubjectRef.parse({ subjectType: 'project', subjectId: ENTITY_ID });

    if (project.subjectType !== 'project') throw new Error('Expected a Project subject.');
    expectTypeOf(project.subjectId).toEqualTypeOf<ProjectId>();
  });

  it('requires a valid id together with its subject type', () => {
    expect(SubjectRef.safeParse({ subjectType: 'task' }).success).toBe(false);
    expect(SubjectRef.safeParse({ subjectType: 'task', subjectId: '' }).success).toBe(false);
    expect(SubjectRef.safeParse({ subjectId: ENTITY_ID }).success).toBe(false);
  });

  it('keeps initiative ids branded after narrowing', () => {
    const subject = SubjectRef.parse({ subjectType: 'initiative', subjectId: ENTITY_ID });

    if (subject.subjectType !== 'initiative') throw new Error('Expected an Initiative subject.');
    expectTypeOf(subject.subjectId).toEqualTypeOf<InitiativeId>();
  });

  it('defines comment and update inputs from correlated branded subjects', () => {
    const comments = CommentListQuery.parse({ subjectType: 'task', subjectId: ENTITY_ID });
    if (comments.subjectType !== 'task') throw new Error('Expected a Task comment subject.');
    expectTypeOf(comments.subjectId).toEqualTypeOf<TaskId>();

    const comment = CommentCreate.parse({
      subjectType: 'project',
      subjectId: ENTITY_ID,
      body: 'Ship it.',
    });
    if (comment.subjectType !== 'project') throw new Error('Expected a Project comment subject.');
    expectTypeOf(comment.subjectId).toEqualTypeOf<ProjectId>();

    const updates = UpdateListQuery.parse({ subjectType: 'program', subjectId: ENTITY_ID });
    if (updates.subjectType !== 'program') throw new Error('Expected a Program update subject.');
    expectTypeOf(updates.subjectId).toEqualTypeOf<ProgramId>();

    const update = UpdateCreate.parse({
      subjectType: 'initiative',
      subjectId: ENTITY_ID,
      body: 'On schedule.',
    });
    if (update.subjectType !== 'initiative') {
      throw new Error('Expected an Initiative update subject.');
    }
    expectTypeOf(update.subjectId).toEqualTypeOf<InitiativeId>();
  });
});

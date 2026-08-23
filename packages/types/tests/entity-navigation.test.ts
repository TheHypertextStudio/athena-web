import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  EntityNavigationSnapshot,
  entityNavigationSnapshotFromWorkViewRow,
  ProjectViewRow,
  SubjectRef,
  type EntityNavigationSnapshot as EntityNavigationSnapshotValue,
  type InitiativeId,
  type OrganizationId,
  type ProjectId,
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
});

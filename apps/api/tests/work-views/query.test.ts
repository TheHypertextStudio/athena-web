import { sql, type SQL } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { FractionalRank, WorkViewQueryResponse } from '@docket/work/work-view-contract';
import { InitiativeId, LabelId } from '@docket/work/ids';
import { TeamId } from '@docket/identity-access/ids';

import { ApiError } from '../../src/error';
import { rawResultRows } from '../../src/lib/raw-result';
import { decodeWorkViewCursor, encodeWorkViewCursor } from '../../src/lib/work-views/cursor';
import { queryWorkView } from '../../src/lib/work-views/query';
import { getDb, seedBaseOrg } from '../support/routes-harness';
import {
  programRequest,
  projectRequest,
  taskRequest,
  type InitiativeQueryRequest,
} from './request-fixtures';

process.env['BETTER_AUTH_SECRET'] ??= 'work-view-query-test-secret-at-least-32-characters';

describe('queryWorkView', () => {
  let schema: typeof DbModule;

  beforeAll(async () => {
    schema = await getDb();
  });

  it('searches the authorized title corpus before cursor pagination', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.task).values([
      {
        organizationId: orgId,
        teamId,
        title: 'Needle launch brief',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
      },
      {
        organizationId: orgId,
        teamId,
        title: 'Needle rollout notes',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
      },
      {
        organizationId: orgId,
        teamId,
        title: 'Unrelated task',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'public',
      },
      {
        organizationId: orgId,
        teamId,
        title: 'Private needle',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'private',
      },
    ]);
    const request = taskRequest({ search: 'Needle', limit: 1 });

    const first = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request,
    });

    expect(first.totalCount).toBe(2);
    expect(first.rows).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: { ...request, cursor: first.nextCursor },
    });
    expect(
      [...first.rows, ...second.rows].map((row) => (row.target === 'task' ? row.title : '')).sort(),
    ).toEqual(['Needle launch brief', 'Needle rollout notes']);
  });

  it('searches non-Task work views by name', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.project).values([
      {
        organizationId: orgId,
        teamId,
        name: 'Needle launch project',
        status: 'planned',
        statusId: statusId('project', 'planned'),
        visibility: 'public',
      },
      {
        organizationId: orgId,
        teamId,
        name: 'Unrelated project',
        status: 'planned',
        statusId: statusId('project', 'planned'),
        visibility: 'public',
      },
    ]);

    const result = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: projectRequest({ search: 'Needle' }),
    });

    expect(result.totalCount).toBe(1);
    expect(result.rows).toEqual([
      expect.objectContaining({ target: 'project', name: 'Needle launch project' }),
    ]);
  });

  it('summarizes visible Program work activity in a cursor-stable eight-week window', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [program] = await schema.db
      .insert(schema.program)
      .values({
        organizationId: orgId,
        name: 'Activity program',
        status: 'active',
        statusId: statusId('program', 'active'),
        visibility: 'public',
      })
      .returning({ id: schema.program.id });
    if (!program) throw new Error('activity Program was not seeded');
    const [visibleProject, privateProject] = await schema.db
      .insert(schema.project)
      .values([
        {
          organizationId: orgId,
          teamId,
          programId: program.id,
          name: 'Visible linked project',
          status: 'planned',
          statusId: statusId('project', 'planned'),
          visibility: 'public',
        },
        {
          organizationId: orgId,
          teamId,
          programId: program.id,
          name: 'Private linked project',
          status: 'planned',
          statusId: statusId('project', 'planned'),
          visibility: 'private',
        },
      ])
      .returning({ id: schema.project.id, name: schema.project.name });
    if (!visibleProject || !privateProject) throw new Error('activity projects were not seeded');
    const [visibleTask, duplicatePathTask, privateTask] = await schema.db
      .insert(schema.task)
      .values([
        {
          organizationId: orgId,
          teamId,
          projectId: visibleProject.id,
          title: 'Visible linked task',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public',
        },
        {
          organizationId: orgId,
          teamId,
          programId: program.id,
          projectId: visibleProject.id,
          title: 'Task linked through both paths',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public',
        },
        {
          organizationId: orgId,
          teamId,
          projectId: visibleProject.id,
          title: 'Private linked task',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'private',
        },
      ])
      .returning({ id: schema.task.id, title: schema.task.title });
    if (!visibleTask || !duplicatePathTask || !privateTask) {
      throw new Error('activity tasks were not seeded');
    }
    const event = (docketEntityId: string, occurredAt: string, suffix: string) => ({
      organizationId: orgId,
      createdBy: humanActorId,
      sourceSystem: 'docket' as const,
      kind: 'created' as const,
      occurredAt: new Date(occurredAt),
      title: `Activity ${suffix}`,
      entityKind: 'work_item' as const,
      entityAssociation: 'matched' as const,
      docketEntityId,
      dedupeKey: `program-activity:${orgId}:${suffix}`,
    });
    await schema.db
      .insert(schema.event)
      .values([
        event(program.id, '2026-07-06T08:00:00.000Z', 'program'),
        event(visibleProject.id, '2026-07-20T08:00:00.000Z', 'project'),
        event(visibleTask.id, '2026-08-03T08:00:00.000Z', 'task'),
        event(duplicatePathTask.id, '2026-08-17T08:00:00.000Z', 'duplicate-path'),
        event(privateProject.id, '2026-08-24T08:00:00.000Z', 'private-project'),
        event(privateTask.id, '2026-08-24T09:00:00.000Z', 'private-task'),
        event(program.id, '2026-07-05T08:00:00.000Z', 'before-window'),
        event(program.id, '2026-08-24T13:00:00.000Z', 'after-as-of'),
      ]);

    const response = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: programRequest(),
      now: new Date('2026-08-24T12:00:00.000Z'),
    });

    expect(response.rows).toEqual([
      expect.objectContaining({
        id: program.id,
        activity: {
          weeks: [1, 0, 1, 0, 1, 0, 1, 0],
          latestOccurredAt: '2026-08-17T08:00:00.000Z',
        },
      }),
    ]);
  });

  it('keeps Program activity pinned to the first page cursor clock', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [firstProgram, secondProgram] = await schema.db
      .insert(schema.program)
      .values([
        {
          organizationId: orgId,
          name: 'A first Program page',
          status: 'active',
          statusId: statusId('program', 'active'),
          visibility: 'public',
        },
        {
          organizationId: orgId,
          name: 'B second Program page',
          status: 'active',
          statusId: statusId('program', 'active'),
          visibility: 'public',
        },
      ])
      .returning({ id: schema.program.id, name: schema.program.name });
    if (!firstProgram || !secondProgram) throw new Error('pagination Programs were not seeded');
    await schema.db.insert(schema.event).values([
      {
        organizationId: orgId,
        createdBy: humanActorId,
        sourceSystem: 'docket',
        kind: 'created',
        occurredAt: new Date('2026-08-17T08:00:00.000Z'),
        title: 'Program activity before the cursor boundary',
        entityKind: 'work_item',
        entityAssociation: 'matched',
        docketEntityId: secondProgram.id,
        dedupeKey: `program-activity:${orgId}:before-cursor-boundary`,
      },
      {
        organizationId: orgId,
        createdBy: humanActorId,
        sourceSystem: 'docket',
        kind: 'created',
        occurredAt: new Date('2026-08-25T08:00:00.000Z'),
        title: 'Program activity after the cursor boundary',
        entityKind: 'work_item',
        entityAssociation: 'matched',
        docketEntityId: secondProgram.id,
        dedupeKey: `program-activity:${orgId}:after-cursor-boundary`,
      },
    ]);
    const request = programRequest({
      definition: {
        ...programRequest().definition,
        arrangement: {
          groupBy: null,
          subGroupBy: null,
          orderBy: [{ field: 'name', direction: 'asc' }],
        },
      },
      limit: 1,
    });
    const first = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request,
      now: new Date('2026-08-24T12:00:00.000Z'),
    });
    if (!first.nextCursor) throw new Error('Program cursor was not returned');
    expect(first.rows).toEqual([expect.objectContaining({ id: firstProgram.id })]);
    expect(decodeWorkViewCursor(first.nextCursor).asOf).toBe('2026-08-24T12:00:00.000Z');

    const second = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: { ...request, cursor: first.nextCursor },
      now: new Date('2026-08-31T12:00:00.000Z'),
    });

    expect(second.rows).toEqual([
      expect.objectContaining({
        id: secondProgram.id,
        activity: {
          weeks: [0, 0, 0, 0, 0, 0, 1, 0],
          latestOccurredAt: '2026-08-17T08:00:00.000Z',
        },
      }),
    ]);
  });

  it('accepts postgres-js raw row arrays', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.project).values({
      organizationId: orgId,
      teamId,
      name: 'Postgres-backed project',
      status: 'planned',
      statusId: statusId('project', 'planned'),
      visibility: 'public',
    });
    const postgresJsDatabase = {
      execute: async (statement: SQL) => rawResultRows(await schema.db.execute(statement)),
    } as unknown as typeof schema.db;

    const result = await queryWorkView({
      database: postgresJsDatabase,
      organizationId: orgId,
      actorId: humanActorId,
      request: projectRequest(),
    });

    expect(result.rows).toEqual([
      expect.objectContaining({ target: 'project', name: 'Postgres-backed project' }),
    ]);
  });

  it('authorizes before filtering, distinct counts, label fan-out groups, and pagination', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [red, blue] = await schema.db
      .insert(schema.label)
      .values([
        { organizationId: orgId, name: `Red ${orgId}`, color: 'red' },
        { organizationId: orgId, name: `Blue ${orgId}`, color: 'blue' },
      ])
      .returning({ id: schema.label.id });
    if (!red || !blue) throw new Error('labels were not seeded');
    const seeded = await schema.db
      .insert(schema.task)
      .values([
        {
          organizationId: orgId,
          teamId,
          title: 'Visible alpha',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          priority: 'high',
          assigneeId: humanActorId,
          visibility: 'public',
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Visible beta',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          priority: 'high',
          assigneeId: humanActorId,
          visibility: 'public',
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Private match',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          priority: 'high',
          assigneeId: humanActorId,
          visibility: 'private',
        },
        {
          organizationId: orgId,
          teamId,
          title: 'Visible empty',
          state: 'todo',
          statusId: statusId('task', 'todo'),
          priority: 'high',
          assigneeId: humanActorId,
          visibility: 'public',
        },
      ])
      .returning({ id: schema.task.id, title: schema.task.title });
    const alpha = seeded.find((row) => row.title === 'Visible alpha');
    const beta = seeded.find((row) => row.title === 'Visible beta');
    const privateMatch = seeded.find((row) => row.title === 'Private match');
    if (!alpha || !beta || !privateMatch) throw new Error('tasks were not seeded');
    await schema.db.insert(schema.taskLabel).values([
      { organizationId: orgId, taskId: alpha.id, labelId: red.id },
      { organizationId: orgId, taskId: alpha.id, labelId: blue.id },
      { organizationId: orgId, taskId: beta.id, labelId: blue.id },
      { organizationId: orgId, taskId: privateMatch.id, labelId: blue.id },
    ]);
    const request = taskRequest({
      definition: {
        ...taskRequest().definition,
        filter: {
          kind: 'all',
          children: [
            { kind: 'predicate', field: 'priority', operator: 'is', operand: 'high' },
            {
              kind: 'predicate',
              field: 'assignee',
              operator: 'is',
              operand: { kind: 'current-actor' },
            },
            {
              kind: 'predicate',
              field: 'labels',
              operator: 'includesAny',
              operand: [LabelId.parse(blue.id)],
            },
          ],
        },
        arrangement: { groupBy: 'labels', subGroupBy: null, orderBy: [] },
      },
      limit: 1,
    });

    const first = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request,
      groupPath: [blue.id],
    });
    expect(first.totalCount).toBe(2);
    expect(() => WorkViewQueryResponse.parse(first)).not.toThrow();
    expect(first.groups.map((group) => group.count).sort()).toEqual([1, 2]);
    expect(first.rows).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();

    const second = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: { ...request, cursor: first.nextCursor },
      groupPath: [blue.id],
    });
    expect(second.rows).toHaveLength(1);
    expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id);
    await expect(
      queryWorkView({
        database: schema.db,
        organizationId: orgId,
        actorId: humanActorId,
        request: { ...request, cursor: first.nextCursor },
        groupPath: [red.id],
      }),
    ).rejects.toThrow('This page cursor belongs to another group');

    const none = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: taskRequest({
        definition: {
          ...taskRequest().definition,
          filter: {
            kind: 'predicate',
            field: 'labels',
            operator: 'includesNone',
            operand: [LabelId.parse(red.id)],
          },
        },
      }),
    });
    expect(none.rows.map((row) => (row.target === 'task' ? row.title : '')).sort()).toEqual([
      'Visible beta',
      'Visible empty',
    ]);

    const empty = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: taskRequest({
        definition: {
          ...taskRequest().definition,
          filter: { kind: 'predicate', field: 'labels', operator: 'isEmpty' },
        },
      }),
    });
    expect(empty.rows.map((row) => (row.target === 'task' ? row.title : ''))).toEqual([
      'Visible empty',
    ]);
    const allLabelGroups = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: taskRequest({
        definition: {
          ...taskRequest().definition,
          arrangement: { groupBy: 'labels', subGroupBy: null, orderBy: [] },
        },
      }),
    });
    expect(allLabelGroups.groups).toContainEqual({
      path: ['__empty__'],
      key: '__empty__',
      label: 'No value',
      count: 1,
    });

    await schema.db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: humanActorId,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: ['view'],
      effect: 'allow',
      cascades: true,
      createdBy: humanActorId,
    });
    const inherited = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: { ...request, limit: 100 },
    });
    expect(inherited.totalCount).toBe(3);
  });

  it('returns directly matched Initiatives plus the minimum ancestor closure', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const otherContextId = `0000000000000000000000000${orgId.slice(-1)}`;
    await schema.db.insert(schema.organization).values({
      id: otherContextId,
      name: `Other context ${orgId}`,
      slug: `other-context-${orgId.toLowerCase()}`,
    });
    const initiatives = await schema.db
      .insert(schema.initiative)
      .values([
        {
          organizationId: orgId,
          name: 'Portfolio root',
          status: 'active',
          statusId: statusId('initiative', 'active'),
        },
        {
          organizationId: orgId,
          name: 'Needle child',
          status: 'active',
          statusId: statusId('initiative', 'active'),
          priority: 'high',
        },
        {
          organizationId: orgId,
          name: 'Wrong context parent',
          status: 'active',
          statusId: statusId('initiative', 'active'),
        },
        {
          organizationId: orgId,
          name: 'Needle leaked child',
          status: 'active',
          statusId: statusId('initiative', 'active'),
        },
      ])
      .returning({ id: schema.initiative.id, name: schema.initiative.name });
    const root = initiatives.find((row) => row.name === 'Portfolio root');
    const child = initiatives.find((row) => row.name === 'Needle child');
    const wrongParent = initiatives.find((row) => row.name === 'Wrong context parent');
    const leakedChild = initiatives.find((row) => row.name === 'Needle leaked child');
    if (!root || !child || !wrongParent || !leakedChild)
      throw new Error('initiatives were not seeded');
    await schema.db.insert(schema.initiativeHierarchyLink).values([
      {
        contextOrganizationId: orgId,
        parentInitiativeId: root.id,
        childInitiativeId: child.id,
        createdBy: humanActorId,
      },
      {
        contextOrganizationId: otherContextId,
        parentInitiativeId: wrongParent.id,
        childInitiativeId: child.id,
        createdBy: humanActorId,
      },
      {
        contextOrganizationId: otherContextId,
        parentInitiativeId: root.id,
        childInitiativeId: leakedChild.id,
        createdBy: humanActorId,
      },
    ]);
    const request: InitiativeQueryRequest = {
      target: 'initiative',
      definition: {
        version: 2,
        target: 'initiative',
        filter: {
          kind: 'all',
          children: [
            { kind: 'predicate', field: 'name', operator: 'contains', operand: 'Needle' },
            {
              kind: 'predicate',
              field: 'parent',
              operator: 'is',
              operand: InitiativeId.parse(root.id),
            },
          ],
        },
        arrangement: { groupBy: 'priority', subGroupBy: null, orderBy: [] },
        presentation: {
          layout: 'list',
          properties: ['status', 'priority'],
          density: 'comfortable',
          showEmptyGroups: false,
        },
      },
      temporaryFilter: null,
      context: { kind: 'initiative', initiativeId: InitiativeId.parse(root.id) },
      limit: 100,
    };

    const response = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request,
      groupPath: ['high'],
    });

    expect(response.rows.map((row) => row.id).sort()).toEqual([root.id, child.id].sort());
    expect(response.rows.find((row) => row.id === root.id)?.isContext).toBe(true);
    const childRow = response.rows.find((row) => row.id === child.id);
    expect(childRow?.target).toBe('initiative');
    expect(childRow?.target === 'initiative' ? childRow.parent : null).toBe(root.id);
    expect(response.totalCount).toBe(1);
    expect(response.groups.map((group) => group.count)).toEqual([1]);
  });

  it('authorizes Projects through secondary Teams and returns named Project and Program output', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [secondary] = await schema.db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Secondary team', key: `S${orgId.slice(-5)}` })
      .returning({ id: schema.team.id });
    if (!secondary) throw new Error('secondary team was not seeded');
    const [project] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Secondary-owned project',
        summary: 'A compact roster summary',
        leadId: humanActorId,
        teamId,
        status: 'planned',
        statusId: statusId('project', 'planned'),
        visibility: 'private',
      })
      .returning({ id: schema.project.id });
    if (!project) throw new Error('project was not seeded');
    await schema.db.insert(schema.entityDisplay).values({
      organizationId: orgId,
      subjectType: 'project',
      subjectId: project.id,
      iconKey: 'folder',
      colorKey: 'blue',
      createdBy: humanActorId,
    });
    await schema.db.insert(schema.projectTeam).values({
      organizationId: orgId,
      projectId: project.id,
      teamId: secondary.id,
      isPrimary: false,
    });
    await schema.db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: humanActorId,
      resourceKind: 'team',
      resourceId: secondary.id,
      capabilities: ['view'],
      effect: 'allow',
      cascades: true,
      createdBy: humanActorId,
    });
    const projectResponse = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: projectRequest({
        definition: {
          ...projectRequest().definition,
          arrangement: { groupBy: 'teams', subGroupBy: 'status', orderBy: [] },
        },
      }),
    });
    expect(projectResponse.rows).toHaveLength(1);
    expect(projectResponse.rows[0]?.target).toBe('project');
    expect(projectResponse.rows[0]).toMatchObject({
      summary: 'A compact roster summary',
      leadActor: { id: humanActorId, kind: 'human', displayName: 'Ada', avatar: null },
      display: { iconKey: 'folder', colorKey: 'blue', customized: true },
    });
    expect(projectResponse.groups).toContainEqual({
      path: [secondary.id],
      key: secondary.id,
      label: 'Secondary team',
      count: 1,
    });
    expect(
      projectResponse.groups.some((group) => group.path.length === 2 && group.label !== 'planned'),
    ).toBe(true);

    const [program] = await schema.db
      .insert(schema.program)
      .values({
        organizationId: orgId,
        name: 'Program output',
        summary: 'Ongoing work area',
        ownerId: humanActorId,
        status: 'active',
        statusId: statusId('program', 'active'),
        visibility: 'public',
      })
      .returning({ id: schema.program.id });
    if (!program) throw new Error('program was not seeded');
    await schema.db.insert(schema.entityDisplay).values({
      organizationId: orgId,
      subjectType: 'program',
      subjectId: program.id,
      iconKey: 'layers',
      colorKey: 'purple',
      createdBy: humanActorId,
    });
    const programResponse = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: programRequest(),
    });
    expect(programResponse.rows).toHaveLength(1);
    expect(programResponse.rows[0]?.target).toBe('program');
    expect(programResponse.rows[0]).toMatchObject({
      summary: 'Ongoing work area',
      ownerActor: { id: humanActorId, kind: 'human', displayName: 'Ada', avatar: null },
      display: { iconKey: 'layers', colorKey: 'purple', customized: true },
    });
  });

  it('executes Project queries in a Team context through the compatibility primary Team', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [project] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Legacy Team-context project',
        teamId,
        status: 'planned',
        statusId: statusId('project', 'planned'),
        visibility: 'public',
      })
      .returning({ id: schema.project.id });
    if (!project) throw new Error('Team-context project was not seeded');

    const response = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: projectRequest({ context: { kind: 'team', teamId: TeamId.parse(teamId) } }),
    });

    expect(response.totalCount).toBe(1);
    expect(response.rows[0]?.id).toBe(project.id);
  });

  it('unifies compatibility primary and Project Team edges for grants, filters, groups, and DTOs', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [otherPrimary] = await schema.db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Other primary', key: `O${orgId.slice(-5)}` })
      .returning({ id: schema.team.id });
    if (!otherPrimary) throw new Error('other primary Team was not seeded');
    const projects = await schema.db
      .insert(schema.project)
      .values([
        {
          organizationId: orgId,
          name: 'Legacy primary only',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
          visibility: 'private' as const,
        },
        {
          organizationId: orgId,
          name: 'Secondary edge only',
          teamId: otherPrimary.id,
          status: 'planned',
          statusId: statusId('project', 'planned'),
          visibility: 'private' as const,
        },
        {
          organizationId: orgId,
          name: 'Primary and edge duplicate',
          teamId,
          status: 'planned',
          statusId: statusId('project', 'planned'),
          visibility: 'private' as const,
        },
      ])
      .returning({ id: schema.project.id, name: schema.project.name });
    const byName = new Map(projects.map((project) => [project.name, project.id]));
    const secondaryOnly = byName.get('Secondary edge only');
    const duplicate = byName.get('Primary and edge duplicate');
    if (!secondaryOnly || !duplicate) throw new Error('compatibility Projects were not seeded');
    await schema.db.insert(schema.projectTeam).values([
      {
        organizationId: orgId,
        projectId: secondaryOnly,
        teamId,
        isPrimary: false,
      },
      {
        organizationId: orgId,
        projectId: duplicate,
        teamId,
        isPrimary: true,
      },
    ]);
    await schema.db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: humanActorId,
      resourceKind: 'team',
      resourceId: teamId,
      capabilities: ['view'],
      effect: 'allow',
      cascades: true,
      createdBy: humanActorId,
    });
    const request = projectRequest({
      definition: {
        ...projectRequest().definition,
        filter: {
          kind: 'predicate',
          field: 'teams',
          operator: 'includesAny',
          operand: [TeamId.parse(teamId)],
        },
        arrangement: { groupBy: 'teams', subGroupBy: null, orderBy: [] },
      },
    });

    const response = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request,
    });

    expect(response.totalCount).toBe(3);
    expect(response.groups).toContainEqual({
      path: [teamId],
      key: teamId,
      label: expect.any(String),
      count: 3,
    });
    expect(response.groups).toContainEqual({
      path: [otherPrimary.id],
      key: otherPrimary.id,
      label: 'Other primary',
      count: 1,
    });
    const rows = response.rows.filter((row) => row.target === 'project');
    expect(rows.find((row) => row.name === 'Legacy primary only')?.teams).toEqual([teamId]);
    expect(rows.find((row) => row.name === 'Secondary edge only')?.teams.sort()).toEqual(
      [teamId, otherPrimary.id].sort(),
    );
    expect(rows.find((row) => row.name === 'Primary and edge duplicate')?.teams).toEqual([teamId]);
  });

  it('rejects cross-tenant primary Teams and Project Team edges everywhere', async () => {
    const rootOrg = await seedBaseOrg(schema.db, schema);
    const foreignOrg = await seedBaseOrg(schema.db, schema);
    const [localExtra, foreignLeak] = await Promise.all([
      schema.db
        .insert(schema.team)
        .values({
          organizationId: rootOrg.orgId,
          name: 'Wrong-edge-org Team',
          key: `W${rootOrg.orgId.slice(-5)}`,
        })
        .returning({ id: schema.team.id })
        .then((rows) => rows[0]),
      schema.db
        .insert(schema.team)
        .values({
          organizationId: foreignOrg.orgId,
          name: 'Foreign Team leak',
          key: `F${foreignOrg.orgId.slice(-5)}`,
        })
        .returning({ id: schema.team.id })
        .then((rows) => rows[0]),
    ]);
    if (!localExtra || !foreignLeak) throw new Error('tenant-boundary Teams were not seeded');
    const projects = await schema.db
      .insert(schema.project)
      .values([
        {
          organizationId: rootOrg.orgId,
          name: 'Cross-tenant legacy primary',
          teamId: foreignLeak.id,
          status: 'planned',
          statusId: rootOrg.statusId('project', 'planned'),
          visibility: 'public' as const,
        },
        {
          organizationId: rootOrg.orgId,
          name: 'Cross-tenant edge organization',
          teamId: rootOrg.teamId,
          status: 'planned',
          statusId: rootOrg.statusId('project', 'planned'),
          visibility: 'public' as const,
        },
        {
          organizationId: rootOrg.orgId,
          name: 'Cross-tenant edge Team',
          teamId: rootOrg.teamId,
          status: 'planned',
          statusId: rootOrg.statusId('project', 'planned'),
          visibility: 'public' as const,
        },
      ])
      .returning({ id: schema.project.id, name: schema.project.name });
    const byName = new Map(projects.map((project) => [project.name, project.id]));
    const wrongEdgeOrg = byName.get('Cross-tenant edge organization');
    const wrongEdgeTeam = byName.get('Cross-tenant edge Team');
    if (!wrongEdgeOrg || !wrongEdgeTeam) throw new Error('cross-tenant Projects were not seeded');
    await schema.db.insert(schema.projectTeam).values([
      {
        organizationId: foreignOrg.orgId,
        projectId: wrongEdgeOrg,
        teamId: localExtra.id,
        isPrimary: false,
      },
      {
        organizationId: rootOrg.orgId,
        projectId: wrongEdgeTeam,
        teamId: foreignLeak.id,
        isPrimary: false,
      },
    ]);
    const grouped = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: projectRequest({
        definition: {
          ...projectRequest().definition,
          arrangement: { groupBy: 'teams', subGroupBy: null, orderBy: [] },
        },
      }),
    });
    const projectRows = grouped.rows.filter((row) => row.target === 'project');
    expect(projectRows.find((row) => row.name === 'Cross-tenant legacy primary')?.teams).toEqual(
      [],
    );
    expect(projectRows.find((row) => row.name === 'Cross-tenant edge organization')?.teams).toEqual(
      [rootOrg.teamId],
    );
    expect(projectRows.find((row) => row.name === 'Cross-tenant edge Team')?.teams).toEqual([
      rootOrg.teamId,
    ]);
    expect(grouped.groups.map((group) => group.key)).not.toContain(localExtra.id);
    expect(grouped.groups.map((group) => group.key)).not.toContain(foreignLeak.id);
    expect(grouped.groups.map((group) => group.label)).not.toContain('Wrong-edge-org Team');
    expect(grouped.groups.map((group) => group.label)).not.toContain('Foreign Team leak');
    for (const teamId of [localExtra.id, foreignLeak.id]) {
      const filtered = await queryWorkView({
        database: schema.db,
        organizationId: rootOrg.orgId,
        actorId: rootOrg.humanActorId,
        request: projectRequest({
          definition: {
            ...projectRequest().definition,
            filter: {
              kind: 'predicate',
              field: 'teams',
              operator: 'includesAny',
              operand: [TeamId.parse(teamId)],
            },
          },
        }),
      });
      expect(filtered.totalCount).toBe(0);
    }
    await schema.db
      .update(schema.project)
      .set({ visibility: 'private' })
      .where(
        sql`${schema.project.id} in (${sql.join(
          projects.map((project) => sql`${project.id}`),
          sql`, `,
        )})`,
      );
    await schema.db.insert(schema.grant).values(
      [localExtra.id, foreignLeak.id].map((teamId) => ({
        organizationId: rootOrg.orgId,
        subjectKind: 'actor' as const,
        subjectId: rootOrg.humanActorId,
        resourceKind: 'team' as const,
        resourceId: teamId,
        capabilities: ['view' as const],
        effect: 'allow' as const,
        cascades: true,
        createdBy: rootOrg.humanActorId,
      })),
    );
    const granted = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: projectRequest(),
    });
    expect(granted).toMatchObject({ totalCount: 0, rows: [] });
  });

  it('maps the caller across Initiative owners and terminates a corrupted hierarchy cycle', async () => {
    const rootOrg = await seedBaseOrg(schema.db, schema);
    const foreignOrg = await seedBaseOrg(schema.db, schema);
    const [user] = await schema.db
      .insert(schema.user)
      .values({ name: 'Cross workspace viewer', email: `cross-${rootOrg.orgId}@example.test` })
      .returning({ id: schema.user.id });
    if (!user) throw new Error('cross-workspace user was not seeded');
    await schema.db
      .update(schema.actor)
      .set({ userId: user.id })
      .where(sql`${schema.actor.id} in (${rootOrg.humanActorId}, ${foreignOrg.humanActorId})`);
    const [root] = await schema.db
      .insert(schema.initiative)
      .values({
        organizationId: rootOrg.orgId,
        name: 'Root owner',
        status: 'active',
        statusId: rootOrg.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    const foreignRows = await schema.db
      .insert(schema.initiative)
      .values([
        {
          organizationId: foreignOrg.orgId,
          name: 'Foreign ancestor',
          status: 'active',
          statusId: foreignOrg.statusId('initiative', 'active'),
        },
        {
          organizationId: foreignOrg.orgId,
          name: 'Foreign direct needle',
          status: 'active',
          statusId: foreignOrg.statusId('initiative', 'active'),
        },
      ])
      .returning({ id: schema.initiative.id, name: schema.initiative.name });
    const foreignParent = foreignRows.find((row) => row.name === 'Foreign ancestor');
    const foreignChild = foreignRows.find((row) => row.name === 'Foreign direct needle');
    if (!root || !foreignParent || !foreignChild)
      throw new Error('cross initiatives were not seeded');
    await schema.db.insert(schema.initiativeHierarchyLink).values([
      {
        contextOrganizationId: rootOrg.orgId,
        parentInitiativeId: root.id,
        childInitiativeId: foreignParent.id,
        createdBy: rootOrg.humanActorId,
      },
      {
        contextOrganizationId: rootOrg.orgId,
        parentInitiativeId: foreignParent.id,
        childInitiativeId: foreignChild.id,
        createdBy: rootOrg.humanActorId,
      },
    ]);
    const request: InitiativeQueryRequest = {
      target: 'initiative',
      definition: {
        version: 2,
        target: 'initiative',
        filter: { kind: 'predicate', field: 'name', operator: 'contains', operand: 'needle' },
        arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
        presentation: {
          layout: 'list',
          properties: ['status'],
          density: 'comfortable',
          showEmptyGroups: false,
        },
      },
      temporaryFilter: null,
      context: { kind: 'initiative', initiativeId: InitiativeId.parse(root.id) },
      limit: 100,
    };
    const input = {
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request,
    } as const;
    const response = await queryWorkView(input);
    expect(response.rows.map((row) => row.id).sort()).toEqual(
      [root.id, foreignParent.id, foreignChild.id].sort(),
    );
    expect(response.totalCount).toBe(1);

    await schema.db.execute(sql`set session_replication_role = replica`);
    try {
      await schema.db.insert(schema.initiativeHierarchyLink).values({
        contextOrganizationId: rootOrg.orgId,
        parentInitiativeId: foreignChild.id,
        childInitiativeId: root.id,
        createdBy: rootOrg.humanActorId,
      });
    } finally {
      await schema.db.execute(sql`set session_replication_role = origin`);
    }
    await expect(queryWorkView(input)).resolves.toMatchObject({ totalCount: 1 });

    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(sql`${schema.actor.id}=${foreignOrg.humanActorId}`);
    await expect(queryWorkView(input)).resolves.toMatchObject({ totalCount: 0, rows: [] });

    await schema.db
      .update(schema.actor)
      .set({ status: 'active' })
      .where(sql`${schema.actor.id}=${foreignOrg.humanActorId}`);
    await schema.db
      .update(schema.actor)
      .set({ status: 'suspended' })
      .where(sql`${schema.actor.id}=${rootOrg.humanActorId}`);
    await expect(queryWorkView(input)).resolves.toMatchObject({ totalCount: 0, rows: [] });
  });

  it('uses role default visibility for the public authorization baseline', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [privateRole] = await schema.db
      .insert(schema.role)
      .values({
        organizationId: orgId,
        key: `custom-private-${orgId}`,
        name: `Custom private ${orgId}`,
        defaultVisibility: 'private',
      })
      .returning({ id: schema.role.id });
    if (!privateRole) throw new Error('private role was not seeded');
    await schema.db
      .update(schema.actor)
      .set({ roleId: privateRole.id })
      .where(sql`${schema.actor.id}=${humanActorId}`);
    const [task] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Public but not baseline visible',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        priority: 'high',
        visibility: 'public',
      })
      .returning({ id: schema.task.id });
    if (!task) throw new Error('public task was not seeded');

    expect(
      (
        await queryWorkView({
          database: schema.db,
          organizationId: orgId,
          actorId: humanActorId,
          request: taskRequest(),
        })
      ).totalCount,
    ).toBe(0);
    await schema.db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: humanActorId,
      resourceKind: 'task',
      resourceId: task.id,
      capabilities: ['view'],
      effect: 'allow',
      cascades: false,
      createdBy: humanActorId,
    });
    expect(
      (
        await queryWorkView({
          database: schema.db,
          organizationId: orgId,
          actorId: humanActorId,
          request: taskRequest(),
        })
      ).totalCount,
    ).toBe(1);
  });

  it('rejects default visibility and role grants from a cross-tenant Role reference', async () => {
    const rootOrg = await seedBaseOrg(schema.db, schema);
    const foreignOrg = await seedBaseOrg(schema.db, schema);
    const [foreignRole] = await schema.db
      .insert(schema.role)
      .values({
        organizationId: foreignOrg.orgId,
        key: `foreign-role-${foreignOrg.orgId}`,
        name: 'Foreign role',
        defaultVisibility: 'public',
      })
      .returning({ id: schema.role.id });
    if (!foreignRole) throw new Error('foreign Role was not seeded');
    await schema.db
      .update(schema.actor)
      .set({ roleId: foreignRole.id })
      .where(sql`${schema.actor.id}=${rootOrg.humanActorId}`);
    const tasks = await schema.db
      .insert(schema.task)
      .values([
        {
          organizationId: rootOrg.orgId,
          teamId: rootOrg.teamId,
          title: 'Cross-role public leak',
          state: 'todo',
          statusId: rootOrg.statusId('task', 'todo'),
          visibility: 'public' as const,
        },
        {
          organizationId: rootOrg.orgId,
          teamId: rootOrg.teamId,
          title: 'Cross-role grant leak',
          state: 'todo',
          statusId: rootOrg.statusId('task', 'todo'),
          visibility: 'private' as const,
        },
      ])
      .returning({ id: schema.task.id, title: schema.task.title });
    const privateTask = tasks.find((task) => task.title === 'Cross-role grant leak');
    if (!privateTask) throw new Error('private cross-role Task was not seeded');
    await schema.db.insert(schema.grant).values({
      organizationId: rootOrg.orgId,
      subjectKind: 'role',
      subjectId: foreignRole.id,
      resourceKind: 'task',
      resourceId: privateTask.id,
      capabilities: ['view'],
      effect: 'allow',
      cascades: false,
      createdBy: rootOrg.humanActorId,
    });

    const response = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: taskRequest(),
    });

    expect(response).toMatchObject({ totalCount: 0, rows: [] });
  });

  it('uses contextual manual rank by default with nulls last, duplicate-rank id ties, and continuation', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const rows = await schema.db
      .insert(schema.task)
      .values(
        ['Rank B', 'Rank A one', 'Rank A two', 'Unranked'].map((title) => ({
          organizationId: orgId,
          teamId,
          title,
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'public' as const,
        })),
      )
      .returning({ id: schema.task.id, title: schema.task.title });
    const byTitle = new Map(rows.map((row) => [row.title, row.id]));
    const rankB = byTitle.get('Rank B');
    const rankAOne = byTitle.get('Rank A one');
    const rankATwo = byTitle.get('Rank A two');
    const unranked = byTitle.get('Unranked');
    if (!rankB || !rankAOne || !rankATwo || !unranked)
      throw new Error('rank tasks were not seeded');
    const manualRanks: (typeof schema.workItemOrder.$inferInsert)[] = [
      {
        organizationId: orgId,
        contextType: 'organization',
        contextId: orgId,
        target: 'task',
        itemId: rankB,
        rank: FractionalRank.parse('B'),
      },
      {
        organizationId: orgId,
        contextType: 'organization',
        contextId: orgId,
        target: 'task',
        itemId: rankAOne,
        rank: FractionalRank.parse('A'),
      },
      {
        organizationId: orgId,
        contextType: 'organization',
        contextId: orgId,
        target: 'task',
        itemId: rankATwo,
        rank: FractionalRank.parse('A'),
      },
    ];
    await schema.db.insert(schema.workItemOrder).values(manualRanks);
    const expected = [rankAOne, rankATwo].sort().concat(rankB, unranked);
    const request = taskRequest({ limit: 2 });
    const first = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request,
    });
    const second = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: { ...request, cursor: first.nextCursor },
    });

    expect([...first.rows, ...second.rows].map((row) => row.id)).toEqual(expected);
  });

  it('freezes relative time and rejects cursor execution or tuple changes before SQL', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(schema.db, schema);
    const [otherActor] = await schema.db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Other actor' })
      .returning({ id: schema.actor.id });
    if (!otherActor) throw new Error('other actor was not seeded');
    await schema.db.insert(schema.task).values([
      {
        organizationId: orgId,
        teamId,
        title: 'Clock one',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdAt: new Date('2026-08-20T17:00:00Z'),
      },
      {
        organizationId: orgId,
        teamId,
        title: 'Clock two',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdAt: new Date('2026-08-20T18:00:00Z'),
      },
    ]);
    const request = taskRequest({
      definition: {
        ...taskRequest().definition,
        filter: {
          kind: 'predicate',
          field: 'createdAt',
          operator: 'on',
          operand: { kind: 'relative', anchor: 'now', unit: 'day', offset: 0 },
        },
        arrangement: {
          groupBy: null,
          subGroupBy: null,
          orderBy: [{ field: 'createdAt', direction: 'asc' }],
        },
      },
      limit: 1,
    });
    const first = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request,
      now: new Date('2026-08-20T16:00:00Z'),
      timeZone: 'America/Los_Angeles',
    });
    if (!first.nextCursor) throw new Error('cursor was not returned');
    const payload = decodeWorkViewCursor(first.nextCursor);
    expect(payload.asOf).toBe('2026-08-20T16:00:00.000Z');
    const continued = await queryWorkView({
      database: schema.db,
      organizationId: orgId,
      actorId: humanActorId,
      request: { ...request, cursor: first.nextCursor },
      now: new Date('2026-08-23T16:00:00Z'),
      timeZone: 'America/Los_Angeles',
    });
    expect(continued.rows).toHaveLength(1);
    await expect(
      queryWorkView({
        database: schema.db,
        organizationId: orgId,
        actorId: otherActor.id,
        request: { ...request, cursor: first.nextCursor },
        timeZone: 'America/Los_Angeles',
      }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      queryWorkView({
        database: schema.db,
        organizationId: orgId,
        actorId: humanActorId,
        request: { ...request, cursor: first.nextCursor },
        timeZone: 'UTC',
      }),
    ).rejects.toBeInstanceOf(ApiError);
    const badTuple = encodeWorkViewCursor({ ...payload, sortTuple: [42] });
    let invalidCursorExecutedSql = false;
    const noSqlDatabase = new Proxy(schema.db, {
      get(target, property, receiver) {
        if (property === 'execute') {
          return (statement: SQL) => {
            invalidCursorExecutedSql = true;
            return target.execute(statement);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      queryWorkView({
        database: noSqlDatabase,
        organizationId: orgId,
        actorId: humanActorId,
        request: { ...request, cursor: badTuple },
        timeZone: 'America/Los_Angeles',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(invalidCursorExecutedSql).toBe(false);
  });
});

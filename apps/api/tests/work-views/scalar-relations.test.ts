import { beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type * as DbModule from '@docket/db';
import {
  ActorId,
  CycleId,
  InitiativeId,
  InitiativeWorkViewQueryRequest,
  MilestoneId,
  ProgramId,
  ProgramWorkViewQueryRequest,
  ProjectId,
  ProjectWorkViewQueryRequest,
  TaskId,
  TaskWorkViewQueryRequest,
  TeamId,
} from '@docket/types';

import { queryWorkView } from '../../src/lib/work-views/query';
import { getDb, seedBaseOrg } from '../support/routes-harness';

type TaskRequest = z.output<typeof TaskWorkViewQueryRequest>;
type ProjectRequest = z.output<typeof ProjectWorkViewQueryRequest>;
type ProgramRequest = z.output<typeof ProgramWorkViewQueryRequest>;
type InitiativeRequest = z.output<typeof InitiativeWorkViewQueryRequest>;

function taskRequest(over: Partial<TaskRequest> = {}): TaskRequest {
  return TaskWorkViewQueryRequest.parse({
    target: 'task',
    definition: {
      version: 2,
      target: 'task',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'priority'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
    ...over,
  });
}

function projectRequest(over: Partial<ProjectRequest> = {}): ProjectRequest {
  return ProjectWorkViewQueryRequest.parse({
    target: 'project',
    definition: {
      version: 2,
      target: 'project',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'priority'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
    ...over,
  });
}

function programRequest(over: Partial<ProgramRequest> = {}): ProgramRequest {
  return ProgramWorkViewQueryRequest.parse({
    target: 'program',
    definition: {
      version: 2,
      target: 'program',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'health'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
    ...over,
  });
}

function initiativeRequest(over: Partial<InitiativeRequest> = {}): InitiativeRequest {
  return InitiativeWorkViewQueryRequest.parse({
    target: 'initiative',
    definition: {
      version: 2,
      target: 'initiative',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'priority'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
    ...over,
  });
}

function withTaskFilter(filter: NonNullable<TaskRequest['definition']['filter']>): TaskRequest {
  return taskRequest({
    definition: { ...taskRequest().definition, filter },
  });
}

function withProjectFilter(
  filter: NonNullable<ProjectRequest['definition']['filter']>,
): ProjectRequest {
  return projectRequest({
    definition: { ...projectRequest().definition, filter },
  });
}

function withProgramFilter(
  filter: NonNullable<ProgramRequest['definition']['filter']>,
): ProgramRequest {
  return programRequest({
    definition: { ...programRequest().definition, filter },
  });
}

function withInitiativeFilter(
  filter: NonNullable<InitiativeRequest['definition']['filter']>,
): InitiativeRequest {
  return initiativeRequest({
    definition: { ...initiativeRequest().definition, filter },
  });
}

describe('work-view scalar relation tenant boundaries', () => {
  let schema: typeof DbModule;

  beforeAll(async () => {
    schema = await getDb();
  });

  it('hides foreign scalar references from filters, DTOs, and contexts', async () => {
    const rootOrg = await seedBaseOrg(schema.db, schema);
    const foreignOrg = await seedBaseOrg(schema.db, schema);
    const [foreignProgram] = await schema.db
      .insert(schema.program)
      .values({
        organizationId: foreignOrg.orgId,
        name: 'Foreign Program',
        status: 'active',
        statusId: foreignOrg.statusId('program', 'active'),
      })
      .returning({ id: schema.program.id });
    const [foreignProject] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: foreignOrg.orgId,
        name: 'Foreign Project',
        teamId: foreignOrg.teamId,
        programId: foreignProgram?.id,
        status: 'planned',
        statusId: foreignOrg.statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id });
    if (!foreignProgram || !foreignProject) throw new Error('foreign hierarchy was not seeded');
    const [foreignCycle] = await schema.db
      .insert(schema.cycle)
      .values({
        organizationId: foreignOrg.orgId,
        teamId: foreignOrg.teamId,
        number: 42,
        name: 'Foreign Cycle',
        startsAt: new Date('2026-08-01T00:00:00Z'),
        endsAt: new Date('2026-08-08T00:00:00Z'),
      })
      .returning({ id: schema.cycle.id });
    const [foreignMilestone] = await schema.db
      .insert(schema.milestone)
      .values({
        organizationId: foreignOrg.orgId,
        projectId: foreignProject.id,
        name: 'Foreign Milestone',
      })
      .returning({ id: schema.milestone.id });
    const [foreignTask] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: foreignOrg.orgId,
        teamId: foreignOrg.teamId,
        title: 'Foreign parent',
        state: 'todo',
        statusId: foreignOrg.statusId('task', 'todo'),
      })
      .returning({ id: schema.task.id });
    if (!foreignCycle || !foreignMilestone || !foreignTask) {
      throw new Error('foreign scalar relations were not seeded');
    }
    const [task] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: rootOrg.orgId,
        teamId: rootOrg.teamId,
        title: 'Corrupt scalar Task',
        state: 'todo',
        statusId: rootOrg.statusId('task', 'todo'),
        assigneeId: foreignOrg.humanActorId,
        delegateId: foreignOrg.humanActorId,
        projectId: foreignProject.id,
        programId: foreignProgram.id,
        cycleId: foreignCycle.id,
        milestoneId: foreignMilestone.id,
        parentTaskId: foreignTask.id,
        createdBy: foreignOrg.humanActorId,
      })
      .returning({ id: schema.task.id });
    const [project] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: rootOrg.orgId,
        name: 'Corrupt scalar Project',
        teamId: rootOrg.teamId,
        leadId: foreignOrg.humanActorId,
        programId: foreignProgram.id,
        createdBy: foreignOrg.humanActorId,
        status: 'planned',
        statusId: rootOrg.statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id });
    const [program] = await schema.db
      .insert(schema.program)
      .values({
        organizationId: rootOrg.orgId,
        name: 'Corrupt scalar Program',
        ownerId: foreignOrg.humanActorId,
        createdBy: foreignOrg.humanActorId,
        status: 'active',
        statusId: rootOrg.statusId('program', 'active'),
      })
      .returning({ id: schema.program.id });
    const [initiative] = await schema.db
      .insert(schema.initiative)
      .values({
        organizationId: rootOrg.orgId,
        name: 'Corrupt scalar Initiative',
        ownerId: foreignOrg.humanActorId,
        leadTeamId: foreignOrg.teamId,
        status: 'active',
        statusId: rootOrg.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    if (!task || !project || !program || !initiative) throw new Error('local work was not seeded');
    await schema.db.insert(schema.initiativeProject).values({
      organizationId: rootOrg.orgId,
      initiativeId: initiative.id,
      projectId: foreignProject.id,
    });
    await schema.db.insert(schema.initiativeProgram).values({
      organizationId: rootOrg.orgId,
      initiativeId: initiative.id,
      programId: foreignProgram.id,
    });
    const initiativeContext = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: taskRequest({
        context: { kind: 'initiative', initiativeId: InitiativeId.parse(initiative.id) },
      }),
    });
    expect(initiativeContext).toMatchObject({ totalCount: 0, rows: [] });

    const taskPage = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: taskRequest(),
    });
    expect(taskPage.rows.find((row) => row.id === task.id)).toMatchObject({
      assignee: null,
      delegate: null,
      project: null,
      program: null,
      cycle: null,
      milestone: null,
      parent: null,
      creator: null,
      unfiled: true,
    });
    const projectPage = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: projectRequest(),
    });
    expect(projectPage.rows.find((row) => row.id === project.id)).toMatchObject({
      lead: null,
      program: null,
      creator: null,
    });
    const programPage = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: programRequest(),
    });
    expect(programPage.rows.find((row) => row.id === program.id)).toMatchObject({
      owner: null,
      creator: null,
    });
    const initiativePage = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: initiativeRequest(),
    });
    expect(initiativePage.rows.find((row) => row.id === initiative.id)).toMatchObject({
      owner: null,
      leadTeam: null,
    });
    const actorOperand = {
      kind: 'actor' as const,
      actorId: ActorId.parse(foreignOrg.humanActorId),
    };
    const filterRequests = [
      withTaskFilter({
        kind: 'predicate',
        field: 'assignee',
        operator: 'is',
        operand: actorOperand,
      }),
      withTaskFilter({
        kind: 'predicate',
        field: 'delegate',
        operator: 'is',
        operand: actorOperand,
      }),
      withTaskFilter({
        kind: 'predicate',
        field: 'project',
        operator: 'is',
        operand: ProjectId.parse(foreignProject.id),
      }),
      withTaskFilter({
        kind: 'predicate',
        field: 'program',
        operator: 'is',
        operand: ProgramId.parse(foreignProgram.id),
      }),
      withTaskFilter({
        kind: 'predicate',
        field: 'cycle',
        operator: 'is',
        operand: CycleId.parse(foreignCycle.id),
      }),
      withTaskFilter({
        kind: 'predicate',
        field: 'milestone',
        operator: 'is',
        operand: MilestoneId.parse(foreignMilestone.id),
      }),
      withTaskFilter({
        kind: 'predicate',
        field: 'parent',
        operator: 'is',
        operand: TaskId.parse(foreignTask.id),
      }),
      withTaskFilter({
        kind: 'predicate',
        field: 'creator',
        operator: 'is',
        operand: actorOperand,
      }),
      withProjectFilter({
        kind: 'predicate',
        field: 'lead',
        operator: 'is',
        operand: actorOperand,
      }),
      withProjectFilter({
        kind: 'predicate',
        field: 'program',
        operator: 'is',
        operand: ProgramId.parse(foreignProgram.id),
      }),
      withProjectFilter({
        kind: 'predicate',
        field: 'creator',
        operator: 'is',
        operand: actorOperand,
      }),
      withProgramFilter({
        kind: 'predicate',
        field: 'owner',
        operator: 'is',
        operand: actorOperand,
      }),
      withProgramFilter({
        kind: 'predicate',
        field: 'creator',
        operator: 'is',
        operand: actorOperand,
      }),
      withInitiativeFilter({
        kind: 'predicate',
        field: 'owner',
        operator: 'is',
        operand: actorOperand,
      }),
      withInitiativeFilter({
        kind: 'predicate',
        field: 'leadTeam',
        operator: 'is',
        operand: TeamId.parse(foreignOrg.teamId),
      }),
    ];
    for (const request of filterRequests) {
      const filtered = await queryWorkView({
        database: schema.db,
        organizationId: rootOrg.orgId,
        actorId: rootOrg.humanActorId,
        request,
      });
      expect(filtered.totalCount).toBe(0);
    }

    const [foreignTeamTask] = await schema.db
      .insert(schema.task)
      .values({
        organizationId: rootOrg.orgId,
        teamId: foreignOrg.teamId,
        title: 'Corrupt Team Task',
        state: 'todo',
        statusId: rootOrg.statusId('task', 'todo'),
      })
      .returning({ id: schema.task.id });
    if (!foreignTeamTask) throw new Error('foreign-Team Task was not seeded');
    const taskRoster = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: taskRequest(),
    });
    expect(taskRoster.rows.map((row) => row.id)).not.toContain(foreignTeamTask.id);
    const teamFiltered = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: withTaskFilter({
        kind: 'predicate',
        field: 'team',
        operator: 'is',
        operand: TeamId.parse(foreignOrg.teamId),
      }),
    });
    expect(teamFiltered.totalCount).toBe(0);

    const contexts = [
      taskRequest({ context: { kind: 'team', teamId: TeamId.parse(foreignOrg.teamId) } }),
      taskRequest({
        context: { kind: 'project', projectId: ProjectId.parse(foreignProject.id) },
      }),
      taskRequest({
        context: { kind: 'program', programId: ProgramId.parse(foreignProgram.id) },
      }),
      projectRequest({
        context: { kind: 'program', programId: ProgramId.parse(foreignProgram.id) },
      }),
    ];
    for (const request of contexts) {
      const contextual = await queryWorkView({
        database: schema.db,
        organizationId: rootOrg.orgId,
        actorId: rootOrg.humanActorId,
        request,
      });
      expect(contextual.totalCount).toBe(0);
    }
  });

  it('does not cascade local grants through foreign scalar ancestors', async () => {
    const rootOrg = await seedBaseOrg(schema.db, schema);
    const foreignOrg = await seedBaseOrg(schema.db, schema);
    const [foreignProgram] = await schema.db
      .insert(schema.program)
      .values({
        organizationId: foreignOrg.orgId,
        name: 'Foreign grant Program',
        status: 'active',
        statusId: foreignOrg.statusId('program', 'active'),
      })
      .returning({ id: schema.program.id });
    const [foreignProject] = await schema.db
      .insert(schema.project)
      .values({
        organizationId: foreignOrg.orgId,
        name: 'Foreign grant Project',
        teamId: foreignOrg.teamId,
        programId: foreignProgram?.id,
        status: 'planned',
        statusId: foreignOrg.statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id });
    if (!foreignProgram || !foreignProject)
      throw new Error('foreign grant hierarchy was not seeded');
    await schema.db.insert(schema.task).values({
      organizationId: rootOrg.orgId,
      teamId: foreignOrg.teamId,
      projectId: foreignProject.id,
      programId: foreignProgram.id,
      title: 'Private corrupt ancestor Task',
      state: 'todo',
      statusId: rootOrg.statusId('task', 'todo'),
      visibility: 'private',
    });
    await schema.db.insert(schema.project).values({
      organizationId: rootOrg.orgId,
      name: 'Private corrupt ancestor Project',
      teamId: rootOrg.teamId,
      programId: foreignProgram.id,
      status: 'planned',
      statusId: rootOrg.statusId('project', 'planned'),
      visibility: 'private',
    });
    await schema.db.insert(schema.grant).values(
      [
        { resourceKind: 'team' as const, resourceId: foreignOrg.teamId },
        { resourceKind: 'project' as const, resourceId: foreignProject.id },
        { resourceKind: 'program' as const, resourceId: foreignProgram.id },
      ].map(({ resourceKind, resourceId }) => ({
        organizationId: rootOrg.orgId,
        subjectKind: 'actor' as const,
        subjectId: rootOrg.humanActorId,
        resourceKind,
        resourceId,
        capabilities: ['view' as const],
        effect: 'allow' as const,
        cascades: true,
        createdBy: rootOrg.humanActorId,
      })),
    );

    const tasks = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: taskRequest(),
    });
    const projects = await queryWorkView({
      database: schema.db,
      organizationId: rootOrg.orgId,
      actorId: rootOrg.humanActorId,
      request: projectRequest(),
    });
    expect(tasks).toMatchObject({ totalCount: 0, rows: [] });
    expect(projects).toMatchObject({ totalCount: 0, rows: [] });
  });
});

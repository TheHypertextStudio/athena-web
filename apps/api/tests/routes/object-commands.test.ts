import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

import type * as DbModule from '@docket/db';

import type objectCommandsRouter from '../../src/routes/object-commands';
import type projectsRouter from '../../src/routes/projects';
import type { AppEnv } from '../../src/context';
import { idempotency } from '../../src/lib/idempotency';
import { flushDeferredWork } from '../../src/lib/after-response';
import { EntityWriteBus, type EntityWriteEvent } from '../../src/events/entity-write-bus';
import { setEntityWriteBus } from '../../src/events/entity-write-registry';
import {
  appWithActor,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedProject,
  seedTaskAccessOrg,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let objectCommands!: typeof objectCommandsRouter;
let projects!: typeof projectsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  objectCommands = (await import('../../src/routes/object-commands')).default;
  projects = (await import('../../src/routes/projects')).default;
});

async function send(
  app: ReturnType<typeof appWithActor>,
  body: Record<string, unknown>,
): Promise<Response> {
  return app.request('/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': String(body['commandId']),
    },
    body: JSON.stringify(body),
  });
}

async function seedCommandOrg(): Promise<Awaited<ReturnType<typeof seedBaseOrg>>> {
  return seedTaskAccessOrg(db, schema, 'manage');
}

describe('object commands', () => {
  it('requires a resource grant for every selected Project and dependency endpoint', async () => {
    const seeded = await seedBaseOrg(db, schema);
    const first = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Granted',
    });
    const second = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Denied',
    });
    await db.insert(schema.grant).values({
      organizationId: seeded.orgId,
      subjectKind: 'actor',
      subjectId: seeded.humanActorId,
      resourceKind: 'project',
      resourceId: first.id,
      capabilities: ['contribute'],
      effect: 'allow',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);

    const granted = await send(app, {
      commandId: 'granted-project',
      objectKind: 'project',
      objectIds: [first.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    expect(granted.status).toBe(200);
    const grantedResult = (await granted.json()) as { receipt: Record<string, unknown> };
    expect(
      (
        await send(app, {
          commandId: 'denied-project',
          objectKind: 'project',
          objectIds: [second.id],
          operation: { type: 'replace_property', property: 'priority', value: 'high' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await send(app, {
          commandId: 'endpoint-bypass',
          objectKind: 'project',
          objectIds: [first.id],
          operation: { type: 'add_dependency', blockingId: first.id, blockedId: second.id },
        })
      ).status,
    ).toBe(422);
    await db
      .delete(schema.grant)
      .where(
        and(eq(schema.grant.subjectId, seeded.humanActorId), eq(schema.grant.resourceId, first.id)),
      );
    const replay = await send(app, {
      commandId: 'denied-project-replay',
      direction: 'undo',
      receipt: grantedResult.receipt,
    });
    expect(await replay.json()).toMatchObject({ appliedIds: [], deniedIds: [first.id] });
  });

  it('accepts direct resource grants when actor context only carries view', async () => {
    const seeded = await seedBaseOrg(db, schema);
    const projectRow = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Directly managed',
    });
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Directly contributed',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!taskRow) throw new Error('task fixture insert failed');
    await db.insert(schema.grant).values([
      {
        organizationId: seeded.orgId,
        subjectKind: 'actor',
        subjectId: seeded.humanActorId,
        resourceKind: 'project',
        resourceId: projectRow.id,
        capabilities: ['manage'],
        effect: 'allow',
      },
      {
        organizationId: seeded.orgId,
        subjectKind: 'actor',
        subjectId: seeded.humanActorId,
        resourceKind: 'task',
        resourceId: taskRow.id,
        capabilities: ['contribute'],
        effect: 'allow',
      },
    ]);
    const app = appWithActor(objectCommands, seeded.orgId, ['view'], seeded.humanActorId);
    const changed = await send(app, {
      commandId: 'direct-task-grant',
      objectKind: 'task',
      objectIds: [taskRow.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    expect(changed.status).toBe(200);
    const changedPayload = (await changed.json()) as { receipt: Record<string, unknown> };
    expect(
      (
        await send(app, {
          commandId: 'direct-task-grant-undo',
          direction: 'undo',
          receipt: changedPayload.receipt,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send(app, {
          commandId: 'direct-project-assign',
          objectKind: 'project',
          objectIds: [projectRow.id],
          operation: {
            type: 'replace_property',
            property: 'leadId',
            value: seeded.humanActorId,
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send(app, {
          commandId: 'direct-project-manage',
          objectKind: 'project',
          objectIds: [projectRow.id],
          operation: { type: 'trash' },
        })
      ).status,
    ).toBe(200);
  });

  it('rejects inaccessible destination containers for Task and Project moves', async () => {
    const seeded = await seedBaseOrg(db, schema);
    const [destinationTeam] = await db
      .insert(schema.team)
      .values({
        organizationId: seeded.orgId,
        name: 'Restricted destination',
        key: `R${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id });
    const [destinationProgram] = await db
      .insert(schema.program)
      .values({
        organizationId: seeded.orgId,
        name: 'Restricted program',
        status: 'active',
        statusId: seeded.statusId('program', 'active'),
      })
      .returning({ id: schema.program.id });
    const destinationProject = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: destinationTeam?.id ?? seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Restricted project',
    });
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Directly granted task',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    const projectRow = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Directly granted project',
    });
    if (!destinationTeam || !destinationProgram || !taskRow) {
      throw new Error('destination authorization fixture insert failed');
    }
    await db.insert(schema.grant).values([
      {
        organizationId: seeded.orgId,
        subjectKind: 'actor',
        subjectId: seeded.humanActorId,
        resourceKind: 'task',
        resourceId: taskRow.id,
        capabilities: ['contribute'],
        effect: 'allow',
      },
      {
        organizationId: seeded.orgId,
        subjectKind: 'actor',
        subjectId: seeded.humanActorId,
        resourceKind: 'project',
        resourceId: projectRow.id,
        capabilities: ['contribute'],
        effect: 'allow',
      },
    ]);
    const app = appWithActor(objectCommands, seeded.orgId, ['view'], seeded.humanActorId);

    for (const [commandId, objectKind, objectId, property, value] of [
      ['denied-task-project', 'task', taskRow.id, 'projectId', destinationProject.id],
      ['denied-task-program', 'task', taskRow.id, 'programId', destinationProgram.id],
      ['denied-project-team', 'project', projectRow.id, 'teamId', destinationTeam.id],
      ['denied-project-program', 'project', projectRow.id, 'programId', destinationProgram.id],
    ] as const) {
      const response = await send(app, {
        commandId,
        objectKind,
        objectIds: [objectId],
        operation: { type: 'replace_property', property, value },
      });
      expect(response.status, commandId).toBe(404);
    }
  });

  it('skips replay when a destination container grant has been removed', async () => {
    const seeded = await seedBaseOrg(db, schema);
    const [destinationTeam] = await db
      .insert(schema.team)
      .values({
        organizationId: seeded.orgId,
        name: 'Temporary team access',
        key: `T${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id });
    const [destinationProgram] = await db
      .insert(schema.program)
      .values({
        organizationId: seeded.orgId,
        name: 'Temporary program access',
        status: 'active',
        statusId: seeded.statusId('program', 'active'),
      })
      .returning({ id: schema.program.id });
    const destinationProject = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: null,
      createdBy: seeded.humanActorId,
      name: 'Temporary project access',
    });
    const [taskProject, taskProgram] = await db
      .insert(schema.task)
      .values([
        {
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          title: 'Move into project',
          state: 'backlog',
          statusId: seeded.statusId('task', 'backlog'),
        },
        {
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          title: 'Move into program',
          state: 'backlog',
          statusId: seeded.statusId('task', 'backlog'),
        },
      ])
      .returning({ id: schema.task.id });
    const projectTeam = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Move into team',
    });
    const projectProgram = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Move into program',
    });
    if (!destinationTeam || !destinationProgram || !taskProject || !taskProgram) {
      throw new Error('destination replay fixture insert failed');
    }

    const objectGrants = [
      ['task', taskProject.id],
      ['task', taskProgram.id],
      ['project', projectTeam.id],
      ['project', projectProgram.id],
    ] as const;
    const destinationGrants = [
      ['project', destinationProject.id],
      ['program', destinationProgram.id],
      ['team', destinationTeam.id],
      ['team', seeded.teamId],
    ] as const;
    await db.insert(schema.grant).values(
      [...objectGrants, ...destinationGrants].map(([resourceKind, resourceId]) => ({
        organizationId: seeded.orgId,
        subjectKind: 'actor' as const,
        subjectId: seeded.humanActorId,
        resourceKind,
        resourceId,
        capabilities: ['contribute' as const],
        effect: 'allow' as const,
      })),
    );
    const app = appWithActor(objectCommands, seeded.orgId, ['view'], seeded.humanActorId);
    const scenarios = [
      {
        key: 'task-project',
        objectKind: 'task',
        objectId: taskProject.id,
        property: 'projectId',
        destinationKind: 'project',
        destinationId: destinationProject.id,
      },
      {
        key: 'task-program',
        objectKind: 'task',
        objectId: taskProgram.id,
        property: 'programId',
        destinationKind: 'program',
        destinationId: destinationProgram.id,
      },
      {
        key: 'project-team',
        objectKind: 'project',
        objectId: projectTeam.id,
        property: 'teamId',
        destinationKind: 'team',
        destinationId: destinationTeam.id,
      },
      {
        key: 'project-program',
        objectKind: 'project',
        objectId: projectProgram.id,
        property: 'programId',
        destinationKind: 'program',
        destinationId: destinationProgram.id,
      },
    ] as const;

    for (const scenario of scenarios) {
      const forward = await send(app, {
        commandId: `${scenario.key}-forward`,
        objectKind: scenario.objectKind,
        objectIds: [scenario.objectId],
        operation: {
          type: 'replace_property',
          property: scenario.property,
          value: scenario.destinationId,
        },
      });
      expect(forward.status, `${scenario.key} forward`).toBe(200);
      const forwardPayload = (await forward.json()) as { receipt: Record<string, unknown> };
      const undo = await send(app, {
        commandId: `${scenario.key}-undo`,
        direction: 'undo',
        receipt: forwardPayload.receipt,
      });
      expect(undo.status, `${scenario.key} undo`).toBe(200);
      const undoPayload = (await undo.json()) as { receipt: Record<string, unknown> };
      await db
        .delete(schema.grant)
        .where(
          and(
            eq(schema.grant.subjectId, seeded.humanActorId),
            eq(schema.grant.resourceKind, scenario.destinationKind),
            eq(schema.grant.resourceId, scenario.destinationId),
          ),
        );
      const redo = await send(app, {
        commandId: `${scenario.key}-redo`,
        direction: 'redo',
        receipt: undoPayload.receipt,
      });
      expect(redo.status, `${scenario.key} redo`).toBe(200);
      expect(await redo.json()).toMatchObject({
        appliedIds: [],
        deniedIds: [scenario.objectId],
      });
      await db.insert(schema.grant).values({
        organizationId: seeded.orgId,
        subjectKind: 'actor',
        subjectId: seeded.humanActorId,
        resourceKind: scenario.destinationKind,
        resourceId: scenario.destinationId,
        capabilities: ['contribute'],
        effect: 'allow',
      });
    }
  });

  it('stores canonical Task status fields and restores all terminal fields on undo', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'contribute');
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Finish me',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!row) throw new Error('task insert returned no row');
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);
    const complete = await send(app, {
      commandId: 'complete-task',
      objectKind: 'task',
      objectIds: [row.id],
      operation: { type: 'replace_property', property: 'state', value: 'done' },
    });
    const completeResult = (await complete.json()) as {
      receipt: { entries: { property: string; after: unknown }[] } & Record<string, unknown>;
    };
    expect(complete.status, JSON.stringify(completeResult)).toBe(200);
    expect(completeResult.receipt.entries.map((entry) => entry.property)).toEqual([
      'state',
      'statusId',
      'completedAt',
      'canceledAt',
    ]);
    const [completed] = await db.select().from(schema.task).where(eq(schema.task.id, row.id));
    expect(completed).toMatchObject({
      state: 'done',
      statusId: seeded.statusId('task', 'done'),
      canceledAt: null,
    });
    expect(completed?.completedAt).toBeInstanceOf(Date);

    const undo = await send(app, {
      commandId: 'undo-complete-task',
      direction: 'undo',
      receipt: completeResult.receipt,
    });
    expect(undo.status).toBe(200);
    const [reopened] = await db.select().from(schema.task).where(eq(schema.task.id, row.id));
    expect(reopened).toMatchObject({
      state: 'backlog',
      statusId: seeded.statusId('task', 'backlog'),
      completedAt: null,
      canceledAt: null,
    });
    const undoPayload = (await undo.json()) as {
      conflictingIds: string[];
      receipt: { entries: { property: string }[] } & Record<string, unknown>;
    };
    expect(undoPayload.conflictingIds).toEqual([]);
    expect(undoPayload.receipt.entries).toHaveLength(4);
    const redo = await send(app, {
      commandId: 'redo-complete-task',
      direction: 'redo',
      receipt: undoPayload.receipt,
    });
    const redoPayload = (await redo.json()) as {
      conflictingIds: string[];
      receipt: { entries: { property: string }[] };
    };
    expect(redoPayload.conflictingIds).toEqual([]);
    expect(redoPayload.receipt.entries).toHaveLength(4);
  });

  it('replays the canonical Project status tuple without self-conflicts', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Status tuple',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const forward = await send(app, {
      commandId: 'project-status-forward',
      objectKind: 'project',
      objectIds: [row.id],
      operation: { type: 'replace_property', property: 'status', value: 'active' },
    });
    const forwardPayload = (await forward.json()) as {
      receipt: { entries: unknown[] } & Record<string, unknown>;
    };
    expect(forwardPayload.receipt.entries).toHaveLength(2);
    const undo = await send(app, {
      commandId: 'project-status-undo',
      direction: 'undo',
      receipt: forwardPayload.receipt,
    });
    const undoPayload = (await undo.json()) as {
      conflictingIds: string[];
      receipt: { entries: unknown[] } & Record<string, unknown>;
    };
    expect(undoPayload.conflictingIds).toEqual([]);
    expect(undoPayload.receipt.entries).toHaveLength(2);
    const redo = await send(app, {
      commandId: 'project-status-redo',
      direction: 'redo',
      receipt: undoPayload.receipt,
    });
    expect(await redo.json()).toMatchObject({
      conflictingIds: [],
      receipt: { entries: expect.arrayContaining(undoPayload.receipt.entries) },
    });
  });

  it('normalizes Task date receipts for immediate undo and rejects invalid bounds', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'contribute');
    const [row] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Dated task',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!row) throw new Error('task insert returned no row');
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);
    const changed = await send(app, {
      commandId: 'date-task',
      objectKind: 'task',
      objectIds: [row.id],
      operation: { type: 'replace_property', property: 'startDate', value: '2026-08-23' },
    });
    expect(changed.status).toBe(200);
    const result = (await changed.json()) as {
      receipt: { entries: { after: unknown }[] } & Record<string, unknown>;
    };
    expect(result.receipt.entries[0]?.after).toBe('2026-08-23');
    expect(
      (
        await send(app, {
          commandId: 'undo-date-task',
          direction: 'undo',
          receipt: result.receipt,
        })
      ).status,
    ).toBe(200);
    const [undated] = await db.select().from(schema.task).where(eq(schema.task.id, row.id));
    expect(undated?.startDate).toBeNull();
  });

  it('validates milestones against each Task Project and rejects an invalid Project move', async () => {
    const seeded = await seedCommandOrg();
    const firstProject = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'First project',
    });
    const secondProject = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Second project',
    });
    const [milestone] = await db
      .insert(schema.milestone)
      .values({
        organizationId: seeded.orgId,
        projectId: firstProject.id,
        name: 'First milestone',
      })
      .returning({ id: schema.milestone.id });
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        projectId: firstProject.id,
        title: 'Milestoned task',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!milestone || !taskRow) throw new Error('fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    expect(
      (
        await send(app, {
          commandId: 'set-milestone',
          objectKind: 'task',
          objectIds: [taskRow.id],
          operation: { type: 'replace_property', property: 'milestoneId', value: milestone.id },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send(app, {
          commandId: 'move-away-from-milestone',
          objectKind: 'task',
          objectIds: [taskRow.id],
          operation: {
            type: 'replace_property',
            property: 'projectId',
            value: secondProject.id,
          },
        })
      ).status,
    ).toBe(422);
    const [unchanged] = await db.select().from(schema.task).where(eq(schema.task.id, taskRow.id));
    expect(unchanged).toMatchObject({ projectId: firstProject.id, milestoneId: milestone.id });
  });

  it('enforces label team scope and replaces exclusive-group labels with complete receipts', async () => {
    const seeded = await seedCommandOrg();
    const [otherTeam] = await db
      .insert(schema.team)
      .values({ organizationId: seeded.orgId, name: 'Other', key: 'OTHER' })
      .returning({ id: schema.team.id });
    const [group] = await db
      .insert(schema.labelGroup)
      .values({ organizationId: seeded.orgId, name: 'Type', exclusive: true })
      .returning({ id: schema.labelGroup.id });
    if (!otherTeam || !group) throw new Error('label fixture insert failed');
    const labels = await db
      .insert(schema.label)
      .values([
        { organizationId: seeded.orgId, name: 'Scoped', color: 'red', teamId: otherTeam.id },
        { organizationId: seeded.orgId, name: 'Bug', color: 'red', groupId: group.id },
        { organizationId: seeded.orgId, name: 'Feature', color: 'blue', groupId: group.id },
      ])
      .returning({ id: schema.label.id, name: schema.label.name });
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Labeled task',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!taskRow) throw new Error('task fixture insert failed');
    const byName = new Map(labels.map((item) => [item.name, item.id]));
    const scopedId = byName.get('Scoped');
    const bugId = byName.get('Bug');
    const featureId = byName.get('Feature');
    if (!scopedId || !bugId || !featureId) throw new Error('label fixture lookup failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    expect(
      (
        await send(app, {
          commandId: 'wrong-scope-label',
          objectKind: 'task',
          objectIds: [taskRow.id],
          operation: { type: 'add_association', association: 'label', associationIds: [scopedId] },
        })
      ).status,
    ).toBe(404);
    await send(app, {
      commandId: 'add-bug-label',
      objectKind: 'task',
      objectIds: [taskRow.id],
      operation: { type: 'add_association', association: 'label', associationIds: [bugId] },
    });
    const swapped = await send(app, {
      commandId: 'add-feature-label',
      objectKind: 'task',
      objectIds: [taskRow.id],
      operation: { type: 'add_association', association: 'label', associationIds: [featureId] },
    });
    expect(swapped.status).toBe(200);
    const payload = (await swapped.json()) as {
      receipt: { entries: { relatedId: string; before: boolean; after: boolean }[] };
    };
    expect(payload.receipt.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relatedId: bugId, before: true, after: false }),
        expect.objectContaining({ relatedId: featureId, before: false, after: true }),
      ]),
    );
  });

  it('removes a stale team-scoped label and denies restoring it outside that scope', async () => {
    const seeded = await seedCommandOrg();
    const [otherTeam] = await db
      .insert(schema.team)
      .values({ organizationId: seeded.orgId, name: 'Former team', key: 'FORMER' })
      .returning({ id: schema.team.id });
    if (!otherTeam) throw new Error('team fixture insert failed');
    const [labelRow] = await db
      .insert(schema.label)
      .values({
        organizationId: seeded.orgId,
        teamId: otherTeam.id,
        name: 'Former scope',
        color: 'red',
      })
      .returning({ id: schema.label.id });
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Moved task',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!labelRow || !taskRow) throw new Error('stale label fixture insert failed');
    await db.insert(schema.taskLabel).values({
      organizationId: seeded.orgId,
      taskId: taskRow.id,
      labelId: labelRow.id,
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const removed = await send(app, {
      commandId: 'remove-stale-label',
      objectKind: 'task',
      objectIds: [taskRow.id],
      operation: {
        type: 'remove_association',
        association: 'label',
        associationIds: [labelRow.id],
      },
    });
    expect(removed.status).toBe(200);
    const removedPayload = (await removed.json()) as { receipt: Record<string, unknown> };
    expect(
      await db.select().from(schema.taskLabel).where(eq(schema.taskLabel.taskId, taskRow.id)),
    ).toEqual([]);
    const undo = await send(app, {
      commandId: 'restore-stale-label',
      direction: 'undo',
      receipt: removedPayload.receipt,
    });
    expect(undo.status, await undo.clone().text()).toBe(200);
    expect(await undo.json()).toMatchObject({ appliedIds: [], deniedIds: [taskRow.id] });
    expect(
      await db.select().from(schema.taskLabel).where(eq(schema.taskLabel.taskId, taskRow.id)),
    ).toEqual([]);
  });

  it('narrows replay when a Label scope changes for only part of the receipt', async () => {
    const seeded = await seedCommandOrg();
    const [otherTeam] = await db
      .insert(schema.team)
      .values({
        organizationId: seeded.orgId,
        name: 'Other scope',
        key: `O${Math.random().toString(36).slice(2, 6)}`,
      })
      .returning({ id: schema.team.id });
    if (!otherTeam) throw new Error('label replay team fixture failed');
    const tasks = await db
      .insert(schema.task)
      .values([
        {
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          title: 'Still in scope',
          state: 'backlog',
          statusId: seeded.statusId('task', 'backlog'),
        },
        {
          organizationId: seeded.orgId,
          teamId: otherTeam.id,
          title: 'No longer in scope',
          state: 'backlog',
          statusId: seeded.statusId('task', 'backlog'),
        },
      ])
      .returning({ id: schema.task.id });
    const [labelRow] = await db
      .insert(schema.label)
      .values({ organizationId: seeded.orgId, name: 'Scope changes', color: 'blue' })
      .returning({ id: schema.label.id });
    const first = tasks[0];
    const second = tasks[1];
    if (!first || !second || !labelRow) throw new Error('label replay fixture failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const forward = await send(app, {
      commandId: 'label-scope-forward',
      objectKind: 'task',
      objectIds: [first.id, second.id],
      operation: {
        type: 'add_association',
        association: 'label',
        associationIds: [labelRow.id],
      },
    });
    const forwardPayload = (await forward.json()) as { receipt: Record<string, unknown> };
    const undo = await send(app, {
      commandId: 'label-scope-undo',
      direction: 'undo',
      receipt: forwardPayload.receipt,
    });
    const undoPayload = (await undo.json()) as { receipt: Record<string, unknown> };
    await db
      .update(schema.label)
      .set({ teamId: seeded.teamId })
      .where(eq(schema.label.id, labelRow.id));

    const redo = await send(app, {
      commandId: 'label-scope-redo',
      direction: 'redo',
      receipt: undoPayload.receipt,
    });
    expect(redo.status).toBe(200);
    expect(await redo.json()).toMatchObject({
      appliedIds: [first.id],
      deniedIds: [second.id],
      receipt: { entries: [expect.objectContaining({ objectId: first.id })] },
    });
  });

  it('returns a narrowed replay receipt when an Initiative target was deleted', async () => {
    const seeded = await seedCommandOrg();
    const projectRow = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Initiative drift target',
    });
    const [initiativeRow] = await db
      .insert(schema.initiative)
      .values({
        organizationId: seeded.orgId,
        name: 'Deleted after command',
        status: 'active',
        statusId: seeded.statusId('initiative', 'active'),
      })
      .returning({ id: schema.initiative.id });
    if (!initiativeRow) throw new Error('initiative replay fixture failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const forward = await send(app, {
      commandId: 'initiative-delete-forward',
      objectKind: 'project',
      objectIds: [projectRow.id],
      operation: {
        type: 'add_association',
        association: 'initiative',
        associationIds: [initiativeRow.id],
      },
    });
    const payload = (await forward.json()) as { receipt: Record<string, unknown> };
    await db.delete(schema.initiative).where(eq(schema.initiative.id, initiativeRow.id));

    const replay = await send(app, {
      commandId: 'initiative-delete-undo',
      direction: 'undo',
      receipt: payload.receipt,
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      appliedIds: [],
      deniedIds: [projectRow.id],
      receipt: { entries: [] },
    });
  });

  it('rejects malformed replay property values before database conversion', async () => {
    const seeded = await seedCommandOrg();
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Malformed receipt target',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!taskRow) throw new Error('task fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const response = await send(app, {
      commandId: 'malformed-replay',
      direction: 'undo',
      receipt: {
        commandId: 'forged',
        objectKind: 'task',
        action: 'replace_property',
        entries: [
          {
            kind: 'object',
            objectId: taskRow.id,
            property: 'startDate',
            before: null,
            after: 'not-a-date',
          },
        ],
      },
    });
    expect(response.status).toBe(422);
  });

  it('rejects forged partial Task status tuples before the handler applies them', async () => {
    const seeded = await seedCommandOrg();
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Partial status target',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!taskRow) throw new Error('task fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    for (const [property, value] of [
      ['state', 'backlog'],
      ['statusId', seeded.statusId('task', 'backlog')],
      ['completedAt', null],
    ] as const) {
      const response = await send(app, {
        commandId: `partial-status-replay-${property}`,
        direction: 'undo',
        receipt: {
          commandId: `forged-partial-status-${property}`,
          objectKind: 'task',
          action: 'replace_property',
          entries: [
            {
              kind: 'object',
              objectId: taskRow.id,
              property,
              before: value,
              after: value,
            },
          ],
        },
      });
      expect(response.status).toBe(422);
    }
  });

  it('rejects a Task status id from another team status family', async () => {
    const seeded = await seedCommandOrg();
    const [otherTeam] = await db
      .insert(schema.team)
      .values({ organizationId: seeded.orgId, name: 'Other status team', key: 'OTHER-STATUS' })
      .returning({ id: schema.team.id });
    if (!otherTeam) throw new Error('team fixture insert failed');
    const [foreignStatus] = await db
      .insert(schema.workStatus)
      .values({
        organizationId: seeded.orgId,
        entityType: 'task',
        teamId: otherTeam.id,
        key: 'backlog',
        name: 'Other backlog',
        category: 'backlog',
        position: 0,
        isDefault: true,
      })
      .returning({ id: schema.workStatus.id });
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Status family target',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!foreignStatus || !taskRow) throw new Error('status family fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const response = await send(app, {
      commandId: 'foreign-status-replay',
      direction: 'undo',
      receipt: {
        commandId: 'forged-foreign-status',
        objectKind: 'task',
        action: 'replace_property',
        entries: [
          {
            kind: 'object',
            objectId: taskRow.id,
            property: 'state',
            before: 'backlog',
            after: 'backlog',
          },
          {
            kind: 'object',
            objectId: taskRow.id,
            property: 'statusId',
            before: foreignStatus.id,
            after: seeded.statusId('task', 'backlog'),
          },
          {
            kind: 'object',
            objectId: taskRow.id,
            property: 'completedAt',
            before: null,
            after: null,
          },
          {
            kind: 'object',
            objectId: taskRow.id,
            property: 'canceledAt',
            before: null,
            after: null,
          },
        ],
      },
    });
    expect(response.status).toBe(422);
  });

  it('rejects a replay receipt that differs from its durable forward change', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Durable receipt target',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const forward = await send(app, {
      commandId: 'durable-priority-forward',
      objectKind: 'project',
      objectIds: [row.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    const payload = (await forward.json()) as {
      receipt: { entries: { property: string; before: unknown; after: unknown }[] } & Record<
        string,
        unknown
      >;
    };
    const forged = structuredClone(payload.receipt);
    const priority = forged.entries.find((entry) => entry.property === 'priority');
    if (!priority) throw new Error('priority receipt entry missing');
    priority.before = 'urgent';
    const replay = await send(app, {
      commandId: 'durable-priority-undo',
      direction: 'undo',
      receipt: forged,
    });
    expect(replay.status).toBe(422);
    const [stored] = await db
      .select({ priority: schema.project.priority })
      .from(schema.project)
      .where(eq(schema.project.id, row.id));
    expect(stored?.priority).toBe('high');
  });

  it('rejects a forged Task terminal timestamp even when current state matches it', async () => {
    const seeded = await seedCommandOrg();
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Durable timestamp target',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!taskRow) throw new Error('task fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const forward = await send(app, {
      commandId: 'durable-timestamp-forward',
      objectKind: 'task',
      objectIds: [taskRow.id],
      operation: { type: 'replace_property', property: 'state', value: 'done' },
    });
    const payload = (await forward.json()) as {
      receipt: { entries: { property: string; before: unknown; after: unknown }[] } & Record<
        string,
        unknown
      >;
    };
    const forged = structuredClone(payload.receipt);
    const completedAt = forged.entries.find((entry) => entry.property === 'completedAt');
    if (!completedAt) throw new Error('completed timestamp receipt entry missing');
    const forgedTimestamp = '2026-08-23T12:00:00.000Z';
    completedAt.after = forgedTimestamp;
    await db
      .update(schema.task)
      .set({ completedAt: new Date(forgedTimestamp) })
      .where(eq(schema.task.id, taskRow.id));
    const replay = await send(app, {
      commandId: 'durable-timestamp-undo',
      direction: 'undo',
      receipt: forged,
    });
    expect(replay.status).toBe(422);
  });

  it('rolls back domain writes when durable change-set recording fails', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Transactional audit',
    });
    const changeSets = await import('../../src/mcp/change-set');
    const recorder = vi
      .spyOn(changeSets, 'recordChangeSetInTx')
      .mockRejectedValueOnce(new Error('forced recorder failure'));
    try {
      const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
      const response = await send(app, {
        commandId: 'recording-fails',
        objectKind: 'project',
        objectIds: [row.id],
        operation: { type: 'replace_property', property: 'priority', value: 'high' },
      });
      expect(response.status).toBe(500);
      const [unchanged] = await db
        .select({ priority: schema.project.priority })
        .from(schema.project)
        .where(eq(schema.project.id, row.id));
      expect(unchanged?.priority).toBe('none');
    } finally {
      recorder.mockRestore();
    }
  });
  it('replaces a Project property atomically and returns normalized before/after values', async () => {
    const seeded = await seedCommandOrg();
    const first = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'First',
    });
    const second = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Second',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);

    const response = await send(app, {
      commandId: 'priority-command',
      objectKind: 'project',
      objectIds: [first.id, second.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      appliedIds: string[];
      receipt: { entries: { objectId: string; property: string; before: string; after: string }[] };
    };
    expect(result.appliedIds).toEqual([first.id, second.id]);
    expect(result.receipt.entries).toEqual([
      { kind: 'object', objectId: first.id, property: 'priority', before: 'none', after: 'high' },
      { kind: 'object', objectId: second.id, property: 'priority', before: 'none', after: 'high' },
    ]);
    const rows = await db
      .select({ priority: schema.project.priority })
      .from(schema.project)
      .where(eq(schema.project.organizationId, seeded.orgId));
    expect(rows.every((row) => row.priority === 'high')).toBe(true);
  });

  it('undoes only unchanged objects and narrows the receipt for redo', async () => {
    const seeded = await seedCommandOrg();
    const first = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'First',
    });
    const second = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Second',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);
    const forward = await send(app, {
      commandId: 'forward-priority',
      objectKind: 'project',
      objectIds: [first.id, second.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    const forwardResult = (await forward.json()) as { receipt: Record<string, unknown> };
    await db
      .update(schema.project)
      .set({ priority: 'urgent' })
      .where(eq(schema.project.id, second.id));

    const undo = await send(app, {
      commandId: 'undo-priority',
      direction: 'undo',
      receipt: forwardResult.receipt,
    });
    expect(undo.status).toBe(200);
    const result = (await undo.json()) as {
      appliedIds: string[];
      conflictingIds: string[];
      receipt: { entries: { objectId: string }[] };
    };
    expect(result.appliedIds).toEqual([first.id]);
    expect(result.conflictingIds).toEqual([second.id]);
    expect(result.receipt.entries.map((entry) => entry.objectId)).toEqual([first.id]);

    const redo = await send(app, {
      commandId: 'redo-priority',
      direction: 'redo',
      receipt: result.receipt,
    });
    expect(redo.status).toBe(200);
    const priorities = await db
      .select({ id: schema.project.id, priority: schema.project.priority })
      .from(schema.project)
      .where(eq(schema.project.organizationId, seeded.orgId));
    expect(priorities).toEqual(
      expect.arrayContaining([
        { id: first.id, priority: 'high' },
        { id: second.id, priority: 'urgent' },
      ]),
    );
  });

  it('moves a Project to trash without deleting its relationships and restores it', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Recoverable',
    });
    const [linkedTask] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        title: 'Linked task',
        teamId: seeded.teamId,
        projectId: row.id,
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
        createdBy: seeded.humanActorId,
      })
      .returning({ id: schema.task.id });
    if (!linkedTask) throw new Error('task insert returned no row');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const reader = appWithActor(projects, seeded.orgId, ['view'], seeded.humanActorId);

    const trashed = await send(app, {
      commandId: 'trash-project',
      objectKind: 'project',
      objectIds: [row.id],
      operation: { type: 'trash' },
    });
    expect(trashed.status).toBe(200);
    expect((await reader.request(`/${row.id}`)).status).toBe(404);
    expect(
      await db.select().from(schema.task).where(eq(schema.task.id, linkedTask.id)),
    ).toHaveLength(1);
    const [retainedTask] = await db
      .select({ projectId: schema.task.projectId })
      .from(schema.task)
      .where(eq(schema.task.id, linkedTask.id));
    expect(retainedTask?.projectId).toBe(row.id);

    const restored = await send(app, {
      commandId: 'restore-project',
      objectKind: 'project',
      objectIds: [row.id],
      operation: { type: 'restore' },
    });
    expect(restored.status).toBe(200);
    expect((await reader.request(`/${row.id}`)).status).toBe(200);
  });

  it('rejects a mismatched idempotency header before writing', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Still none',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'wrong' },
      body: JSON.stringify({
        commandId: 'right',
        objectKind: 'project',
        objectIds: [row.id],
        operation: { type: 'replace_property', property: 'priority', value: 'high' },
      }),
    });
    expect(response.status).toBe(422);
    const [unchanged] = await db
      .select({ priority: schema.project.priority })
      .from(schema.project)
      .where(eq(schema.project.id, row.id));
    expect(unchanged?.priority).toBe('none');
  });

  it('rejects a cross-organization reference before changing any selected Project', async () => {
    const mine = await seedCommandOrg();
    const other = await seedBaseOrg(db, schema);
    const first = await seedProject(db, schema, mine.statusId, {
      organizationId: mine.orgId,
      teamId: mine.teamId,
      createdBy: mine.humanActorId,
      name: 'First',
    });
    const second = await seedProject(db, schema, mine.statusId, {
      organizationId: mine.orgId,
      teamId: mine.teamId,
      createdBy: mine.humanActorId,
      name: 'Second',
    });
    const [foreignProgram] = await db
      .insert(schema.program)
      .values({
        organizationId: other.orgId,
        name: 'Foreign',
        status: 'active',
        statusId: other.statusId('program', 'active'),
        createdBy: other.humanActorId,
      })
      .returning({ id: schema.program.id });
    if (!foreignProgram) throw new Error('program insert returned no row');
    const app = appWithActor(objectCommands, mine.orgId, ['contribute'], mine.humanActorId);

    const response = await send(app, {
      commandId: 'bad-program',
      objectKind: 'project',
      objectIds: [first.id, second.id],
      operation: {
        type: 'replace_property',
        property: 'programId',
        value: foreignProgram.id,
      },
    });
    expect(response.status).toBe(404);
    const rows = await db
      .select({ programId: schema.project.programId })
      .from(schema.project)
      .where(eq(schema.project.organizationId, mine.orgId));
    expect(rows.every((row) => row.programId === null)).toBe(true);
  });

  it('accepts active human Project leads and rejects agents or foreign humans atomically', async () => {
    const mine = await seedCommandOrg();
    const other = await seedBaseOrg(db, schema);
    const first = await seedProject(db, schema, mine.statusId, {
      organizationId: mine.orgId,
      teamId: mine.teamId,
      createdBy: mine.humanActorId,
      name: 'First accountable Project',
    });
    const second = await seedProject(db, schema, mine.statusId, {
      organizationId: mine.orgId,
      teamId: mine.teamId,
      createdBy: mine.humanActorId,
      name: 'Second accountable Project',
    });
    const [agent] = await db
      .insert(schema.actor)
      .values({ organizationId: mine.orgId, kind: 'agent', displayName: 'Automation agent' })
      .returning({ id: schema.actor.id });
    if (!agent) throw new Error('agent fixture insert returned no row');
    const [suspendedHuman] = await db
      .insert(schema.actor)
      .values({
        organizationId: mine.orgId,
        kind: 'human',
        status: 'suspended',
        displayName: 'Suspended person',
      })
      .returning({ id: schema.actor.id });
    if (!suspendedHuman) throw new Error('suspended fixture insert returned no row');
    const app = appWithActor(objectCommands, mine.orgId, ['manage'], mine.humanActorId);
    const ids = [first.id, second.id];

    expect(
      (
        await send(app, {
          commandId: 'human-project-lead',
          objectKind: 'project',
          objectIds: ids,
          operation: {
            type: 'replace_property',
            property: 'leadId',
            value: mine.humanActorId,
          },
        })
      ).status,
    ).toBe(200);

    const agentResponse = await send(app, {
      commandId: 'agent-project-lead',
      objectKind: 'project',
      objectIds: ids,
      operation: {
        type: 'replace_property',
        property: 'leadId',
        value: agent.id,
      },
    });
    expect(agentResponse.status).toBe(404);
    expect(agentResponse.headers.get('content-type')).toContain('application/problem+json');
    expect(await agentResponse.json()).toMatchObject({
      title: 'That item could not be found.',
      status: 404,
      code: 'not_found',
    });

    expect(
      (
        await send(app, {
          commandId: 'suspended-project-lead',
          objectKind: 'project',
          objectIds: ids,
          operation: {
            type: 'replace_property',
            property: 'leadId',
            value: suspendedHuman.id,
          },
        })
      ).status,
    ).toBe(404);

    const foreignResponse = await send(app, {
      commandId: 'foreign-human-project-lead',
      objectKind: 'project',
      objectIds: ids,
      operation: {
        type: 'replace_property',
        property: 'leadId',
        value: other.humanActorId,
      },
    });
    expect(foreignResponse.status).toBe(404);
    const rows = await db
      .select({ leadId: schema.project.leadId })
      .from(schema.project)
      .where(inArray(schema.project.id, ids));
    expect(rows).toHaveLength(2);
    expect(rows.every(({ leadId }) => leadId === mine.humanActorId)).toBe(true);
  });

  it('rejects a denied command without changing the object', async () => {
    const seeded = await seedBaseOrg(db, schema);
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Read only',
    });
    const reader = appWithActor(objectCommands, seeded.orgId, ['view'], seeded.humanActorId);
    const response = await send(reader, {
      commandId: 'denied-priority',
      objectKind: 'project',
      objectIds: [row.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    expect(response.status).toBe(404);
    const [unchanged] = await db
      .select({ priority: schema.project.priority })
      .from(schema.project)
      .where(eq(schema.project.id, row.id));
    expect(unchanged?.priority).toBe('none');
  });

  it('adds and removes Project labels with relation receipts', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Labeled',
    });
    const [label] = await db
      .insert(schema.label)
      .values({ organizationId: seeded.orgId, name: 'Canvas', color: 'blue' })
      .returning({ id: schema.label.id });
    if (!label) throw new Error('label insert returned no row');
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);

    const added = await send(app, {
      commandId: 'add-label',
      objectKind: 'project',
      objectIds: [row.id],
      operation: {
        type: 'add_association',
        association: 'label',
        associationIds: [label.id],
      },
    });
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({
      receipt: {
        entries: [
          {
            kind: 'relation',
            objectId: row.id,
            relation: 'label',
            relatedId: label.id,
            before: false,
            after: true,
          },
        ],
      },
    });
    expect(
      await db.select().from(schema.projectLabel).where(eq(schema.projectLabel.projectId, row.id)),
    ).toHaveLength(1);

    const removed = await send(app, {
      commandId: 'remove-label',
      objectKind: 'project',
      objectIds: [row.id],
      operation: {
        type: 'remove_association',
        association: 'label',
        associationIds: [label.id],
      },
    });
    expect(removed.status).toBe(200);
    expect(
      await db.select().from(schema.projectLabel).where(eq(schema.projectLabel.projectId, row.id)),
    ).toHaveLength(0);
  });

  it('preserves dependency direction and rejects cycle-closing and self edges', async () => {
    const seeded = await seedCommandOrg();
    const a = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'A',
    });
    const b = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'B',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);

    const added = await send(app, {
      commandId: 'add-dependency',
      objectKind: 'project',
      objectIds: [a.id, b.id],
      operation: { type: 'add_dependency', blockingId: a.id, blockedId: b.id },
    });
    expect(added.status).toBe(200);
    expect(await added.json()).toMatchObject({
      receipt: {
        entries: [
          {
            relation: 'dependency',
            objectId: a.id,
            relatedId: b.id,
            before: false,
            after: true,
          },
        ],
      },
    });
    expect(
      await db
        .select({
          blockingId: schema.projectDependency.blockingProjectId,
          blockedId: schema.projectDependency.blockedProjectId,
        })
        .from(schema.projectDependency)
        .where(eq(schema.projectDependency.organizationId, seeded.orgId)),
    ).toEqual([{ blockingId: a.id, blockedId: b.id }]);

    expect(
      (
        await send(app, {
          commandId: 'cycle-dependency',
          objectKind: 'project',
          objectIds: [a.id, b.id],
          operation: { type: 'add_dependency', blockingId: b.id, blockedId: a.id },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send(app, {
          commandId: 'self-dependency',
          objectKind: 'project',
          objectIds: [a.id],
          operation: { type: 'add_dependency', blockingId: a.id, blockedId: a.id },
        })
      ).status,
    ).toBe(422);
  });

  it('revalidates dependency cycles before replay recreates an edge', async () => {
    const seeded = await seedCommandOrg();
    const a = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Replay A',
    });
    const b = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Replay B',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const forward = await send(app, {
      commandId: 'forward-a-b',
      objectKind: 'project',
      objectIds: [a.id, b.id],
      operation: { type: 'add_dependency', blockingId: a.id, blockedId: b.id },
    });
    const forwardPayload = (await forward.json()) as { receipt: Record<string, unknown> };
    const undo = await send(app, {
      commandId: 'undo-a-b',
      direction: 'undo',
      receipt: forwardPayload.receipt,
    });
    expect(undo.status).toBe(200);
    expect(
      (
        await send(app, {
          commandId: 'forward-b-a',
          objectKind: 'project',
          objectIds: [a.id, b.id],
          operation: { type: 'add_dependency', blockingId: b.id, blockedId: a.id },
        })
      ).status,
    ).toBe(200);
    const replay = await send(app, {
      commandId: 'redo-a-b',
      direction: 'redo',
      receipt: forwardPayload.receipt,
    });
    expect(await replay.json()).toMatchObject({
      appliedIds: [],
      conflictingIds: [a.id],
      receipt: { entries: [] },
    });
    expect(
      await db
        .select({
          blockingId: schema.projectDependency.blockingProjectId,
          blockedId: schema.projectDependency.blockedProjectId,
        })
        .from(schema.projectDependency)
        .where(eq(schema.projectDependency.organizationId, seeded.orgId)),
    ).toEqual([{ blockingId: b.id, blockedId: a.id }]);
  });

  it('serializes concurrent opposite dependency edges so only one can commit', async () => {
    const seeded = await seedCommandOrg();
    const a = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Concurrent A',
    });
    const b = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Concurrent B',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const [first, second] = await Promise.all([
      send(app, {
        commandId: 'concurrent-a-b',
        objectKind: 'project',
        objectIds: [a.id, b.id],
        operation: { type: 'add_dependency', blockingId: a.id, blockedId: b.id },
      }),
      send(app, {
        commandId: 'concurrent-b-a',
        objectKind: 'project',
        objectIds: [a.id, b.id],
        operation: { type: 'add_dependency', blockingId: b.id, blockedId: a.id },
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(
      await db
        .select()
        .from(schema.projectDependency)
        .where(eq(schema.projectDependency.organizationId, seeded.orgId)),
    ).toHaveLength(1);
  });

  it('serializes concurrent Task date commands so they cannot commit an invalid window', async () => {
    const seeded = await seedCommandOrg();
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Concurrent date target',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!taskRow) throw new Error('task fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const [start, due] = await Promise.all([
      send(app, {
        commandId: 'concurrent-start-date',
        objectKind: 'task',
        objectIds: [taskRow.id],
        operation: { type: 'replace_property', property: 'startDate', value: '2026-09-05' },
      }),
      send(app, {
        commandId: 'concurrent-due-date',
        objectKind: 'task',
        objectIds: [taskRow.id],
        operation: { type: 'replace_property', property: 'dueDate', value: '2026-09-01' },
      }),
    ]);
    expect([start.status, due.status].filter((status) => status === 200)).toHaveLength(1);
    const [stored] = await db
      .select({ startDate: schema.task.startDate, dueDate: schema.task.dueDate })
      .from(schema.task)
      .where(eq(schema.task.id, taskRow.id));
    if (!stored) throw new Error('task disappeared during concurrent date update');
    expect(
      stored.startDate === null || stored.dueDate === null || stored.dueDate >= stored.startDate,
    ).toBe(true);
  });

  it('rechecks active state after a concurrent Task archive wins the row lock', async () => {
    const seeded = await seedCommandOrg();
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Concurrent archive target',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!taskRow) throw new Error('task fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const trash = send(app, {
      commandId: 'concurrent-archive',
      objectKind: 'task',
      objectIds: [taskRow.id],
      operation: { type: 'trash' },
    });
    const priority = send(app, {
      commandId: 'concurrent-archive-priority',
      objectKind: 'task',
      objectIds: [taskRow.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    const [trashResponse, priorityResponse] = await Promise.all([trash, priority]);
    expect(trashResponse.status).toBe(200);
    expect(priorityResponse.status).toBe(404);
    const [stored] = await db
      .select({ archivedAt: schema.task.archivedAt, priority: schema.task.priority })
      .from(schema.task)
      .where(eq(schema.task.id, taskRow.id));
    expect(stored?.archivedAt).not.toBeNull();
    expect(stored?.priority).toBe('none');
  });

  it('rejects self-parenting and descendant-parenting Task commands', async () => {
    const seeded = await seedCommandOrg();
    const [parent] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Parent',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!parent) throw new Error('task insert returned no row');
    const [child] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Child',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
        parentTaskId: parent.id,
      })
      .returning({ id: schema.task.id });
    if (!child) throw new Error('task insert returned no row');
    for (const taskId of [parent.id, child.id]) {
      await db.insert(schema.grant).values({
        organizationId: seeded.orgId,
        subjectKind: 'actor',
        subjectId: seeded.humanActorId,
        resourceKind: 'task',
        resourceId: taskId,
        capabilities: ['contribute'],
        effect: 'allow',
      });
    }
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);

    expect(
      (
        await send(app, {
          commandId: 'self-parent',
          objectKind: 'task',
          objectIds: [parent.id],
          operation: { type: 'change_parent', parentId: parent.id },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await send(app, {
          commandId: 'descendant-parent',
          objectKind: 'task',
          objectIds: [parent.id],
          operation: { type: 'change_parent', parentId: child.id },
        })
      ).status,
    ).toBe(409);
  });

  it('revalidates hierarchy cycles before replay restores a parent', async () => {
    const seeded = await seedCommandOrg();
    const inserted = await db
      .insert(schema.task)
      .values([
        {
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          title: 'Hierarchy A',
          state: 'backlog',
          statusId: seeded.statusId('task', 'backlog'),
        },
        {
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          title: 'Hierarchy B',
          state: 'backlog',
          statusId: seeded.statusId('task', 'backlog'),
        },
      ])
      .returning({ id: schema.task.id, title: schema.task.title });
    const a = inserted.find((item) => item.title === 'Hierarchy A');
    const b = inserted.find((item) => item.title === 'Hierarchy B');
    if (!a || !b) throw new Error('hierarchy fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const forward = await send(app, {
      commandId: 'parent-a-under-b',
      objectKind: 'task',
      objectIds: [a.id],
      operation: { type: 'change_parent', parentId: b.id },
    });
    const forwardPayload = (await forward.json()) as { receipt: Record<string, unknown> };
    expect(
      (
        await send(app, {
          commandId: 'undo-parent-a-under-b',
          direction: 'undo',
          receipt: forwardPayload.receipt,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send(app, {
          commandId: 'parent-b-under-a',
          objectKind: 'task',
          objectIds: [b.id],
          operation: { type: 'change_parent', parentId: a.id },
        })
      ).status,
    ).toBe(200);
    const replay = await send(app, {
      commandId: 'redo-parent-a-under-b',
      direction: 'redo',
      receipt: forwardPayload.receipt,
    });
    expect(await replay.json()).toMatchObject({
      appliedIds: [],
      conflictingIds: [a.id],
      receipt: { entries: [] },
    });
    const [first, second] = await db
      .select({ id: schema.task.id, parentTaskId: schema.task.parentTaskId })
      .from(schema.task)
      .where(
        and(eq(schema.task.organizationId, seeded.orgId), inArray(schema.task.id, [a.id, b.id])),
      );
    expect([first, second]).toEqual(
      expect.arrayContaining([
        { id: a.id, parentTaskId: null },
        { id: b.id, parentTaskId: a.id },
      ]),
    );
  });

  it('denies hierarchy replay after access to the target parent is lost', async () => {
    const seeded = await seedCommandOrg();
    const inserted = await db
      .insert(schema.task)
      .values([
        {
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          title: 'Access child',
          state: 'backlog',
          statusId: seeded.statusId('task', 'backlog'),
        },
        {
          organizationId: seeded.orgId,
          teamId: seeded.teamId,
          title: 'Access parent',
          state: 'backlog',
          statusId: seeded.statusId('task', 'backlog'),
        },
      ])
      .returning({ id: schema.task.id, title: schema.task.title });
    const child = inserted.find((item) => item.title === 'Access child');
    const parent = inserted.find((item) => item.title === 'Access parent');
    if (!child || !parent) throw new Error('hierarchy access fixture failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const forward = await send(app, {
      commandId: 'access-parent-forward',
      objectKind: 'task',
      objectIds: [child.id],
      operation: { type: 'change_parent', parentId: parent.id },
    });
    const forwardPayload = (await forward.json()) as { receipt: Record<string, unknown> };
    await send(app, {
      commandId: 'access-parent-undo',
      direction: 'undo',
      receipt: forwardPayload.receipt,
    });
    await db
      .delete(schema.grant)
      .where(
        and(
          eq(schema.grant.organizationId, seeded.orgId),
          eq(schema.grant.resourceKind, 'organization'),
        ),
      );
    await db.insert(schema.grant).values({
      organizationId: seeded.orgId,
      subjectKind: 'actor',
      subjectId: seeded.humanActorId,
      resourceKind: 'task',
      resourceId: child.id,
      capabilities: ['contribute'],
      effect: 'allow',
    });
    const replay = await send(app, {
      commandId: 'access-parent-redo',
      direction: 'redo',
      receipt: forwardPayload.receipt,
    });
    expect(await replay.json()).toMatchObject({ appliedIds: [], deniedIds: [child.id] });
  });

  it('replaces a Project timeframe and keeps its replay atomic when one field conflicts', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Dated',
      targetDate: new Date('2026-12-31T00:00:00.000Z'),
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);
    const changed = await send(app, {
      commandId: 'start-timeframe',
      objectKind: 'project',
      objectIds: [row.id],
      operation: {
        type: 'replace_property',
        property: 'startTimeframe',
        value: { date: '2026-04-01', resolution: 'quarter' },
      },
    });
    expect(changed.status).toBe(200);
    const result = (await changed.json()) as {
      receipt: { entries: { property: string }[] } & Record<string, unknown>;
    };
    expect(result.receipt.entries.map((entry) => entry.property)).toEqual([
      'startDate',
      'startDateResolution',
      'startDateFiscalYearStartMonth',
    ]);

    const invalid = await send(app, {
      commandId: 'bad-target-timeframe',
      objectKind: 'project',
      objectIds: [row.id],
      operation: {
        type: 'replace_property',
        property: 'targetTimeframe',
        value: { date: '2026-01-01', resolution: 'quarter' },
      },
    });
    expect(invalid.status).toBe(422);
    const [unchanged] = await db
      .select({ targetDate: schema.project.targetDate })
      .from(schema.project)
      .where(eq(schema.project.id, row.id));
    expect(unchanged?.targetDate?.toISOString()).toBe('2026-12-31T00:00:00.000Z');

    await db
      .update(schema.project)
      .set({ startDateResolution: 'month' })
      .where(eq(schema.project.id, row.id));
    const conflictedUndo = await send(app, {
      commandId: 'undo-start-timeframe',
      direction: 'undo',
      receipt: result.receipt,
    });
    expect(conflictedUndo.status, JSON.stringify(result.receipt)).toBe(200);
    expect(await conflictedUndo.json()).toMatchObject({
      appliedIds: [],
      conflictingIds: [row.id],
      receipt: { entries: [] },
    });
    const [stillDated] = await db
      .select({
        startDate: schema.project.startDate,
        startDateResolution: schema.project.startDateResolution,
      })
      .from(schema.project)
      .where(eq(schema.project.id, row.id));
    expect(stillDated?.startDate?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(stillDated?.startDateResolution).toBe('month');
  });

  it('rejects selections larger than 500 before entering the handler', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Bounded',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);
    const response = await send(app, {
      commandId: 'too-many',
      objectKind: 'project',
      objectIds: Array.from({ length: 501 }, () => row.id),
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    expect(response.status).toBe(422);
  });

  it('accepts the 5,000 generated-change budget and rejects one change over it', async () => {
    const seeded = await seedCommandOrg();
    const ids = (prefix: string, length: number) =>
      Array.from(
        { length },
        (_, index) => `${prefix.slice(0, 22)}${String(index).padStart(4, '0')}`,
      );
    const objectIds = ids('01ARZ3NDEKTSV4RRFFQ69G5FAV', 500);
    const associationIds = ids('01BRZ3NDEKTSV4RRFFQ69G5FAV', 11);
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const accepted = await send(app, {
      commandId: 'max-generated-change-budget',
      objectKind: 'project',
      objectIds,
      operation: {
        type: 'add_association',
        association: 'initiative',
        associationIds: associationIds.slice(0, 10),
      },
    });
    expect(accepted.status).toBe(404);
    const rejected = await send(app, {
      commandId: 'over-generated-change-budget',
      objectKind: 'project',
      objectIds,
      operation: {
        type: 'add_association',
        association: 'initiative',
        associationIds,
      },
    });
    expect(rejected.status).toBe(422);
  });

  it('rejects an oversized object-command body before schema handling', async () => {
    const seeded = await seedCommandOrg();
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const response = await send(app, {
      commandId: 'oversized-object-command',
      objectKind: 'project',
      objectIds: ['01ARZ3NDEKTSV4RRFFQ69G5FAV'],
      operation: { type: 'trash' },
      padding: 'x'.repeat(4 * 1024 * 1024),
    });
    expect(response.status).toBe(413);
  });

  it('does not overwrite a collaborator update racing a replay', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Concurrent replay target',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const forward = await send(app, {
      commandId: 'concurrent-replay-forward',
      objectKind: 'project',
      objectIds: [row.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    const payload = (await forward.json()) as { receipt: Record<string, unknown> };
    const [replay] = await Promise.all([
      send(app, {
        commandId: 'concurrent-replay-undo',
        direction: 'undo',
        receipt: payload.receipt,
      }),
      db.update(schema.project).set({ priority: 'urgent' }).where(eq(schema.project.id, row.id)),
    ]);
    expect(replay.status).toBe(200);
    const replayPayload = (await replay.json()) as {
      appliedIds: string[];
      conflictingIds: string[];
    };
    expect(
      replayPayload.appliedIds.includes(row.id) || replayPayload.conflictingIds.includes(row.id),
    ).toBe(true);
    const [stored] = await db
      .select({ priority: schema.project.priority })
      .from(schema.project)
      .where(eq(schema.project.id, row.id));
    expect(stored?.priority).toBe('urgent');
  });

  it('replays the same successful command through the shared idempotency middleware', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Retry safe',
    });
    const wrapped = new Hono<AppEnv>();
    wrapped.use('*', idempotency);
    wrapped.route('/', objectCommands);
    const app = appWithActor(
      wrapped,
      seeded.orgId,
      ['contribute'],
      seeded.humanActorId,
      fakeSession(`retry-user-${row.id}`),
    );
    const body = {
      commandId: `retry-${row.id}`,
      objectKind: 'project',
      objectIds: [row.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    };

    const first = await send(app, body);
    const firstPayload = await first.json();
    const retry = await send(app, body);
    expect(retry.status).toBe(200);
    expect(retry.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await retry.json()).toEqual(firstPayload);
    expect(
      await db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, seeded.orgId)),
    ).toHaveLength(1);
  });

  it('recovers a committed command when the response path fails after the handler', async () => {
    const seeded = await seedCommandOrg();
    const row = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Committed before response failure',
    });
    let breakGenericResponseRecording = true;
    const wrapped = new Hono<AppEnv>();
    wrapped.use('*', idempotency);
    wrapped.use('*', async (c, next) => {
      await next();
      if (!breakGenericResponseRecording) return;
      breakGenericResponseRecording = false;
      c.res = new Response('{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    wrapped.route('/', objectCommands);
    const app = appWithActor(
      wrapped,
      seeded.orgId,
      ['contribute'],
      seeded.humanActorId,
      fakeSession(`atomic-retry-user-${row.id}`),
    );
    const body = {
      commandId: `atomic-retry-${row.id}`,
      objectKind: 'project',
      objectIds: [row.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    };

    await send(app, body);
    const retry = await send(app, body);
    expect(retry.status).toBe(200);
    expect(retry.headers.get('Idempotency-Replayed')).toBe('true');
    const [stored] = await db
      .select({ priority: schema.project.priority })
      .from(schema.project)
      .where(eq(schema.project.id, row.id));
    expect(stored?.priority).toBe('high');
    expect(
      await db
        .select()
        .from(schema.changeSet)
        .where(eq(schema.changeSet.organizationId, seeded.orgId)),
    ).toHaveLength(1);
  });

  it('moves a Task to trash and restores it without losing its Project link', async () => {
    const seeded = await seedCommandOrg();
    const projectRow = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Task home',
    });
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Recoverable task',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
        projectId: projectRow.id,
      })
      .returning({ id: schema.task.id });
    if (!taskRow) throw new Error('task insert returned no row');
    await db.insert(schema.grant).values({
      organizationId: seeded.orgId,
      subjectKind: 'actor',
      subjectId: seeded.humanActorId,
      resourceKind: 'task',
      resourceId: taskRow.id,
      capabilities: ['contribute'],
      effect: 'allow',
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);

    expect(
      (
        await send(app, {
          commandId: 'trash-task',
          objectKind: 'task',
          objectIds: [taskRow.id],
          operation: { type: 'trash' },
        })
      ).status,
    ).toBe(200);
    let [stored] = await db
      .select({ archivedAt: schema.task.archivedAt, projectId: schema.task.projectId })
      .from(schema.task)
      .where(eq(schema.task.id, taskRow.id));
    expect(stored?.archivedAt).not.toBeNull();
    expect(stored?.projectId).toBe(projectRow.id);

    expect(
      (
        await send(app, {
          commandId: 'restore-task',
          objectKind: 'task',
          objectIds: [taskRow.id],
          operation: { type: 'restore' },
        })
      ).status,
    ).toBe(200);
    [stored] = await db
      .select({ archivedAt: schema.task.archivedAt, projectId: schema.task.projectId })
      .from(schema.task)
      .where(eq(schema.task.id, taskRow.id));
    expect(stored).toMatchObject({ archivedAt: null, projectId: projectRow.id });
  });

  it('publishes canonical Task and Project status consequences after commit', async () => {
    const seeded = await seedCommandOrg();
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Side-effect task',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    const projectRow = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Side-effect Project',
    });
    if (!taskRow) throw new Error('task fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    expect(
      (
        await send(app, {
          commandId: 'task-status-side-effects',
          objectKind: 'task',
          objectIds: [taskRow.id],
          operation: { type: 'replace_property', property: 'state', value: 'done' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send(app, {
          commandId: 'project-status-side-effects',
          objectKind: 'project',
          objectIds: [projectRow.id],
          operation: { type: 'replace_property', property: 'status', value: 'active' },
        })
      ).status,
    ).toBe(200);
    await flushDeferredWork();
    expect(
      await db
        .select({ type: schema.auditEvent.type })
        .from(schema.auditEvent)
        .where(eq(schema.auditEvent.subjectId, taskRow.id)),
    ).not.toEqual([]);
    expect(
      await db
        .select({ kind: schema.event.kind })
        .from(schema.event)
        .where(inArray(schema.event.docketEntityId, [taskRow.id, projectRow.id])),
    ).toEqual(expect.arrayContaining([{ kind: 'completed' }, { kind: 'status_change' }]));
  });

  it('records Task property and replay changes and emits canonical assignment events', async () => {
    const seeded = await seedCommandOrg();
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        title: 'Property consequence task',
        state: 'backlog',
        statusId: seeded.statusId('task', 'backlog'),
      })
      .returning({ id: schema.task.id });
    if (!taskRow) throw new Error('task fixture insert failed');
    const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
    const priority = await send(app, {
      commandId: 'task-priority-consequences',
      objectKind: 'task',
      objectIds: [taskRow.id],
      operation: { type: 'replace_property', property: 'priority', value: 'high' },
    });
    const priorityPayload = (await priority.json()) as { receipt: Record<string, unknown> };
    expect(priority.status).toBe(200);
    expect(
      (
        await send(app, {
          commandId: 'task-assignee-consequences',
          objectKind: 'task',
          objectIds: [taskRow.id],
          operation: {
            type: 'replace_property',
            property: 'assigneeId',
            value: seeded.humanActorId,
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await send(app, {
          commandId: 'task-priority-consequences-undo',
          direction: 'undo',
          receipt: priorityPayload.receipt,
        })
      ).status,
    ).toBe(200);
    await flushDeferredWork();

    const audit = await db
      .select({ metadata: schema.auditEvent.metadata })
      .from(schema.auditEvent)
      .where(eq(schema.auditEvent.subjectId, taskRow.id));
    expect(audit.map((row) => row.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'priority', from: 'None', to: 'High' }),
        expect.objectContaining({ field: 'priority', from: 'High', to: 'None' }),
        expect.objectContaining({ field: 'assigneeId', to: 'Ada' }),
      ]),
    );
    const events = await db
      .select({ kind: schema.event.kind, detail: schema.event.detail })
      .from(schema.event)
      .where(eq(schema.event.docketEntityId, taskRow.id));
    expect(events.map((row) => row.kind)).toContain('assignment');
    expect(
      events
        .filter((row) => row.kind === 'field_change')
        .map((row) => (row.detail as { fields: string[] }).fields),
    ).toEqual(expect.arrayContaining([['priority'], ['priority']]));
  });

  it('announces property, association, and replay writes through the entity-write seam', async () => {
    const writes: EntityWriteEvent[] = [];
    setEntityWriteBus(
      new EntityWriteBus().subscribe({
        name: 'object-command-test',
        handle: async (event) => {
          writes.push(event);
        },
      }),
    );
    try {
      const seeded = await seedCommandOrg();
      const projectRow = await seedProject(db, schema, seeded.statusId, {
        organizationId: seeded.orgId,
        teamId: seeded.teamId,
        createdBy: seeded.humanActorId,
        name: 'Indexed Project',
      });
      const [labelRow] = await db
        .insert(schema.label)
        .values({ organizationId: seeded.orgId, name: 'Indexed', color: 'blue' })
        .returning({ id: schema.label.id });
      if (!labelRow) throw new Error('label fixture insert failed');
      const app = appWithActor(objectCommands, seeded.orgId, ['manage'], seeded.humanActorId);
      const property = await send(app, {
        commandId: 'indexed-property',
        objectKind: 'project',
        objectIds: [projectRow.id],
        operation: { type: 'replace_property', property: 'priority', value: 'high' },
      });
      const propertyPayload = (await property.json()) as { receipt: Record<string, unknown> };
      expect(
        (
          await send(app, {
            commandId: 'indexed-label',
            objectKind: 'project',
            objectIds: [projectRow.id],
            operation: {
              type: 'add_association',
              association: 'label',
              associationIds: [labelRow.id],
            },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await send(app, {
            commandId: 'indexed-property-undo',
            direction: 'undo',
            receipt: propertyPayload.receipt,
          })
        ).status,
      ).toBe(200);
      await flushDeferredWork();
      expect(writes.filter((event) => event.entityId === projectRow.id)).toHaveLength(3);
      expect(writes.every((event) => event.operation === 'upsert')).toBe(true);
    } finally {
      setEntityWriteBus(undefined);
      await flushDeferredWork();
    }
  });

  it('receipts and undoes only newly added Project Initiative associations', async () => {
    const seeded = await seedCommandOrg();
    const existingProject = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'Existing contributor',
    });
    const newProject = await seedProject(db, schema, seeded.statusId, {
      organizationId: seeded.orgId,
      teamId: seeded.teamId,
      createdBy: seeded.humanActorId,
      name: 'New contributor',
    });
    const [initiativeRow] = await db
      .insert(schema.initiative)
      .values({
        organizationId: seeded.orgId,
        name: 'Initiative',
        status: 'active',
        statusId: seeded.statusId('initiative', 'active'),
        createdBy: seeded.humanActorId,
      })
      .returning({ id: schema.initiative.id });
    if (!initiativeRow) throw new Error('initiative insert returned no row');
    await db.insert(schema.initiativeProject).values({
      organizationId: seeded.orgId,
      initiativeId: initiativeRow.id,
      projectId: existingProject.id,
    });
    const app = appWithActor(objectCommands, seeded.orgId, ['contribute'], seeded.humanActorId);
    const response = await send(app, {
      commandId: 'add-initiative',
      objectKind: 'project',
      objectIds: [existingProject.id, newProject.id],
      operation: {
        type: 'add_association',
        association: 'initiative',
        associationIds: [initiativeRow.id],
      },
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      receipt: { entries: { objectId: string; relatedId: string }[] } & Record<string, unknown>;
    };
    expect(payload.receipt.entries).toEqual([
      expect.objectContaining({ objectId: newProject.id, relatedId: initiativeRow.id }),
    ]);
    const undo = await send(app, {
      commandId: 'undo-add-initiative',
      direction: 'undo',
      receipt: payload.receipt,
    });
    expect(undo.status).toBe(200);
    expect(
      await db
        .select({ projectId: schema.initiativeProject.projectId })
        .from(schema.initiativeProject)
        .where(eq(schema.initiativeProject.initiativeId, initiativeRow.id)),
    ).toEqual([{ projectId: existingProject.id }]);
  });
});

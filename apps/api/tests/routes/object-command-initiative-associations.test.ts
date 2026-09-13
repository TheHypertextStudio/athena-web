import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type objectCommandsRouter from '../../src/routes/object-commands';
import { appWithActor, getDb, seedProject, seedTaskAccessOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let objectCommands!: typeof objectCommandsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  objectCommands = (await import('../../src/routes/object-commands')).default;
});

async function send(body: Record<string, unknown>): Promise<Response> {
  const orgId = String(body['organizationId']);
  const actorId = String(body['actorId']);
  return appWithActor(objectCommands, orgId, ['contribute'], actorId).request('/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Idempotency-Key': String(body['commandId']),
    },
    body: JSON.stringify(body['command']),
  });
}

describe('object command Initiative associations', () => {
  it('receipts and undoes only newly added Project Initiative associations', async () => {
    const seeded = await seedTaskAccessOrg(db, schema, 'manage');
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
    const command = {
      commandId: 'add-initiative',
      objectKind: 'project',
      objectIds: [existingProject.id, newProject.id],
      operation: {
        type: 'add_association',
        association: 'initiative',
        associationIds: [initiativeRow.id],
      },
    };
    const response = await send({
      organizationId: seeded.orgId,
      actorId: seeded.humanActorId,
      commandId: command.commandId,
      command,
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      receipt: { entries: { objectId: string; relatedId: string }[] } & Record<string, unknown>;
    };
    expect(payload.receipt.entries).toEqual([
      expect.objectContaining({ objectId: newProject.id, relatedId: initiativeRow.id }),
    ]);
    const undoCommand = {
      commandId: 'undo-add-initiative',
      direction: 'undo',
      receipt: payload.receipt,
    };
    const undo = await send({
      organizationId: seeded.orgId,
      actorId: seeded.humanActorId,
      commandId: undoCommand.commandId,
      command: undoCommand,
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

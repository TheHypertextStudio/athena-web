/**
 * Connected work names the Program each Project is filed under, so an Initiative page can group
 * them without a second roster read.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import {
  appWithAuthenticatedActor,
  getDb,
  seedBaseOrg,
  seedStatuses,
} from '../support/routes-harness';
import type initiativesRouter from '../../src/routes/initiatives';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let initiatives!: typeof initiativesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  initiatives = (await import('../../src/routes/initiatives')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Mount the Initiative router with the seeded actor's linked Better Auth identity. */
async function authenticatedInitiativesApp(
  orgId: string,
  capabilities: readonly string[],
  actorId: string,
): ReturnType<typeof appWithAuthenticatedActor> {
  return appWithAuthenticatedActor(db, schema, initiatives, orgId, capabilities, actorId);
}

/** Create an initiative row directly in the db and return its id. */
async function seedInitiative(orgId: string, createdBy: string): Promise<string> {
  const statusId = await seedStatuses(db, schema, orgId);
  const [row] = await db
    .insert(schema.initiative)
    .values({
      organizationId: orgId,
      name: 'Theme',
      createdBy,
      status: 'active',
      statusId: statusId('initiative', 'active'),
    })
    .returning({ id: schema.initiative.id });
  return assertDefined(row).id;
}

/** Create a project row directly in the db and return its id. */
async function seedProject(orgId: string, createdBy: string, name: string): Promise<string> {
  const statusId = await seedStatuses(db, schema, orgId);
  const [row] = await db
    .insert(schema.project)
    .values({
      organizationId: orgId,
      name,
      createdBy,
      status: 'planned',
      statusId: statusId('project', 'planned'),
    })
    .returning({ id: schema.project.id });
  return assertDefined(row).id;
}

/** Create a program row directly in the db and return its id. */
async function seedProgram(orgId: string, createdBy: string, name: string): Promise<string> {
  const statusId = await seedStatuses(db, schema, orgId);
  const [row] = await db
    .insert(schema.program)
    .values({
      organizationId: orgId,
      name,
      createdBy,
      status: 'active',
      statusId: statusId('program', 'active'),
    })
    .returning({ id: schema.program.id });
  return assertDefined(row).id;
}

describe('initiative connected work', () => {
  it('names the Program holding each connected Project so a reader can group them', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = await authenticatedInitiativesApp(orgId, ['contribute'], humanActorId);
    const initiativeId = await seedInitiative(orgId, humanActorId);
    const programId = await seedProgram(orgId, humanActorId, 'Platform');
    const filedProjectId = await seedProject(orgId, humanActorId, 'Fare policy');
    const looseProjectId = await seedProject(orgId, humanActorId, 'Signage audit');
    await db.update(schema.project).set({ programId }).where(eq(schema.project.id, filedProjectId));
    await db.insert(schema.initiativeProject).values(
      [filedProjectId, looseProjectId].map((projectId) => ({
        organizationId: orgId,
        initiativeId,
        projectId,
      })),
    );
    await db
      .insert(schema.initiativeProgram)
      .values({ organizationId: orgId, initiativeId, programId });

    const relationships = await json<{
      connectedWork: { id: string; kind: string; programId: string | null }[];
    }>(await writer.request(`/${initiativeId}/relationships`));
    const aggregate = await json<{
      connectedWork: { id: string; kind: string; programId: string | null }[];
    }>(await writer.request(`/${initiativeId}/aggregate`));

    for (const projection of [relationships, aggregate]) {
      const byId = new Map(projection.connectedWork.map((row) => [row.id, row]));
      expect(byId.get(filedProjectId)).toMatchObject({ kind: 'project', programId });
      expect(byId.get(looseProjectId)).toMatchObject({ kind: 'project', programId: null });
      // A Program is the container, never contained: grouping by its own id would nest it in itself.
      expect(byId.get(programId)).toMatchObject({ kind: 'program', programId: null });
    }
  });
});

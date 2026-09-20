import { eq } from 'drizzle-orm';
import { beforeAll, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';

let schema: typeof DbModule;
let integrations: unknown;
beforeAll(async () => {
  schema = await getDb();
  integrations = (await import('../../src/routes/integrations')).default;
});

it('keeps personal identity corrections available without granting paid connector operations', async () => {
  const { orgId, humanActorId } = await seedBaseOrg(schema.db, schema, false);
  await schema.db
    .update(schema.organization)
    .set({ isPersonal: true })
    .where(eq(schema.organization.id, orgId));
  const connection = assertDefined(
    (
      await schema.db
        .insert(schema.integration)
        .values({
          organizationId: orgId,
          provider: 'linear',
          pattern: 'connector',
          roles: ['work'],
        })
        .returning()
    )[0],
  );
  const identity = assertDefined(
    (
      await schema.db
        .insert(schema.externalActor)
        .values({
          organizationId: orgId,
          integrationId: connection.id,
          externalId: 'sam',
          displayName: 'Sam',
        })
        .returning()
    )[0],
  );
  const manager = appWithActor(integrations, orgId, ['manage'], humanActorId);
  const path = `/${connection.id}/external-actors/${identity.id}`;
  expect((await manager.request(`${path}/candidates`)).status).toBe(200);
  expect(
    (
      await manager.request(`${path}/resolution`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'match_existing', actorId: humanActorId }),
      })
    ).status,
  ).toBe(200);
  expect((await manager.request(`/${connection.id}/sync`, { method: 'POST' })).status).toBe(402);
  const viewer = appWithActor(integrations, orgId, ['view'], humanActorId);
  expect((await viewer.request(`${path}/candidates`)).status).toBe(403);
});

import { assertDefined } from '@docket/test-utils';
import { beforeAll, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { encodeIdCursor } from '../../src/lib/list-cursor';
import { archiveLegacyDefinition } from '../../src/lib/recurrence/legacy-definition-archive';
import {
  appendCanonicalPrivateDefinition,
  createCanonicalPrivateDefinition,
} from '../../src/lib/recurrence/private-definition-publication';
import {
  createPublishedProcessDefinition,
  loadProcessDefinitionDetail,
} from '../../src/lib/recurrence/process-definition';
import {
  listProcessDefinitions,
  updateProcessDefinitionMetadata,
} from '../../src/lib/recurrence/process-definition-metadata';
import {
  getPrivatePublicationDb,
  requiredPrivateRow,
  seedPrivatePublicationActor,
} from '../support/private-publication-fixture';

let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getPrivatePublicationDb();
});
async function fixture() {
  const actor = await seedPrivatePublicationActor(schema.db, schema);
  const definition = ProcessDefinitionCreate.parse({
    name: 'Private picker definition',
    tasks: [{ key: 'original-key', title: 'Exact {month}', teamId: actor.teamId }],
  });
  return { ...actor, definition, organizationId: actor.orgId, actorId: actor.humanActorId };
}

it('lists canonical-only and retained definitions once and reopens exact current publication after append and rename', async () => {
  const f = await fixture();
  const retained = await createPublishedProcessDefinition(schema.db, f);
  const canonical = await createCanonicalPrivateDefinition(schema.db, f);
  const input = { ...f, definitionId: canonical.definitionId };
  const appended = await appendCanonicalPrivateDefinition(schema.db, {
    ...input,
    definition: ProcessDefinitionCreate.parse({
      ...f.definition,
      tasks: [{ ...f.definition.tasks[0], title: 'Appended {unknown}' }],
    }),
  });
  const detail = await updateProcessDefinitionMetadata(schema.db, {
    ...input,
    patch: { name: 'Renamed in the picker' },
  });
  expect(detail).toMatchObject({
    id: canonical.definitionId,
    name: 'Renamed in the picker',
    revision: {
      id: appended.revisionId,
      number: 2,
      tasks: [{ key: 'original-key', title: 'Appended {unknown}' }],
    },
  });
  expect(
    await loadProcessDefinitionDetail(schema.db, f.orgId, canonical.definitionId, f.actorId),
  ).toEqual(detail);
  const listed = await listProcessDefinitions(schema.db, f.orgId, { limit: 20 }, f.actorId);
  expect(listed.map((row) => row.id)).toEqual(
    [retained.definitionId, canonical.definitionId].sort(),
  );
  expect(listed.find((row) => row.id === canonical.definitionId)).toMatchObject({
    name: 'Renamed in the picker',
    latestRevisionNumber: 2,
    status: 'published',
  });
  expect(new Set(Object.values(appended.stepIdsByKey)).size).toBe(1);
  expect(appended.stepIdsByKey['original-key']).not.toBe(canonical.stepIdsByKey['original-key']);
});

it('seeks a merged identifier cursor, omits archived heads and never restores access through retained metadata', async () => {
  const f = await fixture();
  const first = await createPublishedProcessDefinition(schema.db, f);
  const second = await createCanonicalPrivateDefinition(schema.db, f);
  const archived = await createCanonicalPrivateDefinition(schema.db, f);
  await archiveLegacyDefinition(
    schema.db,
    { ...f, definitionId: archived.definitionId },
    new Date(),
  );
  const ids = [first.definitionId, second.definitionId].sort();
  const page = await listProcessDefinitions(
    schema.db,
    f.orgId,
    { limit: 1, cursor: encodeIdCursor(assertDefined(ids[0])) },
    f.actorId,
  );
  expect(page.map((row) => row.id)).toEqual(ids.slice(1));
  await schema.db.delete(schema.grant).where(eq(schema.grant.subjectId, f.actorId));
  expect(await listProcessDefinitions(schema.db, f.orgId, { limit: 20 }, f.actorId)).toEqual([]);
  await expect(
    loadProcessDefinitionDetail(schema.db, f.orgId, second.definitionId, f.actorId),
  ).rejects.toThrow();
});

it('does not disclose another owner private definitions to a current workspace viewer', async () => {
  const f = await fixture();
  await createCanonicalPrivateDefinition(schema.db, f);
  await createPublishedProcessDefinition(schema.db, f);
  const viewer = requiredPrivateRow(
    await schema.db
      .insert(schema.actor)
      .values({ organizationId: f.orgId, kind: 'human', displayName: 'Viewer' })
      .returning(),
  );
  await schema.db.insert(schema.grant).values({
    organizationId: f.orgId,
    subjectKind: 'actor',
    subjectId: viewer.id,
    resourceKind: 'organization',
    resourceId: f.orgId,
    capabilities: ['view'],
    effect: 'allow',
    cascades: true,
  });
  expect(await listProcessDefinitions(schema.db, f.orgId, { limit: 20 }, viewer.id)).toEqual([]);
});

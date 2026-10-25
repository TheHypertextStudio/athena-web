import { beforeAll, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import {
  createCanonicalPrivateDefinition,
  appendCanonicalPrivateDefinition,
} from '../../src/lib/recurrence/private-definition-publication';
import {
  canonicalDefinitionDetail,
  updateCanonicalDefinitionMetadata,
} from '../../src/lib/recurrence/canonical-definition';
import { rawResultRows } from '../../src/lib/raw-result';
import {
  getPrivatePublicationDb as getDb,
  requiredPrivateRow as one,
  seedPrivatePublicationActor,
} from '../support/private-publication-fixture';
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
async function oldCounts() {
  return rawResultRows(
    await schema.db.execute(
      sql`select (select count(*) from process_definition)::integer definitions,(select count(*) from process_revision)::integer revisions,(select count(*) from process_step)::integer steps,(select count(*) from process_task_spec)::integer tasks,(select count(*) from work_template_blueprint_conversion)::integer conversions,(select count(*) from template)::integer templates`,
    ),
  );
}
async function fixture() {
  const base = await seedPrivatePublicationActor(schema.db, schema);
  return {
    ...base,
    definition: ProcessDefinitionCreate.parse({
      name: 'Private authored repeat',
      tasks: [
        {
          key: 'one',
          title: 'Task {month}',
          description: 'Private\n\n',
          teamId: base.teamId,
          timing: { kind: 'relative_to_trigger', offsetDays: -2 },
          dueOffsetDays: 4,
        },
      ],
    }),
  };
}
it('publishes, reads and appends exact canonical-only private revisions while metadata rename stays independent', async () => {
  const f = await fixture(),
    before = await oldCounts();
  const first = await createCanonicalPrivateDefinition(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definition: f.definition,
  });
  expect(first.revisionNumber).toBe(1);
  expect(await oldCounts()).toEqual(before);
  const input = {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definitionId: first.definitionId,
  };
  const detail = await canonicalDefinitionDetail(schema.db, input);
  expect(detail?.revision.tasks[0]).toMatchObject({
    key: 'one',
    title: 'Task {month}',
    description: 'Private\n\n',
    dueOffsetDays: 4,
    timing: { kind: 'relative_to_trigger', offsetDays: -2 },
  });
  expect(
    await updateCanonicalDefinitionMetadata(schema.db, input, { name: 'Renamed private head' }),
  ).toBe(true);
  const second = await appendCanonicalPrivateDefinition(schema.db, {
    ...input,
    definition: ProcessDefinitionCreate.parse({
      ...f.definition,
      tasks: [{ ...f.definition.tasks[0], title: 'Future {month}' }],
    }),
  });
  expect(second.revisionNumber).toBe(2);
  expect(second.stepIdsByKey['one']).not.toBe(first.stepIdsByKey['one']);
  expect(await oldCounts()).toEqual(before);
  const head = one(
    await schema.db
      .select()
      .from(schema.invocationHead)
      .where(eq(schema.invocationHead.id, first.definitionId)),
  );
  expect(head.canonicalAuthoringAt).not.toBeNull();
  expect((await canonicalDefinitionDetail(schema.db, input))?.revision.tasks[0]?.title).toBe(
    'Future {month}',
  );
});
it('rejects an invalid current tenant reference before any private head or source publication persists', async () => {
  const f = await fixture(),
    foreign = await fixture();
  const before = await schema.db
    .select()
    .from(schema.invocationHead)
    .where(eq(schema.invocationHead.organizationId, f.orgId));
  await expect(
    createCanonicalPrivateDefinition(schema.db, {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      definition: ProcessDefinitionCreate.parse({
        ...f.definition,
        tasks: [{ ...f.definition.tasks[0], teamId: foreign.teamId }],
      }),
    }),
  ).rejects.toThrow();
  expect(
    await schema.db
      .select()
      .from(schema.invocationHead)
      .where(eq(schema.invocationHead.organizationId, f.orgId)),
  ).toEqual(before);
});
it('requires the current actor and private head permission before appending or reading authored bodies', async () => {
  const f = await fixture(),
    other = await fixture();
  const first = await createCanonicalPrivateDefinition(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definition: f.definition,
  });
  await expect(
    appendCanonicalPrivateDefinition(schema.db, {
      organizationId: f.orgId,
      actorId: other.humanActorId,
      definitionId: first.definitionId,
      definition: f.definition,
    }),
  ).rejects.toThrow();
  await expect(
    canonicalDefinitionDetail(schema.db, {
      organizationId: other.orgId,
      actorId: other.humanActorId,
      definitionId: first.definitionId,
    }),
  ).rejects.toThrow();
});

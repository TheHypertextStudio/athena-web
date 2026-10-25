import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import { eq, sql } from 'drizzle-orm';
import { ProcessDefinitionCreate } from '../../src/contracts/recurrence';
import { createCanonicalPrivateDefinition } from '../../src/lib/recurrence/private-definition-publication';
import {
  loadCanonicalPrivatePublication,
  requireCanonicalPrivatePublication,
  bindCanonicalPrivateSchedule,
} from '../../src/lib/recurrence/private-definition-binding';
import {
  getPrivatePublicationDb as getDb,
  requiredPrivateRow as one,
  seedPrivatePublicationActor,
} from '../support/private-publication-fixture';
vi.mock('../support/db', () => ({ getMigratedDb: async () => await import('@docket/db') }));
let schema: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
  expect(process.env['DATABASE_URL']).toMatch(/^postgres(?:ql)?:/);
});
afterAll(async () => {
  const database = await import('@docket/db');
  await database.closeDb();
});
async function fixture() {
  const f = await seedPrivatePublicationActor(schema.db, schema);
  const definition = ProcessDefinitionCreate.parse({
    name: 'Private checked publication',
    tasks: [
      { key: 'one', title: 'Task {month}', description: 'Private original', teamId: f.teamId },
    ],
  });
  const published = await createCanonicalPrivateDefinition(schema.db, {
    organizationId: f.orgId,
    actorId: f.humanActorId,
    definition,
  });
  return { ...f, published };
}
it('binds only actual same-transaction/caller publication evidence and keeps returned descriptions from changing authority', async () => {
  const f = await fixture(),
    input = {
      organizationId: f.orgId,
      actorId: f.humanActorId,
      definitionId: f.published.definitionId,
    },
    caller = { orgId: f.orgId, actorId: f.humanActorId };
  const saved = await schema.db.transaction(async (tx) => {
    const binding = await loadCanonicalPrivatePublication(tx, input);
    expect(() => bindCanonicalPrivateSchedule(tx, caller, { ...binding }, 'UTC')).toThrow();
    expect(() =>
      bindCanonicalPrivateSchedule(tx, { ...caller, actorId: schema.genId() }, binding, 'UTC'),
    ).toThrow();
    const description = requireCanonicalPrivatePublication(tx, caller, binding);
    if (!description.document.roots[0]?.root) throw new Error('Missing private root');
    description.document.roots[0].root.fields.description = 'Forged description';
    const schedule = bindCanonicalPrivateSchedule(tx, caller, binding, 'America/Los_Angeles');
    expect(schedule.roots[0]?.draft.root.fields.description).toBe('Private original');
    expect(schedule.titles[0]?.pattern).toBe('Task {month}');
    return binding;
  });
  await expect(
    schema.db.transaction(async (tx) => bindCanonicalPrivateSchedule(tx, caller, saved, 'UTC')),
  ).rejects.toThrow();
});
it('rejects independently recompiled forged private fields despite a valid SQL shape and matching payload hash', async () => {
  const f = await fixture();
  const original = one(
    await schema.db
      .select()
      .from(schema.invocationRevision)
      .where(eq(schema.invocationRevision.id, f.published.revisionId)),
  );
  const invocation = one(
    await schema.db
      .select()
      .from(schema.blueprintInvocation)
      .where(eq(schema.blueprintInvocation.id, original.invocationId)),
  );
  if (invocation.manifest.kind !== 'private_definition')
    throw new Error('Missing private document');
  const document = structuredClone(invocation.manifest),
    head = schema.genId(),
    revision = schema.genId(),
    id = schema.genId();
  document.authoring.definitionAlias = head;
  document.authoring.revisionAlias = revision;
  if (!document.roots[0]?.root) throw new Error('Missing private root');
  document.roots[0].root.fields.description = 'Forged description';
  for (const mapping of document.sourceMappings) mapping.alias = schema.genId();
  await schema.db.transaction(async (tx) => {
    await tx.insert(schema.invocationHead).values({
      id: head,
      organizationId: f.orgId,
      ownerActorId: f.humanActorId,
      name: 'Valid shape, forged fields',
    });
    await tx.insert(schema.blueprintInvocation).values({
      id,
      organizationId: f.orgId,
      ownerActorId: f.humanActorId,
      manifest: document,
      overrides: [],
    });
    await tx.insert(schema.invocationRevision).values({
      id: revision,
      organizationId: f.orgId,
      headId: head,
      invocationId: id,
      number: 1,
      state: 'published',
      creationMode: 'all_at_once',
      origin: 'authored',
      authoredPayloadHash: schema.hashScheduleArchive(document),
      projection: sql`docket_authored_invocation_projection(${JSON.stringify(document)}::jsonb)`,
      createdAt: new Date(),
      publishedAt: new Date(),
    });
    await tx
      .update(schema.invocationHead)
      .set({
        status: 'published',
        publishedInvocationId: id,
        draftInvocationId: id,
        canonicalAuthoringAt: new Date(),
        revision: 2,
      })
      .where(eq(schema.invocationHead.id, head));
  });
  await expect(
    schema.db.transaction((tx) =>
      loadCanonicalPrivatePublication(tx, {
        organizationId: f.orgId,
        actorId: f.humanActorId,
        definitionId: head,
      }),
    ),
  ).rejects.toThrow('Private definition compilation evidence changed.');
});

import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { and, eq, sql } from 'drizzle-orm';
import { WorkTemplateCreate, WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { getDb, seedTaskAccessOrg, one } from '../support/routes-harness';
import {
  reserveTemplateCopyBundleInTransaction,
  finishTemplateCopyBundleInTransaction,
} from '../../src/lib/templates/copy-reservation';
import { createWorkTemplateInTransaction } from '../../src/lib/templates/creation';
import { appendPublication } from '../../src/lib/templates/persistence';
import { publishWorkTemplate } from '../../src/lib/templates/service';
import { updateTemplate } from '../../src/lib/templates/write';
import { getTemplateCopyBundleForRequest } from '../../src/lib/templates/copy-reservation';
import { parseCopyBundleAcceptance } from '../../src/lib/templates/copy-reservation-input';

let schema: typeof DbModule;
let db: typeof DbModule.db;
beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});
const fingerprint = `sha256:${'1'.repeat(64)}`;
const definition = () =>
  WorkTemplateDefinition.parse({
    name: 'Private copied Task',
    payload: { targetType: 'task', description: 'Copied body' },
  });
async function fixture() {
  const workspace = await seedTaskAccessOrg(db, schema, 'manage');
  const user = one(
    await db
      .insert(schema.user)
      .values({ name: 'Acceptor', email: `copy-${schema.genId()}@example.test` })
      .returning(),
  );
  await db
    .update(schema.actor)
    .set({ userId: user.id })
    .where(eq(schema.actor.id, workspace.humanActorId));
  const principal = { organizationId: workspace.orgId, userId: user.id };
  const input = parseCopyBundleAcceptance({
    requestId: schema.genId(),
    reviewFingerprint: fingerprint,
    mode: 'private_drafts' as const,
    roots: ['root'],
    entries: [
      {
        key: 'root',
        kind: 'task' as const,
        source: {
          kind: 'draft' as const,
          organizationId: schema.genId(),
          workTypeId: schema.genId(),
          draftRevision: 0,
          draftFingerprint: fingerprint,
        },
        sourceFingerprint: fingerprint,
        dependencies: [],
      },
    ],
  });
  return { ...workspace, principal, input };
}
async function install(f: Awaited<ReturnType<typeof fixture>>) {
  return db.transaction(
    async (tx) => {
      const reserved = await reserveTemplateCopyBundleInTransaction(tx, f.principal, f.input);
      if (reserved.kind !== 'reserved') throw new Error('Expected new reservation');
      const capability = reserved.reservations.get('root');
      if (!capability) throw new Error('Missing root reservation');
      const created = await createWorkTemplateInTransaction(
        tx,
        reserved.actor,
        WorkTemplateCreate.parse({
          targetType: 'task',
          scope: 'personal',
          definition: definition(),
        }),
        { identityReservation: capability },
      );
      expect(created.row.id).toBe(reserved.entries[0]?.destinationWorkTypeId);
      const receipt = one(
        await tx
          .insert(schema.changeSet)
          .values({
            id: schema.genId(),
            organizationId: f.orgId,
            actorId: f.humanActorId,
            origin: { channel: 'app', surface: 'settings', tool: 'template.copy' },
            summary: 'Copy private template',
          })
          .returning(),
      );
      await tx.insert(schema.changeSetEntry).values({
        changeSetId: receipt.id,
        entityKind: 'template',
        entityId: created.row.id,
        op: 'create',
        after: { name: created.row.name },
      });
      await finishTemplateCopyBundleInTransaction(tx, capability, {
        receiptId: receipt.id,
        afterStateFingerprints: [{ key: 'root', fingerprint }],
      });
      return { row: created.row, entry: reserved.entries[0], capability };
    },
    { isolationLevel: 'serializable' },
  );
}

describe('canonical reserved template identity writer', () => {
  it('creates zero-publication private drafts with the exact reserved identity', async () => {
    const f = await fixture();
    const result = await install(f);
    expect(result.row.id).toBe(result.entry?.destinationWorkTypeId);
    expect(result.row.latestPublishedVersionId).toBeNull();
    expect(
      await db
        .select()
        .from(schema.workTypeVersion)
        .where(eq(schema.workTypeVersion.workTypeId, result.row.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(schema.blueprintStep)
        .where(eq(schema.blueprintStep.versionId, result.entry?.reservedFirstVersionId ?? '')),
    ).toEqual([]);
  });
  it('consumes the exact first publication after an independent edit and mints version two normally', async () => {
    const f = await fixture();
    const result = await install(f);
    await db.transaction(
      async (tx) => {
        const [edited] = await tx
          .update(schema.template)
          .set({
            draftDefinition: { ...definition(), name: 'Independently edited' },
            draftRevision: 1,
          })
          .where(eq(schema.template.id, result.row.id))
          .returning();
        if (!edited) throw new Error('Missing private copy');
        const published = await appendPublication(tx, edited, f.humanActorId);
        expect(published.latestPublishedVersionId).toBe(result.entry?.reservedFirstVersionId);
        const next = await appendPublication(tx, published, f.humanActorId);
        expect(next.latestPublishedVersionId).not.toBe(result.entry?.reservedFirstVersionId);
      },
      { isolationLevel: 'serializable' },
    );
  });
  it('refuses copied or cross-transaction capabilities and committed partial bundles', async () => {
    const f = await fixture();
    const result = await install(f);
    await expect(
      db.transaction(
        (tx) =>
          createWorkTemplateInTransaction(
            tx,
            { orgId: f.orgId, actorId: f.humanActorId },
            WorkTemplateCreate.parse({
              targetType: 'task',
              scope: 'personal',
              definition: definition(),
            }),
            { identityReservation: result.capability },
          ),
        { isolationLevel: 'serializable' },
      ),
    ).rejects.toThrow();
    const count = one(
      await db
        .select({ count: sql<number>`count(*)::integer` })
        .from(schema.template)
        .where(eq(schema.template.organizationId, f.orgId)),
    ).count;
    await expect(
      db.transaction(
        (tx) =>
          reserveTemplateCopyBundleInTransaction(tx, f.principal, {
            ...f.input,
            requestId: schema.genId(),
          }),
        { isolationLevel: 'serializable' },
      ),
    ).rejects.toThrow();
    expect(
      one(
        await db
          .select({ count: sql<number>`count(*)::integer` })
          .from(schema.template)
          .where(eq(schema.template.organizationId, f.orgId)),
      ).count,
    ).toBe(count);
  });
  it('returns original identities on retry and refuses a mismatched accepted request', async () => {
    const f = await fixture();
    const result = await install(f);
    await db
      .update(schema.template)
      .set({ draftDefinition: { ...definition(), name: 'Later authored edit' }, draftRevision: 1 })
      .where(eq(schema.template.id, result.row.id));
    const retry = await db.transaction(
      (tx) => reserveTemplateCopyBundleInTransaction(tx, f.principal, f.input),
      { isolationLevel: 'serializable' },
    );
    expect(retry.kind).toBe('existing');
    expect(retry.entries[0]?.destinationWorkTypeId).toBe(result.row.id);
    expect(
      one(await db.select().from(schema.template).where(eq(schema.template.id, result.row.id)))
        .draftDefinition.name,
    ).toBe('Later authored edit');
    await expect(
      db.transaction(
        (tx) =>
          reserveTemplateCopyBundleInTransaction(tx, f.principal, {
            ...f.input,
            reviewFingerprint: `sha256:${'2'.repeat(64)}`,
          }),
        { isolationLevel: 'serializable' },
      ),
    ).rejects.toThrow();
  });
});

async function teamCopy() {
  const f = await fixture();
  const copied = await install(f);
  const [teammate] = await db
    .insert(schema.actor)
    .values({ organizationId: f.orgId, kind: 'human', displayName: 'Current teammate' })
    .returning();
  if (!teammate) throw new Error('Missing teammate');
  await db.insert(schema.grant).values({
    organizationId: f.orgId,
    subjectKind: 'actor',
    subjectId: teammate.id,
    resourceKind: 'organization',
    resourceId: f.orgId,
    capabilities: ['manage'],
    effect: 'allow',
  });
  await db.insert(schema.teamMember).values([
    { organizationId: f.orgId, teamId: f.teamId, actorId: teammate.id },
    { organizationId: f.orgId, teamId: f.teamId, actorId: f.humanActorId },
  ]);
  await db
    .update(schema.template)
    .set({ scope: 'team', teamId: f.teamId, draftRevision: 1 })
    .where(eq(schema.template.id, copied.row.id));
  return { f, copied, teammate };
}
describe('current reserved publication and outcome access', () => {
  it('publishes a legitimately shared team draft without exposing acceptor review metadata', async () => {
    const { f, copied, teammate } = await teamCopy();
    const row = await publishWorkTemplate(
      { orgId: f.orgId, actorId: teammate.id },
      copied.row.id,
      1,
    );
    expect(row.latestPublishedVersionId).toBe(copied.entry?.reservedFirstVersionId);
    expect(
      one(
        await db
          .select()
          .from(schema.workTemplateCopyBundle)
          .where(eq(schema.workTemplateCopyBundle.id, copied.entry?.bundleId ?? '')),
      ).acceptingActorKey,
    ).toBe(f.humanActorId);
  });
  it('preserves lawful teammate publication through the legacy scope-changing editor', async () => {
    const { f, copied, teammate } = await teamCopy();
    const row = await updateTemplate(f.orgId, teammate.id, copied.row.id, {
      scope: 'organization',
      name: 'Team reviewed edit',
    });
    expect(row.after.latestPublishedVersionId).toBe(copied.entry?.reservedFirstVersionId);
    expect(row.after.draftDefinition.name).toBe('Team reviewed edit');
  });
  it('lets a current View acceptor reconcile committed outcomes after authoring is revoked', async () => {
    const f = await fixture();
    const copied = await install(f);
    await db
      .update(schema.grant)
      .set({ capabilities: ['view'] })
      .where(
        and(eq(schema.grant.organizationId, f.orgId), eq(schema.grant.subjectId, f.humanActorId)),
      );
    const status = await db.transaction((tx) =>
      getTemplateCopyBundleForRequest(tx, f.principal, f.input.requestId),
    );
    expect(status).toMatchObject({
      state: 'installed',
      mode: 'private_drafts',
      entries: [{ targetType: 'task', workTypeId: copied.row.id }],
    });
    expect(status?.entries[0]).not.toHaveProperty('sourceIdentity');
    const retry = await db.transaction(
      (tx) => reserveTemplateCopyBundleInTransaction(tx, f.principal, f.input),
      { isolationLevel: 'serializable' },
    );
    expect(retry.kind).toBe('existing');
    await expect(
      db.transaction(
        (tx) =>
          reserveTemplateCopyBundleInTransaction(tx, f.principal, {
            ...f.input,
            requestId: schema.genId(),
          }),
        { isolationLevel: 'serializable' },
      ),
    ).rejects.toThrow();
    await expect(
      publishWorkTemplate({ orgId: f.orgId, actorId: f.humanActorId }, copied.row.id, 0),
    ).rejects.toThrow();
  });
  it('refuses raw scope promotion without publication and first publication with null attribution', async () => {
    const f = await fixture();
    const copied = await install(f);
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('docket.organization_id',${f.orgId},true),set_config('docket.actor_id',${f.humanActorId},true)`,
        );
        await tx
          .update(schema.template)
          .set({ scope: 'organization' })
          .where(eq(schema.template.id, copied.row.id));
      }),
    ).rejects.toThrow();
    await expect(
      db.transaction((tx) => appendPublication(tx, copied.row, null), {
        isolationLevel: 'serializable',
      }),
    ).rejects.toThrow();
    expect(
      one(await db.select().from(schema.template).where(eq(schema.template.id, copied.row.id)))
        .latestPublishedVersionId,
    ).toBeNull();
  });
});

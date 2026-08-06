import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type * as RulesModule from '../../src/lib/automation/rules-store';
import type * as DrainModule from '../../src/routes/event-sync';
import { getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepInboundEvents!: typeof DrainModule.sweepInboundEvents;
let seedDefaultAutomationRules!: typeof RulesModule.seedDefaultAutomationRules;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  sweepInboundEvents = (await import('../../src/routes/event-sync')).sweepInboundEvents;
  seedDefaultAutomationRules = (await import('../../src/lib/automation/rules-store'))
    .seedDefaultAutomationRules;
});

let seq = 0;

/** Seed a Better Auth user + a human actor linked to it; returns the actor id. */
async function seedUserActor(orgId: string): Promise<string> {
  seq += 1;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `assoc-${String(seq)}@example.com` })
    .returning({ id: schema.user.id });
  const [a] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada', userId: u!.id })
    .returning({ id: schema.actor.id });
  return a!.id;
}

/** Seed a connected Linear integration owned by `actorId`. */
async function seedIntegration(orgId: string, actorId: string): Promise<string> {
  const [row] = await db
    .insert(schema.integration)
    .values({
      organizationId: orgId,
      provider: 'linear',
      pattern: 'connector',
      roles: ['work'],
      connection: { externalWorkspaceId: 'ws' },
      status: 'connected',
      createdBy: actorId,
    })
    .returning({ id: schema.integration.id });
  return row!.id;
}

/**
 * Queue one inbound delivery about `externalId`.
 *
 * @remarks
 * The mock observer turns a payload `id` into a `work_item` entity ref, which is the subject
 * association resolves.
 */
async function seedInboundEvent(
  orgId: string,
  integrationId: string,
  externalEventId: string,
  externalId: string,
): Promise<void> {
  await db.insert(schema.inboundEvent).values({
    organizationId: orgId,
    integrationId,
    provider: 'linear',
    externalEventId,
    eventType: 'mock',
    payload: { kind: 'comment', title: 'Commented', id: externalId },
    signatureVerified: true,
  });
}

/** Read back the single event the drain wrote for this org. */
async function soleEvent(orgId: string) {
  const rows = await db.select().from(schema.event).where(eq(schema.event.organizationId, orgId));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe('entity association in the drain', () => {
  it('matches a webhook to the Docket task mirroring its subject', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const actorId = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Mirrored issue',
        state: 'todo',
        visibility: 'public',
        source: 'linked',
        sourceIntegrationId: intgId,
        externalId: 'LIN-9',
      })
      .returning({ id: schema.task.id });
    await seedInboundEvent(orgId, intgId, 'ev_assoc_hit', 'LIN-9');

    await sweepInboundEvents(new Date());

    const row = await soleEvent(orgId);
    expect(row.entityAssociation).toBe('matched');
    expect(row.docketEntityId).toBe(taskRow!.id);
  });

  it('leaves the resolved id out of the entity jsonb, so no consumer acts on it yet', async () => {
    // The rollout depends on this. Owner fan-out, search reindex, activity-document visibility and
    // automation subject matching all read `entity.docketEntityId`; writing it there would switch
    // all four on in one commit, which is precisely what resolving into a column avoids.
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const actorId = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Mirrored issue',
      state: 'todo',
      visibility: 'public',
      source: 'linked',
      sourceIntegrationId: intgId,
      externalId: 'LIN-10',
    });
    await seedInboundEvent(orgId, intgId, 'ev_assoc_dormant', 'LIN-10');

    await sweepInboundEvents(new Date());

    const row = await soleEvent(orgId);
    expect(row.entityAssociation).toBe('matched');
    expect(row.docketEntityId).not.toBeNull();
    expect(row.entity?.docketEntityId).toBeNull();
  });

  it('marks a subject Docket has not mirrored yet as pending, for the sweep to retry', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const actorId = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    await seedInboundEvent(orgId, intgId, 'ev_assoc_miss', 'LIN-NEVER');

    await sweepInboundEvents(new Date());

    const row = await soleEvent(orgId);
    // `work_item` is a kind Docket mirrors, so the mirror may still arrive — this must stay
    // retryable rather than being written off as unmatched.
    expect(row.entityAssociation).toBe('pending');
    expect(row.docketEntityId).toBeNull();
  });

  it('reindexes the associated task, so external activity refreshes what it concerns', async () => {
    // The first consumer switched onto the resolved id. Before association, an external event was
    // indexed as activity but never told the search index that the task it was about had moved.
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const actorId = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Mirrored issue',
        state: 'todo',
        visibility: 'public',
        source: 'linked',
        sourceIntegrationId: intgId,
        externalId: 'LIN-11',
      })
      .returning({ id: schema.task.id });
    await seedInboundEvent(orgId, intgId, 'ev_assoc_reindex', 'LIN-11');

    await sweepInboundEvents(new Date());

    const row = await soleEvent(orgId);
    const jobs = await db
      .select({
        sourceTable: schema.searchIndexJob.sourceTable,
        entityId: schema.searchIndexJob.entityId,
      })
      .from(schema.searchIndexJob)
      .where(eq(schema.searchIndexJob.sourceEventId, row.id));
    expect(jobs).toEqual(expect.arrayContaining([{ sourceTable: 'task', entityId: taskRow!.id }]));
  });

  it('enqueues no entity reindex when the subject never resolved', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const actorId = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    await seedInboundEvent(orgId, intgId, 'ev_assoc_no_reindex', 'LIN-ABSENT');

    await sweepInboundEvents(new Date());

    const row = await soleEvent(orgId);
    const jobs = await db
      .select({ sourceTable: schema.searchIndexJob.sourceTable })
      .from(schema.searchIndexJob)
      .where(eq(schema.searchIndexJob.sourceEventId, row.id));
    // Only the event's own activity document. Nothing to refresh, and nothing invented.
    expect(jobs).toEqual([{ sourceTable: 'event' }]);
  });

  it('lets an upstream completion reach the shipped archive-the-email rule', async () => {
    // A behaviour change, deliberately locked in here. The seeded rule matches
    // `{kind:'completed', subjectType:'task'}`, and external events never carried a subjectType,
    // so closing an issue in Linear left the attached mail thread alone while closing the mirror
    // in Docket archived it. The task IS that issue, so the two now agree.
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const actorId = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    await seedDefaultAutomationRules(orgId, actorId);

    const [taskRow] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'Mirrored issue',
        state: 'todo',
        visibility: 'public',
        source: 'linked',
        sourceIntegrationId: intgId,
        externalId: 'LIN-12',
      })
      .returning({ id: schema.task.id });

    // The mail action resolves through the attachment's own integration, which must be the
    // mail-capable one — `asMailActor` is gated by provider capability, not by rule config.
    const [mailIntg] = await db
      .insert(schema.integration)
      .values({
        organizationId: orgId,
        provider: 'gmail',
        pattern: 'connector',
        roles: ['context'],
        status: 'connected',
        createdBy: actorId,
      })
      .returning({ id: schema.integration.id });
    const [attachmentRow] = await db
      .insert(schema.attachment)
      .values({
        organizationId: orgId,
        subjectType: 'task',
        subjectId: taskRow!.id,
        kind: 'email',
        title: 'Re: the thing',
        sourceIntegrationId: mailIntg!.id,
        externalId: 'thread-abc',
      })
      .returning({ id: schema.attachment.id });

    await db.insert(schema.inboundEvent).values({
      organizationId: orgId,
      integrationId: intgId,
      provider: 'linear',
      externalEventId: 'ev_assoc_automation',
      eventType: 'mock',
      payload: { kind: 'completed', title: 'Closed upstream', id: 'LIN-12' },
      signatureVerified: true,
    });

    await sweepInboundEvents(new Date());

    const [after] = await db
      .select({ lastEmailStateAction: schema.attachment.lastEmailStateAction })
      .from(schema.attachment)
      .where(eq(schema.attachment.id, attachmentRow!.id));
    expect(after!.lastEmailStateAction).toBe('mail.archive');
  });

  it('leaves the mail thread alone when the completion resolves to no Docket task', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const actorId = await seedUserActor(orgId);
    const intgId = await seedIntegration(orgId, actorId);
    await seedDefaultAutomationRules(orgId, actorId);
    await db.insert(schema.inboundEvent).values({
      organizationId: orgId,
      integrationId: intgId,
      provider: 'linear',
      externalEventId: 'ev_assoc_automation_miss',
      eventType: 'mock',
      payload: { kind: 'completed', title: 'Closed upstream', id: 'LIN-UNMIRRORED' },
      signatureVerified: true,
    });

    await sweepInboundEvents(new Date());

    // No subject means no rule match, which is what keeps an unassociated event inert.
    const row = await soleEvent(orgId);
    expect(row.entityAssociation).toBe('pending');
  });

  it('will not associate across integrations within one org', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const actorId = await seedUserActor(orgId);
    const delivering = await seedIntegration(orgId, actorId);
    const other = await seedIntegration(orgId, actorId);
    await db.insert(schema.task).values({
      organizationId: orgId,
      teamId,
      title: 'Someone else’s mirror',
      state: 'todo',
      visibility: 'public',
      source: 'linked',
      sourceIntegrationId: other,
      externalId: 'COLLIDE-1',
    });
    await seedInboundEvent(orgId, delivering, 'ev_assoc_cross', 'COLLIDE-1');

    await sweepInboundEvents(new Date());

    const row = await soleEvent(orgId);
    expect(row.entityAssociation).toBe('pending');
    expect(row.docketEntityId).toBeNull();
  });
});

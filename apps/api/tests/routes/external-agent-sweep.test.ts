import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type * as SweepModule from '../../src/routes/event-sync';
import type * as ControlModule from '../../src/lib/external-agent-control-token';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');
let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepInboundEvents!: typeof SweepModule.sweepInboundEvents;
let signExternalAgentControl!: typeof ControlModule.signExternalAgentControl;

beforeAll(async () => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  ({ sweepInboundEvents } = await import('../../src/routes/event-sync'));
  ({ signExternalAgentControl } = await import('../../src/lib/external-agent-control-token'));
});

async function seedLinearAgent(): Promise<{
  organizationId: string;
  integrationId: string;
  actorId: string;
}> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [organization] = await db
    .insert(schema.organization)
    .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
    .returning({ id: schema.organization.id });
  const organizationId = assertDefined(organization).id;
  const [user] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `ada-${suffix}@example.test` })
    .returning({ id: schema.user.id });
  const userId = assertDefined(user).id;
  const [actor] = await db
    .insert(schema.actor)
    .values({ organizationId, kind: 'human', displayName: 'Ada', userId })
    .returning({ id: schema.actor.id });
  const actorId = assertDefined(actor).id;
  await db.insert(schema.account).values({
    userId,
    providerId: 'linear',
    accountId: `linear-user-${suffix}`,
  });
  const [integration] = await db
    .insert(schema.integration)
    .values({
      organizationId,
      provider: 'linear_agent',
      pattern: 'agent',
      roles: [],
      status: 'connected',
      createdBy: actorId,
      connection: { externalWorkspaceId: `linear-workspace-${suffix}` },
    })
    .returning({ id: schema.integration.id });
  return { organizationId, integrationId: assertDefined(integration).id, actorId };
}

async function insertLinearDelivery(
  seeded: Awaited<ReturnType<typeof seedLinearAgent>>,
  payload: Record<string, unknown>,
  externalEventId: string,
): Promise<void> {
  await db.insert(schema.inboundEvent).values({
    organizationId: seeded.organizationId,
    integrationId: seeded.integrationId,
    provider: 'linear_agent',
    externalEventId,
    eventType: String(payload['action']),
    payload,
    signatureVerified: true,
  });
}

describe('external agent inbox processing', () => {
  it('creates a linked session from the provider prompt and queues one run', async () => {
    const seeded = await seedLinearAgent();
    const sessionRef = `linear-session-${Math.random().toString(36).slice(2, 8)}`;
    const [account] = await db
      .select({ accountId: schema.account.accountId })
      .from(schema.account)
      .where(
        eq(
          schema.account.userId,
          assertDefined(
            assertDefined(
              (await db.select().from(schema.actor).where(eq(schema.actor.id, seeded.actorId)))[0],
            ).userId,
          ),
        ),
      );
    await insertLinearDelivery(
      seeded,
      {
        action: 'created',
        organizationId: `linear-workspace-unused`,
        webhookTimestamp: Date.now(),
        agentSession: { id: sessionRef, promptContext: 'Use the exact provider prompt.' },
        actor: { id: assertDefined(account).accountId },
      },
      `${sessionRef}:created`,
    );

    const result = await sweepInboundEvents(new Date());

    expect(result).toMatchObject({ processed: 1, failed: 0 });
    const [session] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, `external-agent:linear:${sessionRef}`));
    expect(session).toMatchObject({ status: 'pending', initiatorId: seeded.actorId });
    const [link] = await db
      .select()
      .from(schema.agentSessionExternalLink)
      .where(eq(schema.agentSessionExternalLink.sessionId, assertDefined(session).id));
    expect(link).toMatchObject({ provider: 'linear', externalSessionId: sessionRef });
    const activities = await db
      .select()
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.sessionId, assertDefined(session).id));
    expect(activities).toEqual([
      expect.objectContaining({ body: { text: 'Use the exact provider prompt.' } }),
    ]);
    const runs = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, assertDefined(session).id));
    expect(runs).toHaveLength(1);
  });

  it('applies one follow-up message and queues the next generation', async () => {
    const seeded = await seedLinearAgent();
    const suffix = Math.random().toString(36).slice(2, 8);
    const sessionRef = `linear-follow-${suffix}`;
    const actorRows = await db
      .select({ userId: schema.actor.userId })
      .from(schema.actor)
      .where(eq(schema.actor.id, seeded.actorId));
    const [account] = await db
      .select({ accountId: schema.account.accountId })
      .from(schema.account)
      .where(eq(schema.account.userId, assertDefined(assertDefined(actorRows[0]).userId)));
    const actorExternalId = assertDefined(account).accountId;
    await insertLinearDelivery(
      seeded,
      {
        action: 'created',
        organizationId: 'workspace',
        webhookTimestamp: Date.now(),
        agentSession: { id: sessionRef, promptContext: 'Start.' },
        actor: { id: actorExternalId },
      },
      `${sessionRef}:created`,
    );
    await sweepInboundEvents(new Date());
    await insertLinearDelivery(
      seeded,
      {
        action: 'prompted',
        organizationId: 'workspace',
        webhookTimestamp: Date.now(),
        agentSession: { id: sessionRef },
        actor: { id: actorExternalId },
        agentActivity: { id: `activity-${suffix}`, body: 'Continue with this constraint.' },
      },
      `activity-${suffix}`,
    );

    await sweepInboundEvents(new Date());

    const [session] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, `external-agent:linear:${sessionRef}`));
    const replies = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, assertDefined(session).id),
          eq(schema.sessionActivity.type, 'response'),
        ),
      );
    expect(replies.map((row) => row.body.text)).toContain('Continue with this constraint.');
    const runs = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, assertDefined(session).id));
    expect(runs.map((run) => run.generation)).toEqual([0, 1]);
  });

  it('deduplicates a provider activity across distinct webhook deliveries', async () => {
    const seeded = await seedLinearAgent();
    const suffix = Math.random().toString(36).slice(2, 8);
    const sessionRef = `linear-dedupe-${suffix}`;
    const [actorRow] = await db
      .select({ userId: schema.actor.userId })
      .from(schema.actor)
      .where(eq(schema.actor.id, seeded.actorId));
    const [account] = await db
      .select({ accountId: schema.account.accountId })
      .from(schema.account)
      .where(eq(schema.account.userId, assertDefined(assertDefined(actorRow).userId)));
    const actorExternalId = assertDefined(account).accountId;
    await insertLinearDelivery(
      seeded,
      {
        action: 'created',
        organizationId: 'workspace',
        webhookTimestamp: Date.now(),
        agentSession: { id: sessionRef, promptContext: 'Start once.' },
        actor: { id: actorExternalId },
      },
      `${sessionRef}:created`,
    );
    await sweepInboundEvents(new Date());
    const repeatedPayload = {
      action: 'prompted',
      organizationId: 'workspace',
      webhookTimestamp: Date.now(),
      agentSession: { id: sessionRef },
      actor: { id: actorExternalId },
      agentActivity: { id: `same-activity-${suffix}`, body: 'Do not apply this twice.' },
    };
    await insertLinearDelivery(seeded, repeatedPayload, `delivery-a-${suffix}`);
    await sweepInboundEvents(new Date());
    await insertLinearDelivery(seeded, repeatedPayload, `delivery-b-${suffix}`);
    await sweepInboundEvents(new Date());

    const [session] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, `external-agent:linear:${sessionRef}`));
    const replies = await db
      .select()
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, assertDefined(session).id),
          eq(schema.sessionActivity.type, 'response'),
        ),
      );
    expect(replies.filter((row) => row.body.text === 'Do not apply this twice.')).toHaveLength(1);
    const runs = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, assertDefined(session).id));
    expect(runs.map((run) => run.generation)).toEqual([0, 1]);
  });

  it('applies a signed native approval and queues its execution generation', async () => {
    process.env['BETTER_AUTH_SECRET'] = 'external-agent-sweep-test-secret';
    const seeded = await seedLinearAgent();
    const suffix = Math.random().toString(36).slice(2, 8);
    const sessionRef = `linear-approval-${suffix}`;
    const [actorRow] = await db
      .select({ userId: schema.actor.userId })
      .from(schema.actor)
      .where(eq(schema.actor.id, seeded.actorId));
    const [account] = await db
      .select({ accountId: schema.account.accountId })
      .from(schema.account)
      .where(eq(schema.account.userId, assertDefined(assertDefined(actorRow).userId)));
    await insertLinearDelivery(
      seeded,
      {
        action: 'created',
        organizationId: 'workspace',
        webhookTimestamp: Date.now(),
        agentSession: { id: sessionRef, promptContext: 'Start.' },
        actor: { id: assertDefined(account).accountId },
      },
      `${sessionRef}:created`,
    );
    await sweepInboundEvents(new Date());
    const [session] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, `external-agent:linear:${sessionRef}`));
    const sessionId = assertDefined(session).id;
    const [action] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId,
        organizationId: seeded.organizationId,
        type: 'action',
        approvalStatus: 'proposed',
        body: { action: { kind: 'update_task', summary: 'Update the task.' } },
      })
      .returning({ id: schema.sessionActivity.id });
    await db
      .update(schema.agentSession)
      .set({ status: 'awaiting_approval' })
      .where(eq(schema.agentSession.id, sessionId));
    const token = signExternalAgentControl({
      kind: 'approval',
      provider: 'linear',
      organizationId: seeded.organizationId,
      sessionId,
      activityId: assertDefined(action).id,
      decision: 'approve',
    });
    await insertLinearDelivery(
      seeded,
      {
        action: 'prompted',
        organizationId: 'workspace',
        webhookTimestamp: Date.now(),
        agentSession: { id: sessionRef },
        actor: { id: assertDefined(account).accountId },
        agentActivity: {
          id: `approval-${suffix}`,
          signal: { type: 'select', value: token },
        },
      },
      `approval-delivery-${suffix}`,
    );

    const result = await sweepInboundEvents(new Date());

    expect(result.failed).toBe(0);
    const [decided] = await db
      .select({ approvalStatus: schema.sessionActivity.approvalStatus })
      .from(schema.sessionActivity)
      .where(eq(schema.sessionActivity.id, assertDefined(action).id));
    expect(decided?.approvalStatus).toBe('approved');
    const runs = await db
      .select({ generation: schema.agentSessionRun.generation })
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.sessionId, sessionId));
    expect(runs.map((run) => run.generation)).toEqual([0, 1]);
  });
});

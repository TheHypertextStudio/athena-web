import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type * as RelayModule from '../../src/lib/external-agent-relay';
import type * as DefaultAgentModule from '../../src/lib/default-agent';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');
let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let relayExternalAgentActivity!: typeof RelayModule.relayExternalAgentActivity;
let sweepExternalAgentRelays!: typeof RelayModule.sweepExternalAgentRelays;
let ensureDefaultAgent!: typeof DefaultAgentModule.ensureDefaultAgent;

beforeAll(async () => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['BETTER_AUTH_SECRET'] = 'external-agent-relay-test-secret';
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  ({ relayExternalAgentActivity, sweepExternalAgentRelays } =
    await import('../../src/lib/external-agent-relay'));
  ({ ensureDefaultAgent } = await import('../../src/lib/default-agent'));
});

async function seedRelaySession(): Promise<{ orgId: string; sessionId: string }> {
  const suffix = Math.random().toString(36).slice(2, 9);
  const [org] = await db
    .insert(schema.organization)
    .values({ name: `Relay ${suffix}`, slug: `relay-${suffix}` })
    .returning({ id: schema.organization.id });
  const orgId = assertDefined(org).id;
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'human', displayName: 'Ada' })
    .returning({ id: schema.actor.id });
  const agent = await ensureDefaultAgent(orgId, assertDefined(human).id);
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      organizationId: orgId,
      agentId: agent.id,
      trigger: 'mention',
      status: 'completed',
      initiatorId: assertDefined(human).id,
    })
    .returning({ id: schema.agentSession.id });
  const sessionId = assertDefined(session).id;
  await db.insert(schema.agentSessionExternalLink).values({
    sessionId,
    organizationId: orgId,
    provider: 'linear',
    externalWorkspaceId: `workspace-${suffix}`,
    externalSessionId: `external-${suffix}`,
  });
  return { orgId, sessionId };
}

describe('external agent relay', () => {
  it('renders an unresolved Linear identity as a targeted signed authentication control', async () => {
    const seeded = await seedRelaySession();
    const now = new Date('2026-08-28T12:00:00.000Z');
    await db.insert(schema.sessionActivity).values({
      sessionId: seeded.sessionId,
      organizationId: seeded.orgId,
      type: 'elicitation',
      body: {
        text: 'Connect this external account to Docket so Athena can continue.',
        externalAgentControl: {
          type: 'authentication',
          externalActorId: 'linear-user-42',
        },
      },
      createdAt: now,
      updatedAt: now,
    });
    const publish = vi.fn<RelayModule.ExternalAgentPublisher>().mockResolvedValue({ id: 'ok' });

    await relayExternalAgentActivity(seeded.sessionId, now, { publish });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1]?.[0]).toMatchObject({
      provider: 'linear',
      kind: 'activity',
      output: {
        type: 'elicitation',
        signal: {
          type: 'auth',
          userId: 'linear-user-42',
        },
      },
    });
    const request = publish.mock.calls[1]?.[0];
    if (request?.kind !== 'activity' || request.provider !== 'linear') {
      throw new Error('expected a Linear activity publication');
    }
    expect(request.output.signal?.type).toBe('auth');
    if (request.output.signal?.type !== 'auth') throw new Error('expected an auth signal');
    const authUrl = new URL(request.output.signal.url);
    expect(authUrl.pathname).toBe('/external-agent/connect');
    expect(authUrl.searchParams.get('token')).toBeTruthy();
  });

  it('stops on failure, records backoff, and resumes from the failed activity', async () => {
    const seeded = await seedRelaySession();
    const start = new Date('2026-08-28T12:00:00.000Z');
    await db.insert(schema.sessionActivity).values([
      {
        sessionId: seeded.sessionId,
        organizationId: seeded.orgId,
        type: 'response',
        body: { text: 'First.' },
        createdAt: start,
        updatedAt: start,
      },
      {
        sessionId: seeded.sessionId,
        organizationId: seeded.orgId,
        type: 'response',
        body: { text: 'Second.' },
        createdAt: new Date(start.getTime() + 1_000),
        updatedAt: new Date(start.getTime() + 1_000),
      },
    ]);
    const publish = vi
      .fn<RelayModule.ExternalAgentPublisher>()
      .mockResolvedValueOnce({ id: 'prepared' })
      .mockResolvedValueOnce({ id: 'first' })
      .mockRejectedValueOnce(new Error('provider outage'));

    await relayExternalAgentActivity(seeded.sessionId, start, { publish });

    let [link] = await db
      .select()
      .from(schema.agentSessionExternalLink)
      .where(eq(schema.agentSessionExternalLink.sessionId, seeded.sessionId));
    expect(link).toMatchObject({ relayStatus: 'retrying', relayAttempts: 1 });
    expect(link?.lastRelayedActivityUpdatedAt).toEqual(start);
    expect(link?.lastRelayError).toBe('External provider delivery failed.');
    publish.mockResolvedValueOnce({ id: 'second' });

    await relayExternalAgentActivity(
      seeded.sessionId,
      new Date(assertDefined(assertDefined(link).nextRelayAt).getTime() + 1),
      { publish },
    );

    [link] = await db
      .select()
      .from(schema.agentSessionExternalLink)
      .where(eq(schema.agentSessionExternalLink.sessionId, seeded.sessionId));
    expect(publish).toHaveBeenCalledTimes(4);
    expect(link).toMatchObject({ relayStatus: 'ready', relayAttempts: 0, lastRelayError: null });
    expect(link?.lastRelayedActivityUpdatedAt).toEqual(new Date(start.getTime() + 1_000));
  });

  it('advances past a mirrored human response without publishing it back to Linear', async () => {
    const seeded = await seedRelaySession();
    const now = new Date('2026-08-28T12:00:00.000Z');
    const [activity] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seeded.sessionId,
        organizationId: seeded.orgId,
        type: 'response',
        body: { text: 'Human reply.', author: 'user' },
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.sessionActivity.id });
    const publish = vi.fn<RelayModule.ExternalAgentPublisher>().mockResolvedValue({ id: 'ok' });

    await relayExternalAgentActivity(seeded.sessionId, now, { publish });
    await relayExternalAgentActivity(seeded.sessionId, now, { publish });

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ kind: 'prepare_session' }));
    const [link] = await db
      .select()
      .from(schema.agentSessionExternalLink)
      .where(eq(schema.agentSessionExternalLink.sessionId, seeded.sessionId));
    expect(link?.lastRelayedActivityId).toBe(assertDefined(activity).id);
  });

  it('publishes an action again when approval updates the existing activity row', async () => {
    const seeded = await seedRelaySession();
    const proposedAt = new Date('2026-08-28T12:00:00.000Z');
    const appliedAt = new Date(proposedAt.getTime() + 1_000);
    const [activity] = await db
      .insert(schema.sessionActivity)
      .values({
        sessionId: seeded.sessionId,
        organizationId: seeded.orgId,
        type: 'action',
        approvalStatus: 'proposed',
        body: { action: { kind: 'update_task', summary: 'Mark "Ship it" done' } },
        createdAt: proposedAt,
        updatedAt: proposedAt,
      })
      .returning({ id: schema.sessionActivity.id });
    const publish = vi.fn<RelayModule.ExternalAgentPublisher>().mockResolvedValue({ id: 'ok' });

    await relayExternalAgentActivity(seeded.sessionId, proposedAt, { publish });
    await db
      .update(schema.sessionActivity)
      .set({
        approvalStatus: 'applied',
        body: {
          action: {
            kind: 'update_task',
            summary: 'Mark "Ship it" done',
            result: { content: 'Marked done.', isError: false },
          },
        },
        updatedAt: appliedAt,
      })
      .where(eq(schema.sessionActivity.id, assertDefined(activity).id));

    await relayExternalAgentActivity(seeded.sessionId, appliedAt, { publish });

    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish.mock.calls[1]?.[0]).toMatchObject({
      kind: 'activity',
      output: { type: 'action', signal: { type: 'select' } },
    });
    expect(publish.mock.calls[2]?.[0]).toMatchObject({
      kind: 'activity',
      output: {
        type: 'action',
        action: 'Mark "Ship it" done',
        parameter: 'Docket',
        result: 'Marked done.',
      },
    });
  });

  it('marks a revoked installation and its link errored and notifies the integration owner once', async () => {
    const seeded = await seedRelaySession();
    const [owner] = await db
      .select()
      .from(schema.actor)
      .where(eq(schema.actor.organizationId, seeded.orgId))
      .limit(1);
    const [user] = await db
      .insert(schema.user)
      .values({ name: 'Relay owner', email: `relay-${seeded.sessionId}@example.com` })
      .returning({ id: schema.user.id });
    await db
      .update(schema.actor)
      .set({ userId: assertDefined(user).id })
      .where(eq(schema.actor.id, assertDefined(owner).id));
    await db.insert(schema.integration).values({
      organizationId: seeded.orgId,
      provider: 'linear_agent',
      pattern: 'agent',
      status: 'connected',
      createdBy: assertDefined(owner).id,
    });
    const now = new Date('2026-08-28T12:00:00.000Z');
    await db.insert(schema.sessionActivity).values({
      sessionId: seeded.sessionId,
      organizationId: seeded.orgId,
      type: 'response',
      body: { text: 'Needs a credential.' },
      createdAt: now,
      updatedAt: now,
    });
    const publish = vi.fn<RelayModule.ExternalAgentPublisher>().mockRejectedValue(
      Object.assign(new Error('provider credential text that must not reach the user'), {
        code: 'external_agent_installation_unavailable',
        provider: 'linear',
      }),
    );

    await relayExternalAgentActivity(seeded.sessionId, now, { publish });
    await relayExternalAgentActivity(seeded.sessionId, new Date(now.getTime() + 60_000), {
      publish,
    });

    const [link] = await db
      .select()
      .from(schema.agentSessionExternalLink)
      .where(eq(schema.agentSessionExternalLink.sessionId, seeded.sessionId));
    expect(link).toMatchObject({
      relayStatus: 'errored',
      nextRelayAt: null,
      lastRelayError: 'The Linear Agent connection must be reconnected.',
    });
    const [installed] = await db
      .select()
      .from(schema.integration)
      .where(eq(schema.integration.organizationId, seeded.orgId));
    expect(installed).toMatchObject({
      status: 'error',
      lastError: 'The Linear Agent connection must be reconnected.',
    });
    const notices = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.userId, assertDefined(user).id));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      type: 'connector_needs_reauth',
      body: {
        title: 'Reconnect Linear Agent',
        summary: 'Reconnect Linear Agent so Athena can continue replying in Linear.',
        url: `/orgs/${seeded.orgId}/settings/connections`,
      },
    });
  });

  it('selects cursor-lagged links instead of letting 100 idle links starve a due retry', async () => {
    const first = await seedRelaySession();
    const [template] = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.id, first.sessionId));
    if (!template) throw new Error('relay session fixture was not created');
    const idleTime = new Date('2026-08-28T10:00:00.000Z');
    await db
      .update(schema.agentSessionExternalLink)
      .set({ relayStatus: 'ready', createdAt: idleTime, updatedAt: idleTime })
      .where(eq(schema.agentSessionExternalLink.sessionId, first.sessionId));
    for (let index = 0; index < 100; index += 1) {
      const [session] = await db
        .insert(schema.agentSession)
        .values({
          organizationId: first.orgId,
          agentId: template.agentId,
          trigger: 'mention',
          status: 'completed',
          initiatorId: template.initiatorId,
        })
        .returning({ id: schema.agentSession.id });
      const sessionId = assertDefined(session).id;
      await db.insert(schema.agentSessionExternalLink).values({
        sessionId,
        organizationId: first.orgId,
        provider: 'linear',
        externalWorkspaceId: `idle-workspace-${index}`,
        externalSessionId: `idle-session-${index}`,
        relayStatus: 'ready',
        createdAt: idleTime,
        updatedAt: idleTime,
      });
    }
    const due = await seedRelaySession();
    const dueAt = new Date('2026-08-28T12:00:00.000Z');
    await db
      .update(schema.agentSessionExternalLink)
      .set({ relayStatus: 'retrying', nextRelayAt: new Date(dueAt.getTime() - 1_000) })
      .where(eq(schema.agentSessionExternalLink.sessionId, due.sessionId));
    await db.insert(schema.sessionActivity).values({
      sessionId: due.sessionId,
      organizationId: due.orgId,
      type: 'response',
      body: { text: 'Retry me.' },
      createdAt: dueAt,
      updatedAt: dueAt,
    });
    const publish = vi.fn<RelayModule.ExternalAgentPublisher>().mockResolvedValue({ id: 'sent' });

    const result = await sweepExternalAgentRelays(dueAt, { publish });

    expect(result).toEqual({ found: 1, processed: 1 });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toMatchObject({
      provider: 'linear',
      kind: 'activity',
      session: { id: expect.stringContaining('external-') },
    });
  });
});

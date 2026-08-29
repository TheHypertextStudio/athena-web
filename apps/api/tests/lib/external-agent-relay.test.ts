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
  ({ relayExternalAgentActivity } = await import('../../src/lib/external-agent-relay'));
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
});

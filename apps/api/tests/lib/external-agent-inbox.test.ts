import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { RawWebhook } from '@docket/integrations';
import { assertDefined } from '@docket/test-utils';

import type * as InboxModule from '../../src/lib/external-agent-inbox';
import { linearAgentWebhook } from '../support/linear-agent-webhook';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let persistExternalAgentWebhook!: typeof InboxModule.persistExternalAgentWebhook;

beforeAll(async () => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  ({ persistExternalAgentWebhook } = await import('../../src/lib/external-agent-inbox'));
});

async function seedAgentIntegration(
  provider: 'linear_agent' | 'slack' | 'github' | 'jira_a2a',
  externalWorkspaceId: string,
): Promise<{ organizationId: string; integrationId: string }> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [organization] = await db
    .insert(schema.organization)
    .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
    .returning({ id: schema.organization.id });
  const organizationId = assertDefined(organization).id;
  const [integration] = await db
    .insert(schema.integration)
    .values({
      organizationId,
      provider,
      pattern: 'agent',
      roles: [],
      status: 'connected',
      connection: { externalWorkspaceId },
    })
    .returning({ id: schema.integration.id });
  return { organizationId, integrationId: assertDefined(integration).id };
}

function signedLinearWebhook(sessionId: string, workspaceId = 'linear-workspace'): RawWebhook {
  const body = JSON.stringify(
    linearAgentWebhook({
      action: 'created',
      organizationId: workspaceId,
      sessionId,
      promptContext: 'Plan the release.',
    }),
  );
  return {
    body,
    headers: {
      'linear-signature': createHmac('sha256', 'linear-secret').update(body).digest('hex'),
      'linear-delivery': `${sessionId}:created`,
    },
    receivedAt: new Date(),
  };
}

describe('external agent inbox', () => {
  it('verifies, routes, and persists a Linear delivery without running Athena', async () => {
    const seeded = await seedAgentIntegration('linear_agent', 'linear-workspace');

    const result = await persistExternalAgentWebhook(
      'linear',
      signedLinearWebhook('linear-session'),
      { signingSecret: 'linear-secret' },
    );

    expect(result).toMatchObject({ routed: true, inserted: true });
    const [row] = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'linear-session:created'));
    expect(row).toMatchObject({
      organizationId: seeded.organizationId,
      integrationId: seeded.integrationId,
      provider: 'linear_agent',
      eventType: 'created',
      status: 'received',
      signatureVerified: true,
    });
    expect(
      await db
        .select()
        .from(schema.agentSession)
        .where(eq(schema.agentSession.externalRunRef, 'external-agent:linear:linear-session')),
    ).toHaveLength(0);
  });

  it('acknowledges a duplicate delivery without inserting a second inbox row', async () => {
    await seedAgentIntegration('linear_agent', 'linear-workspace');
    const raw = signedLinearWebhook('linear-session-duplicate');

    const first = await persistExternalAgentWebhook('linear', raw, {
      signingSecret: 'linear-secret',
    });
    const second = await persistExternalAgentWebhook('linear', raw, {
      signingSecret: 'linear-secret',
    });

    expect(first.inserted).toBe(true);
    expect(second).toMatchObject({ routed: true, inserted: false });
  });

  it('records an unrouted verified delivery for diagnostics', async () => {
    const result = await persistExternalAgentWebhook(
      'linear',
      signedLinearWebhook('linear-session-unrouted', 'unknown-workspace'),
      { signingSecret: 'linear-secret' },
    );

    expect(result).toMatchObject({ routed: false, inserted: true });
    const [row] = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'linear-session-unrouted:created'));
    expect(row?.organizationId).toBeNull();
    expect(row?.integrationId).toBeNull();
  });
});

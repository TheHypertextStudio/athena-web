import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type * as RouteModule from '../../src/routes/ingest-agent-surface';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');
let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let createAgentSurfaceIngestRouter!: typeof RouteModule.createAgentSurfaceIngestRouter;

beforeAll(async () => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  ({ createAgentSurfaceIngestRouter } = await import('../../src/routes/ingest-agent-surface'));
});

async function seedLinearAgent(workspaceId: string): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [organization] = await db
    .insert(schema.organization)
    .values({ name: `Org ${suffix}`, slug: `org-${suffix}` })
    .returning({ id: schema.organization.id });
  await db.insert(schema.integration).values({
    organizationId: assertDefined(organization).id,
    provider: 'linear_agent',
    pattern: 'agent',
    roles: [],
    status: 'connected',
    connection: { externalWorkspaceId: workspaceId },
  });
}

function linearRequest(workspaceId: string, sessionId: string): RequestInit {
  const body = JSON.stringify({
    action: 'created',
    organizationId: workspaceId,
    webhookTimestamp: Date.now(),
    agentSession: { id: sessionId, promptContext: 'Plan the release.' },
    actor: { id: 'linear-user' },
  });
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'linear-signature': createHmac('sha256', 'linear-secret').update(body).digest('hex'),
    },
    body,
  };
}

describe('POST /:provider external agent ingestion', () => {
  it('persists and acknowledges a configured provider before model execution', async () => {
    await seedLinearAgent('linear-http-workspace');
    const router = createAgentSurfaceIngestRouter({
      linear: { signingSecret: 'linear-secret' },
    });

    const response = await router.request(
      '/linear',
      linearRequest('linear-http-workspace', 'linear-http-session'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, routed: true, duplicate: false });
    const [inbox] = await db
      .select()
      .from(schema.inboundEvent)
      .where(eq(schema.inboundEvent.externalEventId, 'linear-http-session:created'));
    expect(inbox?.status).toBe('received');
  });

  it('rejects an invalid signature without writing an inbox row', async () => {
    const router = createAgentSurfaceIngestRouter({
      linear: { signingSecret: 'linear-secret' },
    });
    const request = linearRequest('linear-http-workspace', 'linear-bad-signature');
    const response = await router.request('/linear', {
      ...request,
      headers: { 'content-type': 'application/json', 'linear-signature': 'invalid' },
    });

    expect(response.status).toBe(400);
    expect(
      await db
        .select()
        .from(schema.inboundEvent)
        .where(eq(schema.inboundEvent.externalEventId, 'linear-bad-signature:created')),
    ).toHaveLength(0);
  });

  it('returns 503 when a provider has no verification configuration', async () => {
    const router = createAgentSurfaceIngestRouter({});
    const response = await router.request(
      '/linear',
      linearRequest('linear-http-workspace', 'linear-unconfigured'),
    );

    expect(response.status).toBe(503);
  });

  it('returns 404 for a provider outside the closed registry', async () => {
    const router = createAgentSurfaceIngestRouter({});
    const response = await router.request('/trello', { method: 'POST', body: '{}' });

    expect(response.status).toBe(404);
  });
});

import { resolve } from 'node:path';

import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq, isNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type integrationsLinearAgentRouter from '../../src/routes/integrations-linear-agent';
import type { verifyLinearAgentInstallState as VerifyState } from '../../src/lib/linear-agent-connect';

// Re-declared alongside the shared baseline (see tests/support/env.ts) because this file needs
// the Linear Agent app "configured" — the unconfigured (409) case lives in
// integrations-linear-agent-unconfigured.test.ts, a separate file/module registry so the two env
// shapes never collide.
vi.hoisted(() => {
  process.env['DATABASE_URL'] = 'pglite://memory://';
  process.env['APP_MODE'] = 'test';
  process.env['NODE_ENV'] = 'test';
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
  process.env['CRON_SECRET'] = 'test-cron-secret';
  process.env['SKIP_ENV_VALIDATION'] = '1';
  process.env['AGENT_MAX_TURNS'] = '8';
  process.env['API_URL'] = 'https://api.docket.test';
  process.env['LINEAR_AGENT_CLIENT_ID'] = 'agent-client-id';
  process.env['LINEAR_AGENT_CLIENT_SECRET'] = 'agent-client-secret';
  process.env['LINEAR_AGENT_WEBHOOK_SECRET'] = 'agent-webhook-secret';
});

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrationsLinearAgent!: typeof integrationsLinearAgentRouter;
let verifyLinearAgentInstallState!: typeof VerifyState;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  integrationsLinearAgent = (await import('../../src/routes/integrations-linear-agent')).default;
  ({ verifyLinearAgentInstallState } = await import('../../src/lib/linear-agent-connect'));
});

interface Seed {
  orgId: string;
  actorId: string;
}

async function seedOrg(): Promise<Seed> {
  const slug = `lia-${Math.random().toString(36).slice(2, 10)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug, lifecycleState: 'active' })
    .returning({ id: schema.organization.id });
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.com` })
    .returning({ id: schema.user.id });
  const [human] = await db
    .insert(schema.actor)
    .values({ organizationId: org!.id, kind: 'human', displayName: 'Ada', userId: u!.id })
    .returning({ id: schema.actor.id });
  return { orgId: org!.id, actorId: human!.id };
}

function appFor(seed: Seed, capabilities: readonly string[] = ['view', 'contribute', 'manage']) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const ctx: ActorCtx = { orgId: seed.orgId, actorId: seed.actorId, roleId: null, capabilities };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', integrationsLinearAgent);
  app.onError(onError);
  return app;
}

describe('GET /install (Linear Agent platform)', () => {
  it('find-or-creates a pending linear_agent integration and returns a signed authorize URL', async () => {
    const seed = await seedOrg();
    const app = appFor(seed);

    const res = await app.request('/install');
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://linear.app/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('agent-client-id');
    expect(parsed.searchParams.get('actor')).toBe('app');
    expect(parsed.searchParams.get('scope')).toBe('app:mentionable,app:assignable');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'https://api.docket.test/internal/integrations/linear-agent/callback',
    );

    const state = parsed.searchParams.get('state');
    const decoded = verifyLinearAgentInstallState(state!);
    expect(decoded?.orgId).toBe(seed.orgId);

    const [row] = await db
      .select()
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, seed.orgId),
          eq(schema.integration.provider, 'linear_agent'),
        ),
      );
    expect(row?.id).toBe(decoded?.integrationId);
    expect(row?.pattern).toBe('agent');
    expect(row?.status).toBe('pending');
    expect(row?.roles).toEqual([]);
  });

  it('reuses the existing row (and clears a prior error) on a repeat install', async () => {
    const seed = await seedOrg();
    const app = appFor(seed);

    const first = await app.request('/install');
    const { url: firstUrl } = (await first.json()) as { url: string };
    const firstIntegrationId = verifyLinearAgentInstallState(
      new URL(firstUrl).searchParams.get('state')!,
    )?.integrationId;

    await db
      .update(schema.integration)
      .set({ status: 'error', lastError: 'token expired', lastErrorAt: new Date() })
      .where(eq(schema.integration.id, firstIntegrationId!));

    const second = await app.request('/install');
    const { url: secondUrl } = (await second.json()) as { url: string };
    const secondIntegrationId = verifyLinearAgentInstallState(
      new URL(secondUrl).searchParams.get('state')!,
    )?.integrationId;

    expect(secondIntegrationId).toBe(firstIntegrationId);
    const [row] = await db
      .select()
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, seed.orgId),
          eq(schema.integration.provider, 'linear_agent'),
          isNull(schema.integration.externalAccountId),
        ),
      );
    expect(row?.status).toBe('pending');
    expect(row?.lastError).toBeNull();
  });

  it('requires the manage capability', async () => {
    const seed = await seedOrg();
    const app = appFor(seed, ['view']);
    const res = await app.request('/install');
    expect(res.status).toBe(403);
  });
});

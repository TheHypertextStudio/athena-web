import { resolve } from 'node:path';

import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type integrationsLinearAgentRouter from '../../src/routes/integrations-linear-agent';

/**
 * This file deliberately does NOT set `LINEAR_AGENT_CLIENT_ID`/`_SECRET`/`_WEBHOOK_SECRET` — the
 * shared baseline (`tests/support/env.ts`) leaves them unset, exercising the "app not configured"
 * degrade path in its own module registry so it never collides with
 * `integrations-linear-agent.test.ts`'s configured variant.
 */
const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let integrationsLinearAgent!: typeof integrationsLinearAgentRouter;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  integrationsLinearAgent = (await import('../../src/routes/integrations-linear-agent')).default;
});

async function seedOrg(): Promise<{ orgId: string; actorId: string }> {
  const slug = `lia-nc-${Math.random().toString(36).slice(2, 10)}`;
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

describe('GET /install (Linear Agent app not configured)', () => {
  it('409s and creates no integration row when LINEAR_AGENT_* env is unset', async () => {
    const seed = await seedOrg();
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      const ctx: ActorCtx = {
        orgId: seed.orgId,
        actorId: seed.actorId,
        roleId: null,
        capabilities: ['view', 'contribute', 'manage'],
      };
      c.set('actorCtx', ctx);
      await next();
    });
    app.route('/', integrationsLinearAgent);
    app.onError(onError);

    const res = await app.request('/install');
    expect(res.status).toBe(409);

    const rows = await db
      .select()
      .from(schema.integration)
      .where(
        and(
          eq(schema.integration.organizationId, seed.orgId),
          eq(schema.integration.provider, 'linear_agent'),
        ),
      );
    expect(rows).toHaveLength(0);
  });
});

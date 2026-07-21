import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type ingestLinearAgentRouter from '../../src/routes/ingest-linear-agent';

/**
 * This file deliberately does NOT set `LINEAR_AGENT_CLIENT_ID`/`_SECRET`/`_WEBHOOK_SECRET` — the
 * shared baseline (`tests/support/env.ts`) leaves them unset, exercising the "app not configured"
 * degrade path in its own module registry so it never collides with `ingest-linear-agent.test.ts`'s
 * configured variant (mirrors `integrations-linear-agent-unconfigured.test.ts`'s own rationale).
 */
const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let ingestLinearAgent!: typeof ingestLinearAgentRouter;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  ingestLinearAgent = (await import('../../src/routes/ingest-linear-agent')).default;
});

describe('POST /internal/ingest/linear-agent (Linear Agent app not configured)', () => {
  it('404s and writes nothing when LINEAR_AGENT_* env is unset', async () => {
    const res = await ingestLinearAgent.request('/linear-agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'linear-signature': 'whatever' },
      body: JSON.stringify({
        action: 'created',
        webhookTimestamp: Date.now(),
        organizationId: 'ws_whatever',
        agentSession: { id: 'las_unconfigured' },
      }),
    });
    expect(res.status).toBe(404);

    const rows = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.externalRunRef, 'linear-agent-session:las_unconfigured'));
    expect(rows).toHaveLength(0);
  });
});

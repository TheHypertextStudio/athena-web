import { resolve } from 'node:path';

import { Hono } from 'hono';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as DbModule from '@docket/db';
import type * as BoundariesModule from '@docket/boundaries';
import type { AgentSessionDetailOut } from '@docket/types';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type agentSessionsRouter from '../../src/routes/agent-sessions';
import type { getContainer as GetContainer } from '../../src/container';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';
process.env['AGENT_MAX_TURNS'] = '8';

const MIGRATIONS = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let boundaries!: typeof BoundariesModule;
let agentSessions!: typeof agentSessionsRouter;
let getContainer!: typeof GetContainer;

beforeAll(async () => {
  schema = await import('@docket/db');
  db = schema.db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  boundaries = await import('@docket/boundaries');
  agentSessions = (await import('../../src/routes/agent-sessions')).default;
  ({ getContainer } = await import('../../src/container'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const J = { 'content-type': 'application/json' };

async function seedOrg(): Promise<{ orgId: string; humanActorId: string }> {
  const slug = `ch-${Math.random().toString(36).slice(2, 10)}`;
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
  return { orgId: org!.id, humanActorId: human!.id };
}

function appFor(orgId: string, actorId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const ctx: ActorCtx = {
      orgId,
      actorId,
      roleId: 'role_test',
      capabilities: ['view', 'contribute', 'assign'],
    };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', agentSessions);
  app.onError(onError);
  return app;
}

/** Script N text-only turns (chat exchanges), indexed by assistant-message count. */
function chatScript(replies: readonly string[]): readonly BoundariesModule.ScriptedTurn[] {
  return replies.map((text) => ({
    message: { role: 'assistant' as const, content: [{ type: 'text' as const, text }] },
    stopReason: 'end_turn' as const,
  }));
}

describe('the Athena chat thread', () => {
  it('lazily creates the one chat session and reuses it across messages', async () => {
    const seed = await seedOrg();
    const app = appFor(seed.orgId, seed.humanActorId);

    const first = await app.request('/chat', { method: 'GET' });
    expect(first.status).toBe(200);
    const thread = (await first.json()) as AgentSessionDetailOut;
    expect(thread.activities).toHaveLength(0);

    const again = await app.request('/chat', { method: 'GET' });
    expect(((await again.json()) as AgentSessionDetailOut).id).toBe(thread.id);

    const rows = await db
      .select()
      .from(schema.agentSession)
      .where(eq(schema.agentSession.organizationId, seed.orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('chat');
  });

  it('answers a message and keeps the conversation across exchanges', async () => {
    const seed = await seedOrg();
    const app = appFor(seed.orgId, seed.humanActorId);
    const runtime = new boundaries.MockAgentTurnRuntime({
      script: chatScript(['You have three tasks due today.', 'Nothing else is urgent.']),
    });
    const spy = vi
      .spyOn(getContainer().agentTurn, 'streamTurn')
      .mockImplementation((input) => runtime.streamTurn(input));

    const one = await app.request('/chat/messages', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ body: "What's on my plate today?" }),
    });
    expect(one.status).toBe(200);
    const afterOne = (await one.json()) as AgentSessionDetailOut;
    expect(afterOne.status).toBe('completed');
    const texts = afterOne.activities.map((a) => a.body['text']);
    expect(texts).toContain("What's on my plate today?");
    expect(texts).toContain('You have three tasks due today.');

    const two = await app.request('/chat/messages', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ body: 'Anything urgent besides those?' }),
    });
    expect(two.status).toBe(200);
    const afterTwo = (await two.json()) as AgentSessionDetailOut;
    expect(afterTwo.id).toBe(afterOne.id);
    expect(afterTwo.activities.map((a) => a.body['text'])).toContain('Nothing else is urgent.');

    // The SECOND exchange saw the FIRST in its conversation (one thread, one transcript).
    const lastCall = spy.mock.calls.at(-1)?.[0];
    const flat = JSON.stringify(lastCall?.messages);
    expect(flat).toContain("What's on my plate today?");
    expect(flat).toContain('You have three tasks due today.');

    // User messages are marked so the chat surface can right-align them.
    const userMsgs = afterTwo.activities.filter((a) => a.body['author'] === 'user');
    expect(userMsgs).toHaveLength(2);
  });
});

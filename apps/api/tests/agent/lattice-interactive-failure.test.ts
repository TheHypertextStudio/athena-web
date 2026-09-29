import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

import type * as AgentRuntimeModule from '@docket/athena/turn';
import type * as DbModule from '@docket/db';
import { LatticeUnavailableError } from '@docket/integrations';
import { assertDefined } from '@docket/test-utils';

import type { driveSession as DriveSession } from '../../src/agent/loop';
import { getMigratedDb } from '../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let driveSession!: typeof DriveSession;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  ({ driveSession } = await import('../../src/agent/loop'));
});

describe('a personal Lattice turn that cannot reach its computer', () => {
  it('saves a safe, actionable reason without exposing gateway diagnostics', async () => {
    const suffix = Math.random().toString(36).slice(2, 10);
    const [owner] = await db
      .insert(schema.user)
      .values({ name: 'Ada', email: `offline-${suffix}@example.com` })
      .returning({ id: schema.user.id });
    const ownerUserId = assertDefined(owner).id;
    await db.insert(schema.hub).values({ userId: ownerUserId });
    const [session] = await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId,
        trigger: 'delegation',
        kind: 'chat',
        status: 'pending',
      })
      .returning({ id: schema.agentSession.id });
    const sessionId = assertDefined(session).id;
    await db.insert(schema.sessionActivity).values({
      sessionId,
      organizationId: null,
      type: 'response',
      body: { text: 'Help me plan', author: 'user' },
    });
    const turnRuntime: AgentRuntimeModule.AgentTurnRuntime = {
      async *streamTurn(): AsyncIterable<AgentRuntimeModule.TurnEvent> {
        yield await Promise.reject<AgentRuntimeModule.TurnEvent>(
          new LatticeUnavailableError('device_offline', 'private gateway diagnostic'),
        );
      },
    };

    await expect(driveSession('personal', sessionId, { turnRuntime })).rejects.toMatchObject({
      reason: 'device_offline',
    });

    const errors = await db
      .select({ body: schema.sessionActivity.body })
      .from(schema.sessionActivity)
      .where(
        and(
          eq(schema.sessionActivity.sessionId, sessionId),
          eq(schema.sessionActivity.type, 'error'),
        ),
      );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.body).toMatchObject({ source: 'lattice', code: 'device_offline' });
    expect(JSON.stringify(errors[0]?.body)).not.toContain('private gateway diagnostic');
  });
});

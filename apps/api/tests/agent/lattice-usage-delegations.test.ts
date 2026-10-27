import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  process.env['CREDENTIALS_ENCRYPTION_KEY'] = Buffer.from('0'.repeat(32)).toString('base64');
});

import type * as DbModule from '@docket/db';
import { getDb } from '../support/routes-harness';
import { dependencies, prepareProposedResult, seed } from '../support/lattice-delegation-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

describe('durable Lattice usage', () => {
  it.each([true, false])('rolls up a retained result once, measured=%s', async (measured) => {
    const fixture = await seed();
    const deps = dependencies();
    vi.mocked(deps.openWork).mockResolvedValue({
      providerId: 'agent-runtime',
      model: 'local-model',
      outputText: 'Result',
      computeCounter: { outputTokens: 0, wallClockMs: 50, gpuActiveMs: 0 },
      ...(measured ? { usage: { inputTokens: 120, outputTokens: 12 } } : {}),
    });
    const now = new Date('2026-10-26T12:00:00Z');
    const proposed = await prepareProposedResult(fixture, deps, now);
    const { rollupAiTokens } = await import('../../src/services/usage-cost/ai-tokens');
    const window = { from: '2026-10-26', to: '2026-10-27' };
    await rollupAiTokens(window);
    await rollupAiTokens(window);
    const rows = await db
      .select()
      .from(schema.usageDaily)
      .where(
        and(
          eq(schema.usageDaily.userId, fixture.assignment.ownerUserId),
          eq(schema.usageDaily.resource, 'ai_input_tokens'),
          eq(schema.usageDaily.dimension, 'lattice:local-model'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      quantity: measured ? 120 : 0,
      unmeasuredEvents: measured ? 0 : 1,
    });
    // Human review may settle later, but must not move remote computation to another day.
    await db
      .update(schema.agentDelegation)
      .set({ updatedAt: new Date('2026-11-01T00:00:00Z') })
      .where(eq(schema.agentDelegation.id, proposed.delegation.id));
    await rollupAiTokens(window);
    const after = await db
      .select()
      .from(schema.usageDaily)
      .where(
        and(
          eq(schema.usageDaily.userId, fixture.assignment.ownerUserId),
          eq(schema.usageDaily.resource, 'ai_input_tokens'),
          eq(schema.usageDaily.dimension, 'lattice:local-model'),
        ),
      );
    expect(after).toHaveLength(1);
  });
});

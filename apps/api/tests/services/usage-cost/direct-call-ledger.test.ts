import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import { rollupAiTokens } from '../../../src/services/usage-cost/ai-tokens';
import { getDb, seedUserWithHub } from '../../support/routes-harness';
let schema!: typeof DbModule;
beforeAll(async () => {
  schema = await getDb();
});
beforeEach(async () => {
  await schema.db.delete(schema.aiCallUsage);
  await schema.db.delete(schema.usageDaily);
  await schema.db.delete(schema.agentSessionRun);
  await schema.db.delete(schema.agentSession);
});
describe('direct call token rollup', () => {
  it('sums measured calls while preserving unknown calls and local dimensions across retries', async () => {
    const { db, aiCallUsage, usageDaily } = schema;
    const userId = await seedUserWithHub(db, schema, 'Direct calls');
    const base = {
      source: 'email_synthesis',
      userId,
      occurredAt: new Date('2026-10-25T08:00:00Z'),
      model: 'test',
    };
    await db.insert(aiCallUsage).values([
      { ...base, inputTokens: 10, outputTokens: 4 },
      { ...base, inputTokens: 3, outputTokens: 1 },
      { ...base, backend: 'lattice' },
      { ...base, occurredAt: new Date('2026-10-24T08:00:00Z'), inputTokens: 99 },
    ]);
    const window = { from: '2026-10-25', to: '2026-10-26' };
    await rollupAiTokens(window);
    const first = await db.select().from(usageDaily);
    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId,
          dimension: 'test',
          resource: 'ai_input_tokens',
          quantity: 13,
          unmeasuredEvents: 0,
        }),
        expect.objectContaining({ dimension: 'test', resource: 'ai_output_tokens', quantity: 5 }),
        expect.objectContaining({
          dimension: 'lattice:test',
          resource: 'ai_input_tokens',
          quantity: 0,
          unmeasuredEvents: 1,
        }),
      ]),
    );
    expect(first).toHaveLength(3);
    await rollupAiTokens(window);
    const repeat = await db.select().from(usageDaily);
    expect(repeat.map(({ id: _, updatedAt: __, ...row }) => row)).toEqual(
      first.map(({ id: _, updatedAt: __, ...row }) => row),
    );
  });
});

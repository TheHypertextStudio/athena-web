import { describe, expect, it } from 'vitest';
import { MockAgentTurnRuntime, type AgentTurnRuntime } from '@docket/athena/turn';
import {
  meterMessageCreator,
  meterTurnRuntime,
  withAiUsage,
} from '../../../src/services/usage-cost/direct-calls';

const scope = { source: 'daily_assessment', userId: 'person', organizationId: null };

describe('direct provider capture', () => {
  it('retains message counts before downstream parsing fails', async () => {
    const records: unknown[] = [];
    const create = meterMessageCreator(
      async () => ({ model: 'test', usage: { input_tokens: 12, output_tokens: 3 }, content: [] }),
      async (record) => {
        records.push(record);
      },
    );
    await expect(
      withAiUsage(scope, async () => {
        await create({});
        throw new Error('invalid output');
      }),
    ).rejects.toThrow('invalid output');
    expect(records).toEqual([
      expect.objectContaining({ ...scope, model: 'test', inputTokens: 12, outputTokens: 3 }),
    ]);
  });

  it('keeps concurrent caller attribution separate', async () => {
    const records: { userId: string | null }[] = [];
    const create = meterMessageCreator(
      async (input: { wait: Promise<void> }) => {
        await input.wait;
        return { model: 'test', usage: { input_tokens: 1, output_tokens: 1 } };
      },
      async (record) => {
        records.push(record);
      },
    );
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withAiUsage({ ...scope, userId: 'first' }, () => create({ wait }));
    await withAiUsage({ ...scope, userId: 'second' }, () => create({ wait: Promise.resolve() }));
    release();
    await first;
    expect(records.map((record) => record.userId)).toEqual(['second', 'first']);
  });

  it('records provider failures as unmeasured without swallowing the error', async () => {
    const records: unknown[] = [];
    const create = meterMessageCreator(
      async () => {
        throw new Error('offline');
      },
      async (record) => {
        records.push(record);
      },
    );
    await expect(withAiUsage(scope, () => create({}))).rejects.toThrow('offline');
    expect(records).toEqual([expect.objectContaining({ inputTokens: null, outputTokens: null })]);
  });

  it('does not independently meter a provider call outside an explicit direct-call scope', async () => {
    const records: unknown[] = [];
    const create = meterMessageCreator(
      async () => ({ model: 'test', usage: { input_tokens: 1, output_tokens: 1 } }),
      async (record) => {
        records.push(record);
      },
    );
    await create({});
    expect(records).toEqual([]);
  });

  it('retains terminal stream counts exactly once', async () => {
    const records: unknown[] = [];
    const usage = {
      model: 'local',
      inputTokens: 8,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
    };
    const runtime: AgentTurnRuntime = {
      async *streamTurn() {
        yield {
          type: 'turn_end',
          message: { role: 'assistant', content: [] },
          stopReason: 'end_turn',
          usage,
          usageBackend: 'lattice',
        };
      },
    };
    for await (const event of meterTurnRuntime(runtime, scope, async (record) => {
      records.push(record);
    }).streamTurn({ system: '', messages: [], tools: [] })) {
      expect(event.type).toBe('turn_end');
    }
    expect(records).toEqual([
      expect.objectContaining({
        ...scope,
        backend: 'lattice',
        model: 'local',
        inputTokens: 8,
        cacheWriteTokens: 4,
      }),
    ]);
  });

  it('does not charge deterministic development turns', () => {
    const runtime = new MockAgentTurnRuntime();
    expect(meterTurnRuntime(runtime, scope)).toBe(runtime);
  });

  it('records an interrupted stream once without fabricating counts', async () => {
    const records: unknown[] = [];
    const runtime: AgentTurnRuntime = {
      async *streamTurn() {
        yield { type: 'text', text: 'first' };
        yield { type: 'text', text: 'second' };
      },
    };
    for await (const event of meterTurnRuntime(runtime, scope, async (record) => {
      records.push(record);
    }).streamTurn({ system: '', messages: [], tools: [] })) {
      expect(event.type).toBe('text');
      break;
    }
    expect(records).toEqual([expect.objectContaining({ ...scope, inputTokens: null })]);
  });
});

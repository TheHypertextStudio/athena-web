import { describe, expect, it } from 'vitest';

import { LatticeAgentTurnRuntime } from '../src/turn/adapters/lattice';
import type { TurnEvent, TurnUsage } from '../src/turn/turn';

const usage: TurnUsage = {
  inputTokens: 120,
  outputTokens: 12,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  model: 'local-model',
};

async function terminal(text: string, measured: boolean): Promise<TurnEvent | undefined> {
  const runtime = new LatticeAgentTurnRuntime({
    chat: { runChat: async () => ({ text, ...(measured ? { usage } : {}) }) },
  });
  let last: TurnEvent | undefined;
  for await (const event of runtime.streamTurn({
    system: 'Athena',
    messages: [],
    tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }],
  }))
    last = event;
  return last;
}

describe('Lattice turn usage', () => {
  it.each(['Done.', '```json\n{"tool":"search","input":{}}\n```'])(
    'preserves reported usage for %s',
    async (text) => {
      expect(await terminal(text, true)).toMatchObject({
        type: 'turn_end',
        usage,
        usageBackend: 'lattice',
      });
    },
  );

  it('leaves missing usage unmeasured', async () => {
    const event = await terminal('Done.', false);
    expect(event?.type === 'turn_end' ? event.usage : null).toBeUndefined();
    expect(event).toMatchObject({ usageBackend: 'lattice' });
  });

  it.each([true, false])(
    'keeps an incomplete correction total unmeasured, first measured=%s',
    async (firstMeasured) => {
      let calls = 0;
      const runtime = new LatticeAgentTurnRuntime({
        chat: {
          runChat: async () => {
            const first = calls++ === 0;
            return {
              text: first ? '<tool_call>{}</tool_call>' : 'Done.',
              usage: first === firstMeasured ? usage : undefined,
            };
          },
        },
      });
      let last: TurnEvent | undefined;
      for await (const event of runtime.streamTurn({ system: 'Athena', messages: [], tools: [] }))
        last = event;
      expect(last?.type === 'turn_end' ? last.usage : null).toBeUndefined();
      expect(last).toMatchObject({ usageBackend: 'lattice' });
    },
  );

  it('counts both calls when correcting unsupported tool syntax', async () => {
    let calls = 0;
    const runtime = new LatticeAgentTurnRuntime({
      chat: {
        runChat: async () => ({
          text: calls++ === 0 ? '<tool_call>{}</tool_call>' : 'Done.',
          usage,
        }),
      },
    });
    let last: TurnEvent | undefined;
    for await (const event of runtime.streamTurn({ system: 'Athena', messages: [], tools: [] }))
      last = event;
    expect(last).toMatchObject({
      type: 'turn_end',
      usage: { ...usage, inputTokens: 240, outputTokens: 24 },
    });
  });
});

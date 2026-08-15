import { describe, expect, it } from 'vitest';

import { TurnContentBlock, TurnMessage } from '../src/turn-protocol';

describe('Athena turn protocol', () => {
  it('owns the lossless durable transcript grammar', () => {
    const message = {
      role: 'assistant' as const,
      content: [
        {
          type: 'thinking' as const,
          thinking: 'I should check the task first.',
          signature: 'sig_1',
        },
        { type: 'text' as const, text: 'I found the task.' },
        {
          type: 'tool_use' as const,
          id: 'toolu_1',
          name: 'work__get_task',
          input: { id: 'task_1' },
        },
        {
          type: 'tool_result' as const,
          toolUseId: 'toolu_1',
          content: '{"id":"task_1"}',
          isError: false,
        },
      ],
    };

    expect(TurnMessage.parse(message)).toEqual(message);
    expect(
      TurnContentBlock.safeParse({ type: 'thinking', thinking: 'missing proof' }).success,
    ).toBe(false);
    expect(
      TurnContentBlock.safeParse({
        type: 'tool_result',
        toolUseId: 'toolu_1',
        content: '{}',
        isError: 'false',
      }).success,
    ).toBe(false);
    expect(TurnMessage.safeParse({ role: 'system', content: [] }).success).toBe(false);
  });
});

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageCreateParamsBase,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TURN_MAX_TOKENS,
  DEFAULT_TURN_MODEL,
  MockAgentTurnRuntime,
  RealAgentTurnRuntime,
  SCRIPTED_TURNS,
  SUNSAMA_IMPORT_TURNS,
  buildTurnRequest,
  defaultTurnStreamer,
  translateTurnEvents,
  wrapTurnError,
  type TurnEvent,
  type TurnInput,
  type TurnMessage,
  type TurnStreamer,
} from '../src';

type ContentBlockDeltaEvent = Extract<RawMessageStreamEvent, { type: 'content_block_delta' }>;

/** Wrap a fixed event array as an async iterable. */
async function* asStream(events: RawMessageStreamEvent[]): AsyncIterable<RawMessageStreamEvent> {
  for (const e of events) yield e;
}

/** Build a `content_block_start` for a text block. */
function textStart(index: number): RawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '', citations: null },
  };
}

/** Build a `content_block_start` for a thinking block. */
function thinkingStart(index: number): RawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'thinking', thinking: '', signature: '' },
  };
}

/** Build a `content_block_start` for a tool_use block. */
function toolStart(index: number, id: string, name: string): RawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id, name, input: {}, caller: { type: 'direct' } },
  };
}

/** A content-block delta event. */
function delta(index: number, eventDelta: ContentBlockDeltaEvent['delta']): RawMessageStreamEvent {
  return { type: 'content_block_delta', index, delta: eventDelta };
}

/** A content_block_stop event. */
function stop(index: number): RawMessageStreamEvent {
  return { type: 'content_block_stop', index };
}

/** A message_delta carrying the turn's stop reason. */
function stopReason(reason: string): RawMessageStreamEvent {
  return {
    type: 'message_delta',
    delta: { stop_reason: reason, stop_sequence: null },
    usage: { output_tokens: 1 },
  } as RawMessageStreamEvent;
}

/** Collect a turn-event stream into an array. */
async function collect(stream: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

/** A minimal single-user-message turn input. */
function turnInput(overrides: Partial<TurnInput> = {}): TurnInput {
  return {
    system: 'You are Athena.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Plan my day.' }] }],
    tools: [
      {
        name: 'create_task',
        description: 'Create a task.',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      },
    ],
    ...overrides,
  };
}

/** A turn input whose message history contains the given number of assistant turns. */
function inputWithAssistantTurns(count: number): TurnInput {
  const messages: TurnMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'Import my Sunsama backlog.' }] },
  ];
  for (let i = 0; i < count; i++) {
    messages.push({ role: 'assistant', content: [{ type: 'text', text: `turn ${i}` }] });
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: `toolu_${i}`, content: 'ok', isError: false }],
    });
  }
  return { system: 'You are Athena.', messages, tools: [] };
}

describe('MockAgentTurnRuntime', () => {
  it('replays the default script based on assistant-message count', async () => {
    const runtime = new MockAgentTurnRuntime();
    const first = await collect(runtime.streamTurn(inputWithAssistantTurns(0)));
    const second = await collect(runtime.streamTurn(inputWithAssistantTurns(1)));
    expect(first.at(-1)).toEqual({
      type: 'turn_end',
      stopReason: 'tool_use',
      message: SCRIPTED_TURNS[0]?.message,
    });
    expect(second.at(-1)).toEqual({
      type: 'turn_end',
      stopReason: 'end_turn',
      message: SCRIPTED_TURNS[1]?.message,
    });
  });

  it('throws a clear error when the conversation is past the end of the script', async () => {
    const runtime = new MockAgentTurnRuntime();
    await expect(
      collect(runtime.streamTurn(inputWithAssistantTurns(SCRIPTED_TURNS.length))),
    ).rejects.toThrow(/script/i);
  });

  it('keeps the Sunsama import script batched and uniquely paired', () => {
    expect(SUNSAMA_IMPORT_TURNS).toHaveLength(3);
    const creates =
      SUNSAMA_IMPORT_TURNS[1]?.message.content.flatMap((b) => (b.type === 'tool_use' ? [b] : [])) ??
      [];
    expect(creates.every((c) => c.name === 'create_task')).toBe(true);
    const ids = SUNSAMA_IMPORT_TURNS.flatMap((t) =>
      t.message.content.flatMap((b) => (b.type === 'tool_use' ? [b.id] : [])),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildTurnRequest', () => {
  it('maps system, tools, and defaults onto a streaming request with adaptive thinking', () => {
    const params = buildTurnRequest(turnInput(), { apiKey: 'sk-ant-x' });
    expect(params.model).toBe(DEFAULT_TURN_MODEL);
    expect(params.max_tokens).toBe(DEFAULT_TURN_MAX_TOKENS);
    expect(params.system).toBe('You are Athena.');
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(params.tools?.[0]).toEqual({
      name: 'create_task',
      description: 'Create a task.',
      input_schema: { type: 'object', properties: { title: { type: 'string' } } },
    });
  });

  it('round-trips thinking signatures, tool calls, and tool results', () => {
    const messages: TurnMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Import my backlog.' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Reading the source first.', signature: 'sig-1' },
          { type: 'tool_use', id: 'toolu_1', name: 'sunsama__get_backlog_tasks', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'toolu_1', content: '[{"title":"a"}]', isError: false },
        ],
      },
    ];
    expect(buildTurnRequest(turnInput({ messages }), { apiKey: 'k' }).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Import my backlog.' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Reading the source first.', signature: 'sig-1' },
          { type: 'tool_use', id: 'toolu_1', name: 'sunsama__get_backlog_tasks', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: '[{"title":"a"}]',
            is_error: false,
          },
        ],
      },
    ]);
  });
});

describe('translateTurnEvents', () => {
  it('streams block events and ends with the assembled assistant message', async () => {
    const events: RawMessageStreamEvent[] = [
      thinkingStart(0),
      delta(0, { type: 'thinking_delta', thinking: 'Reviewing.' }),
      delta(0, { type: 'signature_delta', signature: 'sig-abc' }),
      stop(0),
      toolStart(1, 'toolu_9', 'create_task'),
      delta(1, { type: 'input_json_delta', partial_json: '{"title":"Prep interview"}' }),
      stop(1),
      textStart(2),
      delta(2, { type: 'text_delta', text: 'Creating the task now.' }),
      stop(2),
      stopReason('tool_use'),
    ];
    expect(await collect(translateTurnEvents(asStream(events)))).toEqual<TurnEvent[]>([
      { type: 'thinking', text: 'Reviewing.' },
      { type: 'tool_use', id: 'toolu_9', name: 'create_task', input: { title: 'Prep interview' } },
      { type: 'text', text: 'Creating the task now.' },
      {
        type: 'turn_end',
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Reviewing.', signature: 'sig-abc' },
            {
              type: 'tool_use',
              id: 'toolu_9',
              name: 'create_task',
              input: { title: 'Prep interview' },
            },
            { type: 'text', text: 'Creating the task now.' },
          ],
        },
      },
    ]);
  });

  it('normalizes missing or malformed tool input to an empty object', async () => {
    const out = await collect(
      translateTurnEvents(asStream([toolStart(0, 'toolu_1', 'list_tasks'), stop(0)])),
    );
    expect(out[0]).toEqual({ type: 'tool_use', id: 'toolu_1', name: 'list_tasks', input: {} });
  });

  it('maps provider stop reasons and skips blank blocks', async () => {
    const out = await collect(
      translateTurnEvents(
        asStream([
          textStart(0),
          delta(0, { type: 'text_delta', text: '   ' }),
          stop(0),
          stopReason('pause_turn'),
        ]),
      ),
    );
    expect(out).toEqual([
      { type: 'turn_end', stopReason: 'end_turn', message: { role: 'assistant', content: [] } },
    ]);
  });
});

describe('RealAgentTurnRuntime', () => {
  it('drives one turn through the injected streamer and yields translated events', async () => {
    let received: MessageCreateParamsBase | undefined;
    const streamer: TurnStreamer = (params) => {
      received = params;
      return asStream([
        textStart(0),
        delta(0, { type: 'text_delta', text: 'Done.' }),
        stop(0),
        stopReason('end_turn'),
      ]);
    };
    const runtime = new RealAgentTurnRuntime({ apiKey: 'sk-ant-test' }, streamer);
    expect((await collect(runtime.streamTurn(turnInput()))).map((e) => e.type)).toEqual([
      'text',
      'turn_end',
    ]);
    expect(received?.model).toBe(DEFAULT_TURN_MODEL);
  });

  it('wraps provider errors and exposes a default SDK-backed streamer factory', async () => {
    const streamer: TurnStreamer = () => {
      throw new Anthropic.RateLimitError(
        429,
        { type: 'rate_limit_error' },
        'slow down',
        new Headers(),
      );
    };
    const runtime = new RealAgentTurnRuntime({ apiKey: 'k' }, streamer);
    await expect(async () => {
      for await (const _ of runtime.streamTurn(turnInput())) void _;
    }).rejects.toThrow(/429/);
    expect(wrapTurnError(new Error('socket hang up')).message).toMatch(/socket hang up/);
    expect(typeof defaultTurnStreamer({ apiKey: 'sk-ant-unit' })).toBe('function');
  });
});

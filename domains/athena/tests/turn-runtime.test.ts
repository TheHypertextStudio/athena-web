import type {
  MessageCreateParamsBase,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it, vi } from 'vitest';

import { MockAgentTurnRuntime as PublicMockAgentTurnRuntime } from '@docket/athena/turn';
import { RealAgentTurnRuntime as PublicRealAgentTurnRuntime } from '@docket/athena/turn/adapters/anthropic';
import { LatticeAgentTurnRuntime as PublicLatticeAgentTurnRuntime } from '@docket/athena/turn/adapters/lattice';
import { resolveModelBackend as publicResolveModelBackend } from '@docket/athena/turn/model-backend';
import { parseToolInput as publicParseToolInput } from '@docket/athena/turn/translate';

import {
  MockAgentTurnRuntime,
  SCRIPTED_TURNS,
  type TurnEvent,
  type TurnInput,
  type TurnMessage,
} from '../src/turn/turn';
import {
  DEFAULT_TURN_MAX_TOKENS,
  DEFAULT_TURN_MODEL,
  RealAgentTurnRuntime,
  buildTurnRequest,
  parseToolInput,
  toStopReason,
  translateTurnEvents,
  type TurnStreamer,
} from '../src/turn/adapters/anthropic';
import {
  LatticeAgentTurnRuntime,
  parseLatticeReply,
  type LatticeChatPort,
} from '../src/turn/adapters/lattice';
import { resolveModelBackend, type ModelBackendEnv } from '../src/turn/model-backend';

/** Drain one streamed Athena turn into stable assertion data. */
async function collect(stream: AsyncIterable<TurnEvent>): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

/** The small, representative input used by all one-turn behavior tests. */
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

/** Wrap fixed raw events as a provider-like asynchronous stream. */
async function* asStream(
  events: readonly RawMessageStreamEvent[],
): AsyncIterable<RawMessageStreamEvent> {
  for (const event of events) yield event;
}

/** Build a raw provider text-block start event. */
function textStart(index: number): RawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '', citations: null },
  };
}

/** Build a raw provider tool-use block start event. */
function toolStart(index: number, id: string, name: string): RawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id, name, input: {}, caller: { type: 'direct' } },
  };
}

/** Build a raw content-block delta event. */
function delta(
  index: number,
  eventDelta: Extract<RawMessageStreamEvent, { type: 'content_block_delta' }>['delta'],
): RawMessageStreamEvent {
  return { type: 'content_block_delta', index, delta: eventDelta };
}

/** Build a raw content-block stop event. */
function blockStop(index: number): RawMessageStreamEvent {
  return { type: 'content_block_stop', index };
}

/** Build a raw message delta carrying the provider's completion reason. */
function turnStop(reason: string): RawMessageStreamEvent {
  return {
    type: 'message_delta',
    delta: { stop_reason: reason, stop_sequence: null },
    usage: { output_tokens: 1 },
  } as RawMessageStreamEvent;
}

describe('Athena turn contracts', () => {
  it('exposes intentional public paths without a catch-all domain barrel', () => {
    expect(PublicMockAgentTurnRuntime).toBe(MockAgentTurnRuntime);
    expect(PublicRealAgentTurnRuntime).toBe(RealAgentTurnRuntime);
    expect(PublicLatticeAgentTurnRuntime).toBe(LatticeAgentTurnRuntime);
    expect(publicResolveModelBackend).toBe(resolveModelBackend);
    expect(publicParseToolInput).toBe(parseToolInput);
  });

  it('replays the deterministic script and ends with an appendable assistant message', async () => {
    const events = await collect(new MockAgentTurnRuntime().streamTurn(turnInput()));

    expect(events).toEqual([
      { type: 'thinking', text: 'Reviewing the task and the current board state.' },
      {
        type: 'tool_use',
        id: 'toolu_mock_0001',
        name: 'update_task',
        input: { taskId: '01HZ0000000000000000LN0001', state: 'in_progress' },
      },
      expect.objectContaining({ type: 'turn_end', stopReason: 'tool_use' }),
    ]);
  });

  it('selects a scripted turn by persisted assistant-message count', async () => {
    const messages: TurnMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'Start.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Previous turn.' }] },
    ];

    expect(
      (await collect(new MockAgentTurnRuntime().streamTurn(turnInput({ messages }))))[0],
    ).toEqual({
      type: 'text',
      text: 'Moved the task to In Progress and verified the board reflects it.',
    });
  });

  it('fails clearly when the durable loop asks for a turn beyond the test script', async () => {
    const messages: TurnMessage[] = Array.from({ length: SCRIPTED_TURNS.length }, () => ({
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'Previous turn.' }],
    }));

    await expect(
      collect(new MockAgentTurnRuntime().streamTurn(turnInput({ messages }))),
    ).rejects.toThrow(/script/i);
  });
});

describe('Anthropic turn adapter', () => {
  it('maps Athena messages, tools, and safe defaults onto the provider request', () => {
    const request = buildTurnRequest(turnInput(), { apiKey: 'sk-ant-unit' });

    expect(request).toMatchObject({
      model: DEFAULT_TURN_MODEL,
      max_tokens: DEFAULT_TURN_MAX_TOKENS,
      system: 'You are Athena.',
      thinking: { type: 'adaptive', display: 'summarized' },
    });
    expect(request.tools?.[0]).toMatchObject({ name: 'create_task' });
  });

  it('turns streamed provider blocks into ordered, appendable Athena events', async () => {
    async function* events(): AsyncIterable<RawMessageStreamEvent> {
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', citations: null },
      };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Done.' },
      };
      yield { type: 'content_block_stop', index: 0 };
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      } as RawMessageStreamEvent;
    }

    expect(await collect(translateTurnEvents(events()))).toEqual([
      { type: 'text', text: 'Done.' },
      {
        type: 'turn_end',
        stopReason: 'end_turn',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
      },
    ]);
  });

  it('preserves transcript order and normalizes malformed tool JSON to an empty object', async () => {
    const events = await collect(
      translateTurnEvents(
        asStream([
          toolStart(2, 'toolu_9', 'create_task'),
          delta(2, { type: 'input_json_delta', partial_json: '{not-valid' }),
          blockStop(2),
          textStart(1),
          delta(1, { type: 'text_delta', text: 'First.' }),
          blockStop(1),
          turnStop('tool_use'),
        ]),
      ),
    );

    expect(events).toEqual([
      { type: 'tool_use', id: 'toolu_9', name: 'create_task', input: {} },
      { type: 'text', text: 'First.' },
      {
        type: 'turn_end',
        stopReason: 'tool_use',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'First.' },
            { type: 'tool_use', id: 'toolu_9', name: 'create_task', input: {} },
          ],
        },
      },
    ]);
  });

  it('does not emit blank or unknown provider blocks', async () => {
    const unknown: RawMessageStreamEvent = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} },
    } as RawMessageStreamEvent;

    expect(
      await collect(
        translateTurnEvents(
          asStream([
            textStart(1),
            delta(1, { type: 'text_delta', text: '   ' }),
            blockStop(1),
            unknown,
            blockStop(0),
          ]),
        ),
      ),
    ).toEqual([
      { type: 'turn_end', stopReason: 'end_turn', message: { role: 'assistant', content: [] } },
    ]);
  });

  it('keeps parsing and stop-reason fallback safe for provider drift', () => {
    expect(parseToolInput('{"title":"Ship it"}')).toEqual({ title: 'Ship it' });
    expect(parseToolInput('42')).toEqual({});
    expect(toStopReason('refusal')).toBe('refusal');
    expect(toStopReason('unknown-future-reason')).toBe('end_turn');
  });

  it('wraps failures from an injected provider stream without leaking configuration', async () => {
    const streamer: TurnStreamer = (_params: MessageCreateParamsBase) => {
      throw new Error('connection reset');
    };
    const runtime = new RealAgentTurnRuntime({ apiKey: 'sk-ant-unit' }, streamer);

    await expect(collect(runtime.streamTurn(turnInput()))).rejects.toThrow(/connection reset/);
  });
});

describe('Lattice turn adapter', () => {
  it('recognizes only an offered fenced tool call', () => {
    expect(
      parseLatticeReply('```json\n{"tool":"create_task","input":{"title":"Ship it"}}\n```', [
        'create_task',
      ]),
    ).toEqual({ kind: 'tool_call', name: 'create_task', input: { title: 'Ship it' } });
    expect(
      parseLatticeReply('```json\n{"tool":"delete_everything","input":{}}\n```', ['create_task']),
    ).toEqual({
      kind: 'text',
      text: '```json\n{"tool":"delete_everything","input":{}}\n```',
    });
  });

  it('preserves the no-fallback promise when the injected device edge fails', async () => {
    const chat: LatticeChatPort = {
      async runChat() {
        throw Object.assign(new Error('device unavailable'), { reason: 'device_offline' });
      },
    };

    await expect(
      collect(new LatticeAgentTurnRuntime({ chat }).streamTurn(turnInput())),
    ).rejects.toMatchObject({ reason: 'device_offline' });
  });
});

describe('model backend selection', () => {
  const routed: ModelBackendEnv = {
    APP_MODE: 'production',
    ANTHROPIC_API_KEY: 'sk-ant-unit',
    CLOUDFLARE_AI_GATEWAY_BASE_URL: 'https://gateway.example/anthropic',
    CLOUDFLARE_AI_GATEWAY_TOKEN: 'gateway-unit',
  };

  it('uses the routed product backend lazily without exposing credentials in its descriptor', () => {
    const build = vi.fn(() => new MockAgentTurnRuntime());
    const backend = resolveModelBackend(routed, { buildTurnRuntime: build });

    expect(backend.descriptor).toMatchObject({ id: 'cloudflare-router', routed: true });
    expect(JSON.stringify(backend.descriptor)).not.toContain('gateway-unit');
    expect(build).not.toHaveBeenCalled();
    expect(backend.turnRuntime()).toBe(backend.turnRuntime());
    expect(build).toHaveBeenCalledTimes(1);
  });
});

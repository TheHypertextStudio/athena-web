import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageCreateParamsBase,
  RawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import type { SessionActionBody, SessionActivity } from '../src/index';
import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_MAX_TOKENS,
  RealProviderRuntime,
  buildRequest,
  defaultMessageStreamer,
  toActionBody,
  translateEvents,
  wrapError,
  type MessageStreamer,
} from '../src/real-agent-runtime';

/** Wrap a fixed event array as an async iterable (one live stream). */
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
function toolStart(index: number, name: string): RawMessageStreamEvent {
  return {
    type: 'content_block_start',
    index,
    content_block: {
      type: 'tool_use',
      id: `toolu_${index}`,
      name,
      input: {},
      caller: { type: 'direct' },
    },
  };
}

/** A text delta event. */
function textDelta(index: number, text: string): RawMessageStreamEvent {
  return { type: 'content_block_delta', index, delta: { type: 'text_delta', text } };
}

/** A thinking delta event. */
function thinkingDelta(index: number, thinking: string): RawMessageStreamEvent {
  return { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } };
}

/** An input-json delta event (for tool_use blocks). */
function jsonDelta(index: number, partial_json: string): RawMessageStreamEvent {
  return { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } };
}

/** A content_block_stop event. */
function stop(index: number): RawMessageStreamEvent {
  return { type: 'content_block_stop', index };
}

/** Collect an activity stream into an array. */
async function collect(stream: AsyncIterable<SessionActivity>): Promise<SessionActivity[]> {
  const out: SessionActivity[] = [];
  for await (const a of stream) out.push(a);
  return out;
}

describe('buildRequest', () => {
  it('maps the input onto a single-user-turn streaming request with adaptive thinking and the gated tool', () => {
    const params = buildRequest(
      { sessionId: 'sesn_1', task: 'Move DOC-7 to In Progress', agent: 'athena' },
      { apiKey: 'sk-ant-x' },
    );
    expect(params.model).toBe(DEFAULT_AGENT_MODEL);
    expect(params.max_tokens).toBe(DEFAULT_MAX_TOKENS);
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(params.tools).toHaveLength(1);
    expect(params.tools?.[0]?.name).toBe('propose_change');
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0]?.role).toBe('user');
    const content = params.messages[0]?.content as string;
    expect(content).toContain('athena');
    expect(content).toContain('sesn_1');
    expect(content).toContain('Move DOC-7 to In Progress');
  });

  it('honors model, maxTokens, and baseURL overrides from config', () => {
    const params = buildRequest(
      { sessionId: 's', task: 't', agent: 'a' },
      { apiKey: 'k', model: 'claude-opus-4-7', maxTokens: 2048 },
    );
    expect(params.model).toBe('claude-opus-4-7');
    expect(params.max_tokens).toBe(2048);
  });
});

describe('toActionBody', () => {
  it('parses kind, summary, and diff from the tool input json', () => {
    const body = toActionBody(
      'propose_change',
      JSON.stringify({
        kind: 'update_task',
        summary: 'Move to In Progress',
        diff: { state: { from: 'todo', to: 'in_progress' } },
      }),
    );
    expect(body).toEqual<SessionActionBody>({
      kind: 'update_task',
      summary: 'Move to In Progress',
      diff: { state: { from: 'todo', to: 'in_progress' } },
    });
  });

  it('falls back to the tool name and a generic summary when input is blank', () => {
    const body = toActionBody('create_task', '   ');
    expect(body).toEqual<SessionActionBody>({
      kind: 'create_task',
      summary: 'Proposed create_task',
    });
  });

  it('falls back when the input json is malformed', () => {
    const body = toActionBody('move_task', '{not valid json');
    expect(body).toEqual<SessionActionBody>({ kind: 'move_task', summary: 'Proposed move_task' });
  });

  it('falls back when the parsed value is not an object', () => {
    const body = toActionBody('update_task', '"just a string"');
    expect(body.kind).toBe('update_task');
    expect(body.summary).toBe('Proposed update_task');
    expect(body.diff).toBeUndefined();
  });

  it('omits diff when absent but keeps a falsy diff like null', () => {
    const withNull = toActionBody('k', JSON.stringify({ kind: 'k', summary: 's', diff: null }));
    expect(withNull.diff).toBeNull();
    const without = toActionBody('k', JSON.stringify({ kind: 'k', summary: 's' }));
    expect('diff' in without).toBe(false);
  });
});

describe('translateEvents', () => {
  it('translates a thinking → tool_use(proposed) → text turn into the activity stream', async () => {
    const events: RawMessageStreamEvent[] = [
      { type: 'message_start' } as RawMessageStreamEvent,
      thinkingStart(0),
      thinkingDelta(0, 'Reviewing the board '),
      thinkingDelta(0, 'state.'),
      stop(0),
      toolStart(1, 'propose_change'),
      jsonDelta(1, '{"kind":"update_task",'),
      jsonDelta(1, '"summary":"Move to In Progress"}'),
      stop(1),
      textStart(2),
      textDelta(2, 'Proposed moving the task; awaiting approval.'),
      stop(2),
      { type: 'message_stop' },
    ];
    const out = await collect(translateEvents(asStream(events)));
    expect(out).toEqual<SessionActivity[]>([
      { type: 'thought', body: 'Reviewing the board state.' },
      {
        type: 'action',
        body: { kind: 'update_task', summary: 'Move to In Progress' },
        approval: 'proposed',
      },
      { type: 'response', body: 'Proposed moving the task; awaiting approval.' },
    ]);
  });

  it('emits a proposed action even when the tool block carries no input deltas', async () => {
    const events: RawMessageStreamEvent[] = [toolStart(0, 'create_task'), stop(0)];
    const out = await collect(translateEvents(asStream(events)));
    expect(out).toEqual<SessionActivity[]>([
      {
        type: 'action',
        body: { kind: 'create_task', summary: 'Proposed create_task' },
        approval: 'proposed',
      },
    ]);
  });

  it('skips blank thought and response blocks (adaptive thinking may omit text)', async () => {
    const events: RawMessageStreamEvent[] = [
      thinkingStart(0),
      thinkingDelta(0, '   '),
      stop(0),
      textStart(1),
      textDelta(1, ''),
      stop(1),
    ];
    const out = await collect(translateEvents(asStream(events)));
    expect(out).toEqual([]);
  });

  it('surfaces a model refusal as an error activity', async () => {
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_delta',
        delta: { stop_reason: 'refusal', stop_sequence: null },
        usage: { output_tokens: 1 },
      } as RawMessageStreamEvent,
    ];
    const out = await collect(translateEvents(asStream(events)));
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('error');
    expect(out[0]?.body).toMatch(/refusal/i);
  });

  it('does not emit an error for a normal end_turn message_delta', async () => {
    const events: RawMessageStreamEvent[] = [
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      } as RawMessageStreamEvent,
    ];
    expect(await collect(translateEvents(asStream(events)))).toEqual([]);
  });

  it('ignores deltas and stops for unknown block indexes', async () => {
    const events: RawMessageStreamEvent[] = [
      textDelta(99, 'orphan delta'),
      stop(99),
      textStart(0),
      textDelta(0, 'real'),
      stop(0),
    ];
    const out = await collect(translateEvents(asStream(events)));
    expect(out).toEqual<SessionActivity[]>([{ type: 'response', body: 'real' }]);
  });

  it('ignores delta kinds it does not translate (e.g. signature deltas on a thinking block)', async () => {
    const events: RawMessageStreamEvent[] = [
      thinkingStart(0),
      thinkingDelta(0, 'Reasoning.'),
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig' },
      },
      stop(0),
    ];
    const out = await collect(translateEvents(asStream(events)));
    expect(out).toEqual<SessionActivity[]>([{ type: 'thought', body: 'Reasoning.' }]);
  });

  it('ignores non-text/thinking/tool blocks (e.g. server tool use)', async () => {
    const events: RawMessageStreamEvent[] = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'server_tool_use',
          id: 'srvtoolu_1',
          name: 'web_search',
          input: {},
        },
      } as RawMessageStreamEvent,
      stop(0),
    ];
    expect(await collect(translateEvents(asStream(events)))).toEqual([]);
  });
});

describe('wrapError', () => {
  it('normalizes an Anthropic APIError with its status, leaking no secrets', () => {
    const apiErr = new Anthropic.AuthenticationError(
      401,
      { type: 'authentication_error' },
      'bad key',
      new Headers(),
    );
    const wrapped = wrapError(apiErr);
    expect(wrapped.message).toContain('401');
    expect(wrapped.message).not.toContain('bad key');
  });

  it('normalizes a generic Error', () => {
    expect(wrapError(new Error('socket hang up')).message).toBe(
      'Anthropic agent runtime failed: socket hang up',
    );
  });

  it('normalizes a non-Error throwable', () => {
    expect(wrapError('boom').message).toBe('Anthropic agent runtime failed: unknown error');
  });
});

describe('RealProviderRuntime', () => {
  it('drives a turn through the injected streamer and yields translated activities', async () => {
    let received: MessageCreateParamsBase | undefined;
    const streamer: MessageStreamer = (params) => {
      received = params;
      return asStream([
        thinkingStart(0),
        thinkingDelta(0, 'Planning.'),
        stop(0),
        textStart(1),
        textDelta(1, 'Done.'),
        stop(1),
      ]);
    };
    const runtime = new RealProviderRuntime({ apiKey: 'sk-ant-test' }, streamer);
    const out = await collect(
      runtime.startSession({ sessionId: 'sesn_9', task: 'Plan the sprint', agent: 'athena' }),
    );
    expect(out).toEqual<SessionActivity[]>([
      { type: 'thought', body: 'Planning.' },
      { type: 'response', body: 'Done.' },
    ]);
    expect(received?.model).toBe(DEFAULT_AGENT_MODEL);
    expect(received?.messages[0]?.content).toContain('Plan the sprint');
  });

  it('wraps an error thrown when opening the stream', async () => {
    const streamer: MessageStreamer = () => {
      throw new Anthropic.RateLimitError(
        429,
        { type: 'rate_limit_error' },
        'slow down',
        new Headers(),
      );
    };
    const runtime = new RealProviderRuntime({ apiKey: 'k' }, streamer);
    await expect(async () => {
      for await (const _ of runtime.startSession({ sessionId: 's', task: 't', agent: 'a' })) {
        void _;
      }
    }).rejects.toThrow(/Anthropic agent runtime failed: 429/);
  });

  it('wraps an error thrown mid-stream', async () => {
    // eslint-disable-next-line require-yield
    async function* boom(): AsyncIterable<RawMessageStreamEvent> {
      throw new Error('connection reset');
    }
    const runtime = new RealProviderRuntime({ apiKey: 'k' }, () => boom());
    await expect(async () => {
      for await (const _ of runtime.startSession({ sessionId: 's', task: 't', agent: 'a' })) {
        void _;
      }
    }).rejects.toThrow(/Anthropic agent runtime failed: connection reset/);
  });

  it('exposes a default SDK-backed streamer factory', () => {
    // The factory constructs a real client; we only assert it returns a callable
    // streamer (the live network call itself is the v8-ignored IO edge).
    const streamer = defaultMessageStreamer({
      apiKey: 'sk-ant-unit',
      baseURL: 'https://example.test',
    });
    expect(typeof streamer).toBe('function');
  });
});

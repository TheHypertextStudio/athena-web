import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import {
  MockAgentRuntime,
  RealProviderRuntime,
  buildRequest,
  toActionBody,
  translateEvents,
  type SessionActivity,
} from '../src/agent-session';

/** Materialize an async stream so its externally observable order can be asserted. */
async function activities(
  stream: AsyncIterable<SessionActivity>,
): Promise<readonly SessionActivity[]> {
  const result: SessionActivity[] = [];
  for await (const activity of stream) result.push(activity);
  return result;
}

/** Present fixed Messages events as the provider stream boundary. */
async function* eventStream(
  events: readonly RawMessageStreamEvent[],
): AsyncIterable<RawMessageStreamEvent> {
  for (const event of events) yield event;
}

describe('Athena agent-session runtime', () => {
  it('replays the deterministic mock activity sequence without a live provider', async () => {
    const emitted = await activities(
      new MockAgentRuntime().startSession({
        sessionId: 'session_1',
        task: 'Triage work',
        agent: 'athena',
      }),
    );

    expect(emitted.map((activity) => activity.type)).toEqual([
      'thought',
      'action',
      'elicitation',
      'response',
    ]);
    expect(emitted[1]).toMatchObject({ approval: 'proposed' });
  });

  it('keeps an action proposal well-formed when a provider sends partial JSON', () => {
    expect(toActionBody('propose_change', '{not valid')).toEqual({
      kind: 'propose_change',
      summary: 'Proposed propose_change',
    });
  });

  it('translates thinking, action, and text blocks into a gated activity stream', async () => {
    const events = [
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Plan.' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'tool_1', name: 'propose_change', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"kind":"update_task","summary":"Move the task"}',
        },
      },
      { type: 'content_block_stop', index: 1 },
      {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'text', text: '', citations: null },
      },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: 'Done.' } },
      { type: 'content_block_stop', index: 2 },
    ] as unknown as readonly RawMessageStreamEvent[];

    await expect(activities(translateEvents(eventStream(events)))).resolves.toEqual([
      { type: 'thought', body: 'Plan.' },
      {
        type: 'action',
        body: { kind: 'update_task', summary: 'Move the task' },
        approval: 'proposed',
      },
      { type: 'response', body: 'Done.' },
    ]);
  });

  it('builds the real-provider request with a human approval proposal tool', () => {
    const request = buildRequest(
      { sessionId: 'session_1', task: 'Triage work', agent: 'athena' },
      { apiKey: 'sk-ant-test' },
    );

    expect(request.messages[0]).toMatchObject({ role: 'user' });
    expect(request.tools?.[0]).toMatchObject({ name: 'propose_change' });
  });

  it('converts synchronous provider failures into secret-free runtime errors', async () => {
    const runtime = new RealProviderRuntime({ apiKey: 'sk-ant-secret' }, () => {
      throw new Error('network unavailable');
    });

    await expect(
      activities(
        runtime.startSession({ sessionId: 'session_1', task: 'Triage work', agent: 'athena' }),
      ),
    ).rejects.toThrow('Anthropic agent runtime failed: network unavailable');
  });
});

/**
 * Behavior tests for the agent-session stream translator.
 *
 * @remarks
 * This edge describes mutations without performing them, so the property that matters most is
 * that a tool block always surfaces as `approval: 'proposed'` — never as something already done.
 * A tool call that arrives with no parseable input still has to reach a reviewer, because a
 * silently dropped proposal is a mutation nobody gets to refuse.
 */
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import type { SessionActivity } from '../src/agent-session-contracts';
import { blockKind, toActionBody, translateEvents } from '../src/agent-session-translation';

/** Feed hand-built provider events through the translator and collect the activities. */
async function translate(events: readonly unknown[]): Promise<SessionActivity[]> {
  async function* stream(): AsyncIterable<RawMessageStreamEvent> {
    for (const event of events) yield event as RawMessageStreamEvent;
  }
  const out: SessionActivity[] = [];
  for await (const activity of translateEvents(stream())) out.push(activity);
  return out;
}

const start = (index: number, contentBlock: Record<string, unknown>): unknown => ({
  type: 'content_block_start',
  index,
  content_block: contentBlock,
});
const delta = (index: number, d: Record<string, unknown>): unknown => ({
  type: 'content_block_delta',
  index,
  delta: d,
});
const stop = (index: number): unknown => ({ type: 'content_block_stop', index });

describe('toActionBody', () => {
  it('prefers the model’s own kind and summary when it supplied them', () => {
    expect(toActionBody('write_task', '{"kind":"task.create","summary":"Create a task"}')).toEqual({
      kind: 'task.create',
      summary: 'Create a task',
    });
  });

  it('falls back to the tool name when the payload names nothing useful', () => {
    // Each of these is a payload a truncated stream can produce.
    for (const json of ['', '   ', '{"broken":', 'null', '42', '{}', '{"kind":"","summary":""}']) {
      expect(toActionBody('write_task', json)).toEqual({
        kind: 'write_task',
        summary: 'Proposed write_task',
      });
    }
  });

  it('carries a diff through only when one was supplied', () => {
    expect(toActionBody('edit', '{"diff":"- a\\n+ b"}')).toMatchObject({ diff: '- a\n+ b' });
    // An absent diff must be absent, not present-and-undefined, or a reviewer UI renders a blank.
    expect(toActionBody('edit', '{}')).not.toHaveProperty('diff');
    expect(toActionBody('edit', '{"diff":null}')).toMatchObject({ diff: null });
  });

  it('ignores a non-string kind or summary', () => {
    expect(toActionBody('edit', '{"kind":7,"summary":{"a":1}}')).toEqual({
      kind: 'edit',
      summary: 'Proposed edit',
    });
  });
});

describe('blockKind', () => {
  it('normalizes the three represented kinds and buckets everything else', () => {
    expect(blockKind('thinking')).toBe('thinking');
    expect(blockKind('text')).toBe('text');
    expect(blockKind('tool_use')).toBe('tool_use');
    expect(blockKind('server_tool_use')).toBe('other');
    expect(blockKind('')).toBe('other');
  });
});

describe('translateEvents', () => {
  it('emits a thought, a response, and a proposed action', async () => {
    const activities = await translate([
      start(0, { type: 'thinking', thinking: '' }),
      delta(0, { type: 'thinking_delta', thinking: 'Weighing it up.' }),
      stop(0),
      start(1, { type: 'text', text: '' }),
      delta(1, { type: 'text_delta', text: 'Here is my plan.' }),
      stop(1),
      start(2, { type: 'tool_use', id: 't1', name: 'write_task' }),
      delta(2, { type: 'input_json_delta', partial_json: '{"summary":"Add a task"}' }),
      stop(2),
    ]);
    expect(activities).toEqual([
      { type: 'thought', body: 'Weighing it up.' },
      { type: 'response', body: 'Here is my plan.' },
      {
        type: 'action',
        body: { kind: 'write_task', summary: 'Add a task' },
        approval: 'proposed',
      },
    ]);
  });

  it('always proposes a tool call, never records it as done', async () => {
    const activities = await translate([
      start(0, { type: 'tool_use', id: 't1', name: 'delete_everything' }),
      stop(0),
    ]);
    // No input arrived, and the proposal still reaches a reviewer.
    expect(activities).toEqual([
      {
        type: 'action',
        body: { kind: 'delete_everything', summary: 'Proposed delete_everything' },
        approval: 'proposed',
      },
    ]);
  });

  it('drops a thought or response that carried only whitespace', async () => {
    const activities = await translate([
      start(0, { type: 'thinking', thinking: '' }),
      delta(0, { type: 'text_delta', text: '   ' }),
      stop(0),
      start(1, { type: 'text', text: '' }),
      stop(1),
    ]);
    expect(activities).toEqual([]);
  });

  it('ignores a block kind it does not represent', async () => {
    const activities = await translate([
      start(0, { type: 'server_tool_use', id: 'x', name: 'y' }),
      delta(0, { type: 'text_delta', text: 'ignored' }),
      stop(0),
    ]);
    expect(activities).toEqual([]);
  });

  it('ignores a delta or stop for an index that never started', async () => {
    expect(
      await translate([
        delta(3, { type: 'text_delta', text: 'orphan' }),
        stop(3),
        { type: 'ping' },
      ]),
    ).toEqual([]);
  });

  it('ignores a delta kind it does not accumulate', async () => {
    const activities = await translate([
      start(0, { type: 'text', text: '' }),
      delta(0, { type: 'signature_delta', signature: 'sig' }),
      delta(0, { type: 'text_delta', text: 'kept' }),
      stop(0),
    ]);
    expect(activities).toEqual([{ type: 'response', body: 'kept' }]);
  });

  it('reports a model refusal as an error activity', async () => {
    const activities = await translate([
      { type: 'message_delta', delta: { stop_reason: 'refusal' } },
    ]);
    expect(activities).toEqual([
      { type: 'error', body: 'The agent declined to complete this task (model refusal).' },
    ]);
  });

  it('says nothing for an ordinary stop reason', async () => {
    expect(
      await translate([{ type: 'message_delta', delta: { stop_reason: 'end_turn' } }]),
    ).toEqual([]);
  });

  it('translates an empty stream into no activity at all', async () => {
    expect(await translate([])).toEqual([]);
  });
});

/**
 * Behavior tests for the Anthropic stream translator.
 *
 * @remarks
 * The translator's output is not just a live event feed — its terminal `turn_end` carries the
 * exact message the host appends and replays on the next turn. So the two things tested hardest
 * are that block order survives out-of-order provider indices, and that a malformed or empty
 * tool input degrades to `{}` instead of throwing. A throw here would lose a turn that the
 * provider had already been paid for.
 *
 * Events are hand-built rather than recorded, because the interesting cases (an unknown block
 * type, a delta for an index that never started) are ones a healthy provider does not send.
 */
import type { RawMessageStreamEvent } from '@anthropic-ai/sdk/resources/messages';
import { describe, expect, it } from 'vitest';

import type { TurnEvent } from '../src/turn/turn';
import { parseToolInput, toStopReason, translateTurnEvents } from '../src/turn/translate';

/** Feed hand-built provider events through the translator and collect what comes out. */
async function translate(events: readonly unknown[]): Promise<TurnEvent[]> {
  async function* stream(): AsyncIterable<RawMessageStreamEvent> {
    for (const event of events) yield event as RawMessageStreamEvent;
  }
  const out: TurnEvent[] = [];
  for await (const event of translateTurnEvents(stream())) out.push(event);
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

describe('parseToolInput', () => {
  it('parses a complete JSON object', () => {
    expect(parseToolInput('{"q":"acme"}')).toEqual({ q: 'acme' });
  });

  it('degrades to an empty object rather than throwing', () => {
    // Each of these is a stream the provider can truncate mid-flight.
    expect(parseToolInput('')).toEqual({});
    expect(parseToolInput('   ')).toEqual({});
    expect(parseToolInput('{"q":')).toEqual({});
    expect(parseToolInput('not json')).toEqual({});
  });

  it('rejects a valid JSON scalar, because a tool input is an object', () => {
    expect(parseToolInput('42')).toEqual({});
    expect(parseToolInput('"text"')).toEqual({});
    expect(parseToolInput('null')).toEqual({});
  });
});

describe('toStopReason', () => {
  it('maps the three provider reasons Athena distinguishes', () => {
    expect(toStopReason('tool_use')).toBe('tool_use');
    expect(toStopReason('refusal')).toBe('refusal');
    expect(toStopReason('max_tokens')).toBe('max_tokens');
  });

  it('treats anything else, including nothing, as a normal end', () => {
    expect(toStopReason('end_turn')).toBe('end_turn');
    expect(toStopReason('stop_sequence')).toBe('end_turn');
    expect(toStopReason(null)).toBe('end_turn');
    expect(toStopReason(undefined)).toBe('end_turn');
  });
});

describe('translateTurnEvents', () => {
  it('emits a text block live and again in the terminal message', async () => {
    const events = await translate([
      start(0, { type: 'text', text: '' }),
      delta(0, { type: 'text_delta', text: 'Hello ' }),
      delta(0, { type: 'text_delta', text: 'there.' }),
      stop(0),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ]);
    expect(events[0]).toEqual({ type: 'text', text: 'Hello there.' });
    expect(events[1]).toEqual({
      type: 'turn_end',
      stopReason: 'end_turn',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hello there.' }] },
    });
  });

  it('carries a thinking block’s signature into the transcript', async () => {
    const events = await translate([
      start(0, { type: 'thinking', thinking: '' }),
      delta(0, { type: 'thinking_delta', thinking: 'Considering.' }),
      delta(0, { type: 'signature_delta', signature: 'sig-abc' }),
      stop(0),
    ]);
    expect(events[0]).toEqual({ type: 'thinking', text: 'Considering.' });
    // The signature is what lets the provider verify the block on a later turn.
    expect(events[1]).toMatchObject({
      message: {
        content: [{ type: 'thinking', thinking: 'Considering.', signature: 'sig-abc' }],
      },
    });
  });

  it('assembles a tool call from its streamed JSON fragments', async () => {
    const events = await translate([
      start(0, { type: 'tool_use', id: 'toolu_1', name: 'search' }),
      delta(0, { type: 'input_json_delta', partial_json: '{"q":' }),
      delta(0, { type: 'input_json_delta', partial_json: '"acme"}' }),
      stop(0),
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
    ]);
    expect(events[0]).toEqual({
      type: 'tool_use',
      id: 'toolu_1',
      name: 'search',
      input: { q: 'acme' },
    });
    expect(events[1]).toMatchObject({ stopReason: 'tool_use' });
  });

  it('keeps a tool call whose input never arrived, with an empty input', async () => {
    const events = await translate([
      start(0, { type: 'tool_use', id: 'toolu_1', name: 'search' }),
      stop(0),
    ]);
    // Dropping the call would strand the turn: the host would never send a result for it.
    expect(events[0]).toMatchObject({ type: 'tool_use', input: {} });
  });

  it('drops a text or thinking block that carried only whitespace', async () => {
    const events = await translate([
      start(0, { type: 'text', text: '' }),
      delta(0, { type: 'text_delta', text: '   ' }),
      stop(0),
      start(1, { type: 'thinking', thinking: '' }),
      stop(1),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'turn_end', message: { content: [] } });
  });

  it('orders the terminal message by provider index, not arrival order', async () => {
    const events = await translate([
      start(1, { type: 'text', text: '' }),
      start(0, { type: 'text', text: '' }),
      delta(1, { type: 'text_delta', text: 'second' }),
      delta(0, { type: 'text_delta', text: 'first' }),
      stop(1),
      stop(0),
    ]);
    const end = events.at(-1);
    expect(end).toMatchObject({
      message: {
        content: [
          { type: 'text', text: 'first' },
          { type: 'text', text: 'second' },
        ],
      },
    });
  });

  it('ignores a block kind it cannot translate', async () => {
    const events = await translate([
      start(0, { type: 'server_tool_use', id: 'x', name: 'y' }),
      delta(0, { type: 'text_delta', text: 'ignored' }),
      stop(0),
    ]);
    expect(events).toEqual([
      { type: 'turn_end', stopReason: 'end_turn', message: { role: 'assistant', content: [] } },
    ]);
  });

  it('ignores a delta or stop for an index that never started', async () => {
    const events = await translate([
      delta(7, { type: 'text_delta', text: 'orphan' }),
      stop(7),
      { type: 'ping' },
    ]);
    expect(events).toEqual([
      { type: 'turn_end', stopReason: 'end_turn', message: { role: 'assistant', content: [] } },
    ]);
  });

  it('ignores a delta kind it does not recognize', async () => {
    const events = await translate([
      start(0, { type: 'text', text: '' }),
      delta(0, { type: 'citations_delta', citation: {} }),
      delta(0, { type: 'text_delta', text: 'kept' }),
      stop(0),
    ]);
    expect(events[0]).toEqual({ type: 'text', text: 'kept' });
  });

  it('always ends the stream, even with no events at all', async () => {
    expect(await translate([])).toEqual([
      { type: 'turn_end', stopReason: 'end_turn', message: { role: 'assistant', content: [] } },
    ]);
  });

  it('keeps the last stop reason the provider reported', async () => {
    const events = await translate([
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' } },
      { type: 'message_delta', delta: { stop_reason: 'refusal' } },
    ]);
    expect(events[0]).toMatchObject({ stopReason: 'refusal' });
  });
});

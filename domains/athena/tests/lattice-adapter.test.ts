/**
 * Behavior tests for the Lattice turn adapter.
 *
 * @remarks
 * Lattice's wire is text-only and has no tool role, so this adapter has to flatten a block
 * transcript into plain messages and then read a tool call back out of free text. The two
 * directions have to agree: a call this module renders must be a call it parses, or a resumed
 * conversation silently loses the tool history.
 *
 * The chat port is a stub throughout. It is the only network seam, which is the point of the
 * design — nothing here should need a paired device to run.
 */
import { describe, expect, it } from 'vitest';

import type { TurnMessage } from '../src/turn-protocol';
import type { TurnEvent, TurnInput, TurnToolDef } from '../src/turn/turn';
import {
  DEFAULT_LATTICE_MAX_TOKENS,
  type LatticeChatPortRequest,
  type LatticeChatPortResult,
  LatticeAgentTurnRuntime,
  buildLatticeTurnMessages,
  countToolUses,
  flattenTranscript,
  latticeToolUseId,
  parseLatticeReply,
  renderToolCall,
  toLatticeStopReason,
} from '../src/turn/adapters/lattice';

const TOOLS: readonly TurnToolDef[] = [
  { name: 'search', description: 'Search work', inputSchema: { type: 'object' } },
];

/** A chat port that records what it was asked and replies with a fixed result. */
function stubPort(result: LatticeChatPortResult): {
  runChat: (request: LatticeChatPortRequest) => Promise<LatticeChatPortResult>;
  calls: LatticeChatPortRequest[];
} {
  const calls: LatticeChatPortRequest[] = [];
  return {
    calls,
    runChat: (request) => {
      calls.push(request);
      return Promise.resolve(result);
    },
  };
}

/** Drain a turn into an array so its whole event sequence can be asserted at once. */
async function drain(input: TurnInput, port: ReturnType<typeof stubPort>): Promise<TurnEvent[]> {
  const runtime = new LatticeAgentTurnRuntime({ chat: port });
  const events: TurnEvent[] = [];
  for await (const event of runtime.streamTurn(input)) events.push(event);
  return events;
}

const turnInput = (messages: readonly TurnMessage[]): TurnInput => ({
  system: 'You are Athena.',
  messages,
  tools: TOOLS,
});

describe('flattenTranscript', () => {
  it('drops thinking blocks, which do not cross providers', () => {
    expect(
      flattenTranscript([
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'private reasoning', signature: 'sig' },
            { type: 'text', text: 'Visible answer.' },
          ],
        },
      ]),
    ).toEqual([{ role: 'assistant', content: 'Visible answer.' }]);
  });

  it('drops a message left empty after flattening rather than sending a blank turn', () => {
    expect(
      flattenTranscript([
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'only', signature: 's' }] },
        { role: 'user', content: [{ type: 'text', text: '   ' }] },
      ]),
    ).toEqual([]);
  });

  it('moves a tool result to the user side, because the wire has no tool role', () => {
    const flattened = flattenTranscript([
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 'lat_0000', content: 'ok', isError: false }],
      },
    ]);
    expect(flattened[0]?.role).toBe('user');
    expect(flattened[0]?.content).toContain('lat_0000');
  });

  it('keeps an assistant tool call on the assistant side', () => {
    const flattened = flattenTranscript([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'lat_0000', name: 'search', input: { q: 'a' } }],
      },
    ]);
    expect(flattened[0]?.role).toBe('assistant');
    expect(flattened[0]?.content).toContain('search');
  });

  it('demotes an assistant message that carries a tool result to the user side', () => {
    const flattened = flattenTranscript([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Here is what came back.' },
          { type: 'tool_result', toolUseId: 'lat_0000', content: 'rows', isError: true },
        ],
      },
    ]);
    expect(flattened[0]?.role).toBe('user');
    // Both parts survive, joined, so the model sees the narration and the result together.
    expect(flattened[0]?.content).toContain('Here is what came back.');
    expect(flattened[0]?.content).toContain('FAILED');
  });
});

describe('countToolUses', () => {
  it('counts every tool call across the whole transcript', () => {
    expect(countToolUses([])).toBe(0);
    expect(
      countToolUses([
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'a', name: 'search', input: {} },
            { type: 'text', text: 'and' },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'b', name: 'search', input: {} }],
        },
      ]),
    ).toBe(2);
  });
});

describe('toLatticeStopReason', () => {
  it('narrows every device finish reason to Athena’s own vocabulary', () => {
    expect(toLatticeStopReason('length')).toBe('max_tokens');
    expect(toLatticeStopReason('max_tokens')).toBe('max_tokens');
    expect(toLatticeStopReason('content_filter')).toBe('refusal');
    expect(toLatticeStopReason('refusal')).toBe('refusal');
    expect(toLatticeStopReason('stop')).toBe('end_turn');
    // An unreported or unrecognized reason is a normal end, not an error.
    expect(toLatticeStopReason(undefined)).toBe('end_turn');
    expect(toLatticeStopReason('something-new')).toBe('end_turn');
  });
});

describe('buildLatticeTurnMessages', () => {
  it('puts the system message first and appends the tool instructions to it', () => {
    const messages = buildLatticeTurnMessages(
      turnInput([{ role: 'user', content: [{ type: 'text', text: 'Hello.' }] }]),
    );
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content.startsWith('You are Athena.')).toBe(true);
    // The tool vocabulary has to reach a text-only model somehow; the system message is where.
    expect(messages[0]?.content).toContain('search');
    expect(messages[1]).toEqual({ role: 'user', content: 'Hello.' });
  });
});

describe('LatticeAgentTurnRuntime', () => {
  it('emits text and a normal end for an ordinary reply', async () => {
    const port = stubPort({ text: 'The answer.', finishReason: 'stop' });
    const events = await drain(turnInput([]), port);
    expect(events).toEqual([
      { type: 'text', text: 'The answer.' },
      {
        type: 'turn_end',
        stopReason: 'end_turn',
        message: { role: 'assistant', content: [{ type: 'text', text: 'The answer.' }] },
      },
    ]);
  });

  it('carries the device’s finish reason into the end event', async () => {
    const port = stubPort({ text: 'Cut off', finishReason: 'length' });
    const events = await drain(turnInput([]), port);
    expect(events[1]).toMatchObject({ type: 'turn_end', stopReason: 'max_tokens' });
  });

  it('reads a fenced tool call back out of the reply text', async () => {
    const port = stubPort({ text: renderToolCall('search', { q: 'invoices' }) });
    const events = await drain(turnInput([]), port);
    expect(events[0]).toEqual({
      type: 'tool_use',
      id: latticeToolUseId(0),
      name: 'search',
      input: { q: 'invoices' },
    });
    expect(events[1]).toMatchObject({ type: 'turn_end', stopReason: 'tool_use' });
  });

  it('numbers a new tool id past the calls already in the transcript', async () => {
    const port = stubPort({ text: renderToolCall('search', {}) });
    const events = await drain(
      turnInput([
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: latticeToolUseId(0), name: 'search', input: {} }],
        },
      ]),
      port,
    );
    // Resuming must not reissue id 0, or the result would attach to the wrong call.
    expect(events[0]).toMatchObject({ id: latticeToolUseId(1) });
  });

  it('treats a call to a tool that was not offered as ordinary text', async () => {
    const port = stubPort({ text: renderToolCall('delete_everything', {}) });
    const events = await drain(turnInput([]), port);
    expect(events[0]?.type).toBe('text');
  });

  it('sends the default token ceiling and no temperature unless configured', async () => {
    const port = stubPort({ text: 'ok' });
    await drain(turnInput([]), port);
    expect(port.calls[0]?.maxTokens).toBe(DEFAULT_LATTICE_MAX_TOKENS);
    expect(port.calls[0]).not.toHaveProperty('temperature');

    const configured = stubPort({ text: 'ok' });
    const runtime = new LatticeAgentTurnRuntime({
      chat: configured,
      maxTokens: 128,
      temperature: 0.2,
    });
    await runtime.streamTurn(turnInput([]))[Symbol.asyncIterator]().next();
    expect(configured.calls[0]).toMatchObject({ maxTokens: 128, temperature: 0.2 });
  });

  it('lets a device failure propagate rather than falling back to a hosted model', async () => {
    const failing = {
      runChat: () => Promise.reject(new Error('device offline')),
    };
    const runtime = new LatticeAgentTurnRuntime({ chat: failing });
    // Silently rerouting would spend the privacy choice the person made by selecting a device.
    await expect(async () => {
      await runtime.streamTurn(turnInput([]))[Symbol.asyncIterator]().next();
    }).rejects.toThrow('device offline');
  });

  it('round-trips a rendered call through the parser', () => {
    const rendered = renderToolCall('search', { q: 'a' });
    expect(parseLatticeReply(rendered, ['search'])).toEqual({
      kind: 'tool_call',
      name: 'search',
      input: { q: 'a' },
    });
  });
});

/**
 * Athena's turn runtime over Lattice: the text tool protocol, the transcript flattening, and the
 * event sequence the durable loop consumes.
 *
 * @remarks
 * The parser tests carry the most weight here. A local model's reply is prose by default, and a
 * parser that reads a *description* of a tool call as a call would create real rows in someone's
 * workspace from a sentence about hypotheticals. Several tests below exist only to pin that.
 */
import {
  DEFAULT_LATTICE_MAX_TOKENS,
  LatticeAgentTurnRuntime,
  buildLatticeTurnMessages,
  countToolUses,
  flattenTranscript,
  latticeToolUseId,
  parseLatticeReply,
  renderToolCall,
  renderToolInstructions,
  renderToolResult,
  toLatticeStopReason,
  type LatticeChatPort,
  type LatticeChatPortRequest,
  type LatticeChatPortResult,
  type TurnEvent,
  type TurnInput,
  type TurnMessage,
  type TurnToolDef,
} from '@docket/agent-runtime';
import { describe, expect, it } from 'vitest';

/** The tools a turn is offered in these tests. */
const TOOLS: readonly TurnToolDef[] = [
  {
    name: 'create_task',
    description: 'Create a task in the workspace.',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Change a task’s state.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } } },
  },
];

/** Every tool name offered above. */
const TOOL_NAMES = TOOLS.map((tool) => tool.name);

/** A chat port that replays one scripted reply and records what it was asked. */
function scriptedPort(result: Partial<LatticeChatPortResult> & { text: string }): {
  port: LatticeChatPort;
  requests: LatticeChatPortRequest[];
} {
  const requests: LatticeChatPortRequest[] = [];
  return {
    requests,
    port: {
      async runChat(request) {
        requests.push(request);
        return result;
      },
    },
  };
}

/** Drain a turn into an array of events. */
async function drain(runtime: LatticeAgentTurnRuntime, input: TurnInput): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  for await (const event of runtime.streamTurn(input)) events.push(event);
  return events;
}

/** A minimal turn input. */
function turnInput(messages: readonly TurnMessage[], tools = TOOLS): TurnInput {
  return { system: 'You are Athena.', messages, tools };
}

describe('parseLatticeReply', () => {
  it('reads a bare fenced envelope as a tool call', () => {
    const reply = '```json\n{"tool":"create_task","input":{"title":"Ship it"}}\n```';
    expect(parseLatticeReply(reply, TOOL_NAMES)).toEqual({
      kind: 'tool_call',
      name: 'create_task',
      input: { title: 'Ship it' },
    });
  });

  it('tolerates an untagged fence and incidental surrounding text', () => {
    const reply = 'Okay.\n```\n{"tool":"create_task","input":{"title":"X"}}\n```\n';
    expect(parseLatticeReply(reply, TOOL_NAMES).kind).toBe('tool_call');
  });

  it('defaults a missing input to an empty object rather than undefined', () => {
    const reply = '```json\n{"tool":"update_task"}\n```';
    expect(parseLatticeReply(reply, TOOL_NAMES)).toEqual({
      kind: 'tool_call',
      name: 'update_task',
      input: {},
    });
  });

  it('reads a block wrapped in explanation as prose, not as a call', () => {
    // This is the case that matters: the model is describing what it *could* do. Acting on it
    // would create real workspace rows from a hypothetical.
    const reply = [
      'If you wanted me to create that task, I would send something like this:',
      '```json',
      '{"tool":"create_task","input":{"title":"Ship it"}}',
      '```',
      'But I would rather confirm the title with you first, since "Ship it" is ambiguous.',
    ].join('\n');
    expect(parseLatticeReply(reply, TOOL_NAMES).kind).toBe('text');
  });

  it('reads two blocks as prose rather than guessing which call was meant', () => {
    const reply = [
      '```json',
      '{"tool":"create_task","input":{"title":"A"}}',
      '```',
      '```json',
      '{"tool":"create_task","input":{"title":"B"}}',
      '```',
    ].join('\n');
    expect(parseLatticeReply(reply, TOOL_NAMES).kind).toBe('text');
  });

  it('reads a call to an un-offered tool as prose', () => {
    const reply = '```json\n{"tool":"delete_everything","input":{}}\n```';
    expect(parseLatticeReply(reply, TOOL_NAMES).kind).toBe('text');
  });

  it('never repairs malformed JSON', () => {
    const reply = '```json\n{"tool":"create_task","input":{"title":}\n```';
    expect(parseLatticeReply(reply, TOOL_NAMES).kind).toBe('text');
  });

  it('rejects an envelope with no tool name', () => {
    expect(parseLatticeReply('```json\n{"input":{"a":1}}\n```', TOOL_NAMES).kind).toBe('text');
    expect(parseLatticeReply('```json\n{"tool":""}\n```', TOOL_NAMES).kind).toBe('text');
    expect(parseLatticeReply('```json\n[1,2,3]\n```', TOOL_NAMES).kind).toBe('text');
  });

  it('returns trimmed prose for an ordinary answer', () => {
    expect(parseLatticeReply('  Two tasks are overdue.  ', TOOL_NAMES)).toEqual({
      kind: 'text',
      text: 'Two tasks are overdue.',
    });
  });

  it('treats a non-JSON code block as prose', () => {
    const reply = 'Here is the snippet:\n```ts\nconst x = 1;\n```';
    expect(parseLatticeReply(reply, TOOL_NAMES).kind).toBe('text');
  });
});

describe('renderToolInstructions', () => {
  it('renders nothing when the turn offers no tools', () => {
    expect(renderToolInstructions([])).toBe('');
  });

  it('includes each tool’s name, description and verbatim schema', () => {
    const rendered = renderToolInstructions(TOOLS);
    expect(rendered).toContain('### create_task');
    expect(rendered).toContain('Create a task in the workspace.');
    // A paraphrased schema produces inputs that fail validation, which costs a whole turn on the
    // person's own hardware to recover from.
    expect(rendered).toContain(JSON.stringify(TOOLS[0]?.inputSchema, null, 2));
  });
});

describe('flattenTranscript', () => {
  it('drops thinking blocks, whose provider signature means nothing to a local model', () => {
    const flattened = flattenTranscript([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'private deliberation', signature: 'sig' },
          { type: 'text', text: 'Done.' },
        ],
      },
    ]);
    expect(flattened).toEqual([{ role: 'assistant', content: 'Done.' }]);
  });

  it('re-renders an assistant tool call in the protocol’s own vocabulary', () => {
    const flattened = flattenTranscript([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'create_task', input: { title: 'X' } }],
      },
    ]);
    expect(flattened[0]?.role).toBe('assistant');
    expect(flattened[0]?.content).toBe(renderToolCall('create_task', { title: 'X' }));
  });

  it('carries a tool result back on the user side, since the wire has no tool role', () => {
    const flattened = flattenTranscript([
      {
        role: 'user',
        content: [{ type: 'tool_result', toolUseId: 't1', content: '{"ok":true}', isError: false }],
      },
    ]);
    expect(flattened[0]?.role).toBe('user');
    expect(flattened[0]?.content).toBe(renderToolResult('t1', '{"ok":true}', false));
    expect(flattened[0]?.content).toContain('OK');
  });

  it('marks a failed tool result so the model reacts instead of assuming success', () => {
    expect(renderToolResult('t1', 'boom', true)).toContain('FAILED');
  });

  it('drops a message that flattens to nothing', () => {
    expect(
      flattenTranscript([
        { role: 'assistant', content: [{ type: 'text', text: '   ' }] },
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ]),
    ).toEqual([{ role: 'user', content: 'Hello' }]);
  });
});

describe('tool-use ids', () => {
  it('are deterministic, so a resumed conversation pairs calls with results identically', () => {
    expect(latticeToolUseId(0)).toBe('toolu_lat_0000');
    expect(latticeToolUseId(12)).toBe('toolu_lat_0012');
  });

  it('continue the count already in the transcript', () => {
    const transcript: readonly TurnMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_lat_0000', name: 'create_task', input: {} }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'toolu_lat_0000', content: 'ok', isError: false },
        ],
      },
    ];
    expect(countToolUses(transcript)).toBe(1);
  });
});

describe('toLatticeStopReason', () => {
  it('maps the finish reasons a local model server reports', () => {
    expect(toLatticeStopReason(undefined)).toBe('end_turn');
    expect(toLatticeStopReason('stop')).toBe('end_turn');
    expect(toLatticeStopReason('length')).toBe('max_tokens');
    expect(toLatticeStopReason('content_filter')).toBe('refusal');
  });
});

describe('LatticeAgentTurnRuntime', () => {
  it('emits text then turn_end for an ordinary answer', async () => {
    const { port } = scriptedPort({ text: 'Two tasks are overdue.', finishReason: 'stop' });
    const events = await drain(
      new LatticeAgentTurnRuntime({ chat: port }),
      turnInput([{ role: 'user', content: [{ type: 'text', text: 'What is overdue?' }] }]),
    );

    expect(events).toEqual([
      { type: 'text', text: 'Two tasks are overdue.' },
      {
        type: 'turn_end',
        stopReason: 'end_turn',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Two tasks are overdue.' }] },
      },
    ]);
  });

  it('emits a tool_use whose message can be appended to the transcript verbatim', async () => {
    const { port } = scriptedPort({
      text: '```json\n{"tool":"create_task","input":{"title":"Ship it"}}\n```',
    });
    const events = await drain(
      new LatticeAgentTurnRuntime({ chat: port }),
      turnInput([{ role: 'user', content: [{ type: 'text', text: 'Add a task' }] }]),
    );

    expect(events[0]).toEqual({
      type: 'tool_use',
      id: 'toolu_lat_0000',
      name: 'create_task',
      input: { title: 'Ship it' },
    });
    const end = events[1];
    expect(end?.type).toBe('turn_end');
    if (end?.type === 'turn_end') {
      expect(end.stopReason).toBe('tool_use');
      // The loop appends this message and later matches a `tool_result` to the same id.
      expect(end.message.content).toEqual([
        {
          type: 'tool_use',
          id: 'toolu_lat_0000',
          name: 'create_task',
          input: { title: 'Ship it' },
        },
      ]);
    }
  });

  it('puts the system prompt and tool instructions in the first message', async () => {
    const { port, requests } = scriptedPort({ text: 'ok' });
    await drain(
      new LatticeAgentTurnRuntime({ chat: port }),
      turnInput([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]),
    );

    const first = requests[0]?.messages[0];
    expect(first?.role).toBe('system');
    expect(first?.content).toContain('You are Athena.');
    expect(first?.content).toContain('### create_task');
    expect(requests[0]?.maxTokens).toBe(DEFAULT_LATTICE_MAX_TOKENS);
  });

  it('sends exactly the messages buildLatticeTurnMessages describes', async () => {
    // The payload that reaches someone's own machine is worth pinning explicitly: a test on the
    // exact message list is the only way to be sure Athena is not shipping more than it means to.
    const input = turnInput([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
    const { port, requests } = scriptedPort({ text: 'ok' });
    await drain(new LatticeAgentTurnRuntime({ chat: port }), input);
    expect(requests[0]?.messages).toEqual(buildLatticeTurnMessages(input));
  });

  it('honours an explicit token ceiling and temperature', async () => {
    const { port, requests } = scriptedPort({ text: 'ok' });
    await drain(
      new LatticeAgentTurnRuntime({ chat: port, maxTokens: 256, temperature: 0.2 }),
      turnInput([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]),
    );
    expect(requests[0]).toMatchObject({ maxTokens: 256, temperature: 0.2 });
  });

  it('lets a port failure propagate untouched instead of answering from elsewhere', async () => {
    const failing: LatticeChatPort = {
      async runChat() {
        throw Object.assign(new Error('Lattice unavailable: device_offline'), {
          reason: 'device_offline',
        });
      },
    };

    // No catch, no wrap, no substitute model: the loop sees the reason and the person is told.
    await expect(
      drain(
        new LatticeAgentTurnRuntime({ chat: failing }),
        turnInput([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]),
      ),
    ).rejects.toMatchObject({ reason: 'device_offline' });
  });

  it('reports max_tokens when the device truncated the reply', async () => {
    const { port } = scriptedPort({ text: 'partial…', finishReason: 'length' });
    const events = await drain(
      new LatticeAgentTurnRuntime({ chat: port }),
      turnInput([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]),
    );
    const end = events.at(-1);
    expect(end?.type === 'turn_end' && end.stopReason).toBe('max_tokens');
  });

  it('survives a device that returned no choices at all', async () => {
    const { port } = scriptedPort({ text: '' });
    const events = await drain(
      new LatticeAgentTurnRuntime({ chat: port }),
      turnInput([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]),
    );
    expect(events.at(-1)?.type).toBe('turn_end');
  });
});

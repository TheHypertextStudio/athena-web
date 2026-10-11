/** A malformed model call must never silently settle notification triage as completed. */
import { describe, expect, it } from 'vitest';
import { LatticeAgentTurnRuntime, type LatticeChatPortRequest } from '../src/turn/adapters/lattice';
import type { TurnEvent } from '../src/turn/turn';

const input = {
  system: 'You are Athena.',
  tools: [
    {
      name: 'workspaces',
      description: 'List accessible workspaces.',
      inputSchema: { type: 'object' },
    },
  ],
  messages: [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'Review a synthetic notification.' }],
    },
  ],
};

async function run(
  replies: string[],
): Promise<{ events: TurnEvent[]; requests: LatticeChatPortRequest[] }> {
  const requests: LatticeChatPortRequest[] = [];
  const runtime = new LatticeAgentTurnRuntime({
    chat: {
      runChat: async (request) => {
        requests.push(request);
        return { text: replies[Math.min(requests.length - 1, replies.length - 1)] ?? '' };
      },
    },
  });
  const events: TurnEvent[] = [];
  for await (const event of runtime.streamTurn(input)) events.push(event);
  return { events, requests };
}

describe('Lattice tool protocol recovery', () => {
  it('asks for one correction rather than publishing an XML call as a completed answer', async () => {
    const { events, requests } = await run([
      'Let me check authority.<tool_call>workspaces</tool_call>',
      '```json\n{"tool":"workspaces","input":{}}\n```',
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)?.content).toContain('No tool has run');
    expect(events).toContainEqual({
      type: 'tool_use',
      id: 'toolu_lat_0000',
      name: 'workspaces',
      input: {},
    });
    expect(events.some((event) => event.type === 'text')).toBe(false);
  });

  it('fails after one unsuccessful correction without executing or inventing a call', async () => {
    await expect(run(['<tool_call>workspaces</tool_call>'])).rejects.toThrow(
      'unsupported tool-call syntax',
    );
  });

  it('allows a corrected quiet answer without running a tool', async () => {
    const { events } = await run(['<tool_call>workspaces</tool_call>', 'No action is needed.']);
    expect(events).toContainEqual({ type: 'text', text: 'No action is needed.' });
  });

  it('leaves ordinary prose unchanged without an extra model request', async () => {
    const { requests, events } = await run(['No action is needed.']);
    expect(requests).toHaveLength(1);
    expect(events).toContainEqual({ type: 'text', text: 'No action is needed.' });
  });
});

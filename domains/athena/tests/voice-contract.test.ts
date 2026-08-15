/** Athena's channel-neutral voice grammar is portable across delivery runtimes. */
import { describe, expect, it } from 'vitest';

import {
  VoiceEventsBody,
  VoiceInboundEvent,
  VoiceOutboundCommand,
  VoiceSessionStartBody,
} from '../src/voice';

describe('Athena voice contract', () => {
  it('accepts a partial transcript and tool call as one transport batch', () => {
    const body = {
      events: [
        { type: 'user.transcript' as const, text: 'Please capture this.', final: false },
        {
          type: 'tool.call' as const,
          callId: 'call_1',
          name: 'capture',
          arguments: { text: 'Please capture this.' },
        },
      ],
    };

    expect(VoiceEventsBody.parse(body)).toEqual(body);
  });

  it('rejects malformed events rather than letting a delivery adapter invent grammar', () => {
    expect(VoiceInboundEvent.safeParse({ type: 'user.transcript', text: 'hello' }).success).toBe(
      false,
    );
    expect(
      VoiceOutboundCommand.safeParse({ type: 'tool.result', callId: 'call_1', ok: true }).success,
    ).toBe(false);
  });

  it("keeps workspace focus optional when starting the caller's canonical conversation", () => {
    expect(VoiceSessionStartBody.parse({})).toEqual({});
    expect(VoiceSessionStartBody.parse({ workspaceId: null })).toEqual({ workspaceId: null });
  });
});

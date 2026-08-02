/**
 * The telephony transport: signature authentication, the ConversationRelay translation table,
 * the WebSocket frame codec, and the announcement copy.
 *
 * @remarks
 * Everything here runs without a database, a telephone, or a Twilio account. That is the point of
 * confining channel-specific behaviour to a transport adapter: the adapter is a pure translation
 * and can be checked exhaustively.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  endReasonForClose,
  readSetup,
  toEngineEvent,
  toRelayMessage,
} from '../../src/routes/twilio-relay-bridge';
import { relaySocketHandlers } from '../../src/routes/twilio-relay-socket';
import {
  externalRequestUrl,
  twilioSignature,
  verifyTwilioSignature,
} from '../../src/routes/twilio-signature';
import { announcementTwiml, escapeXml, relayTwiml } from '../../src/routes/twilio-voice';
import {
  forbiddenAnnouncementWords,
  planRequiredAnnouncement,
  plansUrl,
  speakableUrl,
  unrecognizedCallerAnnouncement,
} from '../../src/routes/voice-announcements';
import {
  acceptKey,
  decodeFrame,
  encodeFrame,
  MAX_MESSAGE_BYTES,
} from '../../src/routes/voice-websocket';

/** Mask a payload the way a conforming client must. */
function clientFrame(opcode: number, payload: Buffer, mask = Buffer.from([1, 2, 3, 4])): Buffer {
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) {
    masked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
  }
  const header = encodeFrame(opcode, masked);
  // Re-encode with the mask bit and key, which `encodeFrame` (a server encoder) never sets.
  const lengthBytes = header.length - masked.length;
  const out = Buffer.concat([header.subarray(0, lengthBytes), mask, masked]);
  out[1] = (out[1] ?? 0) | 0x80;
  return out;
}

describe('twilio request signature', () => {
  const token = 'auth-token-value';
  const url = 'https://api.docket.test/internal/telephony/twilio/voice';
  const params = { CallSid: 'CA123', From: '+14155550123', To: '+14155550999' };

  it('accepts the signature Twilio would have produced', () => {
    const signature = twilioSignature(token, url, params);
    expect(verifyTwilioSignature(token, url, params, signature)).toBe(true);
  });

  it('rejects a tampered parameter, a wrong token, a missing header, and a missing token', () => {
    const signature = twilioSignature(token, url, params);
    expect(verifyTwilioSignature(token, url, { ...params, From: '+15005550000' }, signature)).toBe(
      false,
    );
    expect(verifyTwilioSignature('other-token', url, params, signature)).toBe(false);
    expect(verifyTwilioSignature(token, url, params, undefined)).toBe(false);
    expect(verifyTwilioSignature(undefined, url, params, signature)).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(verifyTwilioSignature(token, url, params, 'short')).toBe(false);
  });

  it('signs the external URL a proxy forwarded, not the one Node saw', () => {
    const headers = new Headers({
      'x-forwarded-proto': 'https, http',
      'x-forwarded-host': 'api.docket.test',
      host: 'localhost:8787',
    });
    expect(
      externalRequestUrl('http://localhost:8787/internal/telephony/twilio/voice?x=1', headers),
    ).toBe('https://api.docket.test/internal/telephony/twilio/voice?x=1');
  });
});

describe('conversation relay translation', () => {
  it('reads the session id the TwiML attached', () => {
    expect(
      readSetup({
        type: 'setup',
        callSid: 'CA1',
        from: '+14155550123',
        to: '+14155550999',
        customParameters: { voiceSessionId: 'vs_9' },
      }),
    ).toEqual({ callSid: 'CA1', from: '+14155550123', to: '+14155550999', voiceSessionId: 'vs_9' });
  });

  it('maps a final prompt, an interruption, a keypress and an error', () => {
    expect(
      toEngineEvent({ type: 'prompt', voicePrompt: 'Hi there', lang: 'en-US', last: true }),
    ).toEqual({ type: 'user.transcript', text: 'Hi there', final: true });
    expect(
      toEngineEvent({
        type: 'interrupt',
        utteranceUntilInterrupt: 'Life is a complex set of',
        durationUntilInterruptMs: 460,
      }),
    ).toEqual({
      type: 'user.interrupted',
      spokenText: 'Life is a complex set of',
      elapsedMs: 460,
    });
    expect(toEngineEvent({ type: 'dtmf', digit: '1' })).toEqual({ type: 'dtmf', digit: '1' });
    expect(toEngineEvent({ type: 'error', description: 'Invalid message received' })).toEqual({
      type: 'session.end',
      reason: 'error',
    });
  });

  it('ignores messages the engine has no opinion about', () => {
    expect(toEngineEvent({ type: 'info', name: 'tokensPlayed' })).toBeNull();
    expect(toEngineEvent({ type: 'setup' })).toBeNull();
    expect(toEngineEvent({})).toBeNull();
  });

  it('never leaks provider error text into an engine event', () => {
    const event = toEngineEvent({ type: 'error', description: 'ORA-00942: table does not exist' });
    expect(JSON.stringify(event)).not.toContain('ORA-00942');
  });

  it('emits a token message per spoken fragment and nothing for a stop', () => {
    expect(
      toRelayMessage({ type: 'speak', text: 'On it.', last: false, interruptible: true }),
    ).toEqual({
      type: 'text',
      token: 'On it.',
      last: false,
      interruptible: true,
      preemptible: false,
    });
    // Twilio's media server already stopped on barge-in; re-sending a stop would race it.
    expect(toRelayMessage({ type: 'stop.audio' })).toBeNull();
    expect(
      toRelayMessage({ type: 'tool.result', callId: 'x', ok: true, output: 'done' }),
    ).toBeNull();
    expect(toRelayMessage({ type: 'end', reason: 'user_ended' })).toEqual({
      type: 'end',
      handoffData: '{"reasonCode":"user_ended"}',
    });
  });

  it('distinguishes a hang-up from a dropped transport', () => {
    expect(endReasonForClose(1000)).toBe('caller_hung_up');
    expect(endReasonForClose(1006)).toBe('transport_closed');
  });
});

describe('conversation relay socket', () => {
  it('closes a socket whose setup names no session the webhook opened', async () => {
    const closed: number[] = [];
    const socket = { send: vi.fn(), close: (code = 1000) => closed.push(code) };
    const handlers = relaySocketHandlers(socket, () => null);

    await handlers.onMessage(
      JSON.stringify({
        type: 'setup',
        callSid: 'CA1',
        customParameters: { voiceSessionId: 'vs_x' },
      }),
    );

    expect(closed).toEqual([1008]);
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('drops messages that arrive before setup rather than acting on them', async () => {
    const socket = { send: vi.fn(), close: vi.fn() };
    const handlers = relaySocketHandlers(socket, () => null);
    await handlers.onMessage(JSON.stringify({ type: 'prompt', voicePrompt: 'hello', last: true }));
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
  });

  it('survives malformed JSON on a live call', async () => {
    const socket = { send: vi.fn(), close: vi.fn() };
    const handlers = relaySocketHandlers(socket, () => null);
    await expect(handlers.onMessage('{not json')).resolves.toBeUndefined();
    expect(socket.close).not.toHaveBeenCalled();
  });
});

describe('websocket frame codec', () => {
  it('round-trips a masked client text frame', () => {
    const frame = clientFrame(0x1, Buffer.from('hello', 'utf8'));
    const decoded = decodeFrame(frame);
    expect(decoded).not.toBeNull();
    expect(typeof decoded).not.toBe('number');
    if (decoded && typeof decoded !== 'number') {
      expect(decoded.opcode).toBe(0x1);
      expect(decoded.fin).toBe(true);
      expect(decoded.payload.toString('utf8')).toBe('hello');
      expect(decoded.size).toBe(frame.length);
    }
  });

  it('handles the 16-bit and 64-bit length forms', () => {
    for (const size of [200, 70_000]) {
      const payload = Buffer.alloc(size, 0x61);
      const decoded = decodeFrame(clientFrame(0x1, payload));
      expect(decoded && typeof decoded !== 'number' ? decoded.payload.length : -1).toBe(size);
    }
  });

  it('waits for more bytes rather than guessing at a partial frame', () => {
    const frame = clientFrame(0x1, Buffer.from('hello world', 'utf8'));
    expect(decodeFrame(frame.subarray(0, 3))).toBeNull();
    expect(decodeFrame(Buffer.alloc(1))).toBeNull();
  });

  it('refuses an unmasked client frame, a reserved bit, and an oversized length', () => {
    const unmasked = encodeFrame(0x1, Buffer.from('hi', 'utf8'));
    expect(decodeFrame(unmasked)).toBe(1002);

    const reserved = clientFrame(0x1, Buffer.from('hi', 'utf8'));
    reserved[0] = (reserved[0] ?? 0) | 0x40;
    expect(decodeFrame(reserved)).toBe(1002);

    const huge = Buffer.alloc(14);
    huge[0] = 0x81;
    huge[1] = 0xff;
    huge.writeBigUInt64BE(BigInt(MAX_MESSAGE_BYTES + 1), 2);
    expect(decodeFrame(huge)).toBe(1009);
  });

  it('computes the handshake accept value from RFC 6455 §1.3', () => {
    // The example key and expected accept value given in the RFC itself.
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});

describe('announcements', () => {
  it('tells a caller without a plan that a plan is needed and where to get it', () => {
    const script = planRequiredAnnouncement();
    expect(script.toLowerCase()).toContain('subscription plan');
    expect(script.toLowerCase()).toContain('on the web');
    // The exact URL, dictated — not "our website".
    expect(script).toContain(plansUrl());
    expect(script).toContain(speakableUrl(plansUrl()));
    expect(script.toLowerCase()).not.toContain('our website');
  });

  it('opens with a greeting and closes with a next step', () => {
    const script = planRequiredAnnouncement();
    expect(script.startsWith('Hi,')).toBe(true);
    expect(script.trimEnd().endsWith('Talk soon.')).toBe(true);
  });

  it('contains no error vocabulary, status text, or codes', () => {
    for (const script of [planRequiredAnnouncement(), unrecognizedCallerAnnouncement()]) {
      const lower = script.toLowerCase();
      for (const word of forbiddenAnnouncementWords) {
        expect(lower).not.toContain(word);
      }
      expect(script).not.toMatch(/\b[45]\d{2}\b/);
      expect(lower).not.toContain('error');
    }
  });

  it('speaks a URL the way a person dictates one', () => {
    expect(speakableUrl('https://docket.place/pricing')).toBe('docket.place slash pricing');
    expect(speakableUrl('https://docket.place/')).toBe('docket.place');
  });

  it('does not tell an unknown caller why they were not recognized', () => {
    const script = unrecognizedCallerAnnouncement();
    expect(script.toLowerCase()).not.toContain('unverified');
    expect(script.toLowerCase()).not.toContain('not found');
    expect(script.toLowerCase()).not.toContain('blocked');
  });
});

describe('twiml', () => {
  it('escapes text that would otherwise break the document', () => {
    expect(escapeXml(`a & b <c> "d" 'e'`)).toBe('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;');
  });

  it('speaks the announcement then hangs up rather than leaving dead air', () => {
    const twiml = announcementTwiml('Hello there.');
    expect(twiml).toContain('<Say');
    expect(twiml).toContain('Hello there.');
    expect(twiml.indexOf('<Hangup/>')).toBeGreaterThan(twiml.indexOf('</Say>'));
  });

  it('connects a live call with barge-in enabled and carries the session id through', () => {
    const twiml = relayTwiml('wss://api.docket.test/relay', 'vs_7', 'Hi Ada, it’s Athena.');
    expect(twiml).toContain('<Connect>');
    expect(twiml).toContain('url="wss://api.docket.test/relay"');
    expect(twiml).toContain('interruptible="any"');
    expect(twiml).toContain('reportInputDuringAgentSpeech="speech"');
    expect(twiml).toContain('<Parameter name="voiceSessionId" value="vs_7"/>');
    // No <Gather>/<Say> turn loop: this is a live media session, not a menu.
    expect(twiml).not.toContain('<Gather');
  });
});

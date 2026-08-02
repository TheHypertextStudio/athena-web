/**
 * `@docket/api` — the inbound call front door, mounted at `/internal/telephony/twilio`.
 *
 * @remarks
 * A machine edge like every other `/internal/*` route: it carries its own authentication (the
 * Twilio request signature) and is not session-gated, because the caller is a telephone.
 *
 * ## The decision this route makes, in order
 *
 * 1. **Is this really Twilio?** Signature or nothing. An unsigned request is answered with 403 and
 *    no TwiML — not with a polite announcement, because a forged request has no caller to be
 *    polite to.
 * 2. **Do we recognize the number?** {@link resolveCaller} matches the caller id against numbers
 *    that are verified *and* calling-enabled. Anything else hears
 *    {@link unrecognizedCallerAnnouncement} and reaches no account.
 * 3. **Does that account have a plan?** {@link isAthenaEntitled}. An unentitled caller hears
 *    {@link planRequiredAnnouncement} — which names the exact sign-up URL — and the call ends.
 *    **No voice session is opened and no conversation turn is written**, which is the property
 *    that makes "gated before reaching the agent" true rather than merely intended.
 * 4. Only then is a session opened and the call connected to the live agent.
 *
 * ## Why ConversationRelay
 *
 * Twilio's `<ConversationRelay>` performs streaming speech-to-text and streaming text-to-speech
 * inside Twilio's own media path and speaks JSON over a WebSocket to us. That is why the phone
 * channel is genuinely live rather than a `<Gather>`/`<Say>` turn-taking loop: audio starts
 * playing from the first token we send, and `interruptible="any"` means the caller talking over
 * Athena halts playback inside Twilio's media server — the only place in the chain fast enough to
 * do it — and reports it to us as an `interrupt` message carrying exactly how much of the
 * utterance was actually heard.
 */
import { apiHostConfig } from '@docket/env/api';
import { requireOrigin } from '@docket/env/hosts';
import { Hono } from 'hono';

import { env } from '../env';

import { recordCallFrom, resolveCaller } from './phone-directory';
import {
  callerGreeting,
  planRequiredAnnouncement,
  unrecognizedCallerAnnouncement,
} from './voice-announcements';
import { TWILIO_RELAY_PROVIDER_ID } from './voice-provider';
import {
  closeVoiceSession,
  isAthenaEntitled,
  liveVoiceSessionByCallSid,
  openVoiceSession,
  rememberCallSid,
  resolveVoiceWorkspace,
} from './voice-session-service';
import {
  externalRequestUrl,
  TWILIO_SIGNATURE_HEADER,
  verifyTwilioSignature,
} from './twilio-signature';

/** The path the media WebSocket connects back on. */
export const RELAY_SOCKET_PATH = '/internal/telephony/twilio/relay';

/** The voice Twilio synthesizes announcements with. */
const ANNOUNCEMENT_VOICE = 'Google.en-US-Chirp3-HD-Aoede';

/** Escape a string for inclusion in XML text or an attribute value. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * TwiML that speaks one announcement and hangs up.
 *
 * @remarks
 * `<Hangup/>` follows the `<Say>` deliberately: leaving the line open after an announcement
 * produces the dead air that makes a person think the system broke, and Twilio would eventually
 * drop the call with no explanation.
 *
 * @param script - The announcement, already written as application-owned copy.
 */
export function announcementTwiml(script: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `<Say voice="${ANNOUNCEMENT_VOICE}">${escapeXml(script)}</Say>`,
    '<Hangup/>',
    '</Response>',
  ].join('');
}

/**
 * TwiML that connects the caller to the live agent over ConversationRelay.
 *
 * @remarks
 * `interruptible="any"` is the barge-in switch and `reportInputDuringAgentSpeech="speech"` is what
 * makes the interruption *visible to us* rather than only to Twilio, so the engine can persist
 * what the caller actually heard. `dtmfDetection` is on because a keypad press is something the
 * person said, and a line that ignores it feels broken.
 *
 * The session id rides as a `<Parameter>`, which Twilio hands back verbatim in the socket's
 * `setup` message — so the socket never has to re-resolve the caller or re-decide entitlement.
 *
 * @param socketUrl - The `wss://` endpoint the media socket connects to.
 * @param voiceSessionId - The session the webhook just opened.
 * @param greeting - The first line the caller hears, spoken by Twilio before our socket is live.
 */
export function relayTwiml(socketUrl: string, voiceSessionId: string, greeting: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    '<Connect>',
    `<ConversationRelay url="${escapeXml(socketUrl)}"`,
    ` welcomeGreeting="${escapeXml(greeting)}"`,
    ' interruptible="any"',
    ' reportInputDuringAgentSpeech="speech"',
    ' dtmfDetection="true"',
    ' ttsProvider="ElevenLabs"',
    ' transcriptionProvider="Deepgram"',
    ' language="en-US">',
    `<Parameter name="voiceSessionId" value="${escapeXml(voiceSessionId)}"/>`,
    '</ConversationRelay>',
    '</Connect>',
    '</Response>',
  ].join('');
}

/**
 * The `wss://` URL Twilio's media socket connects back to.
 *
 * @remarks
 * Derived from the API origin through the host-config contract rather than assembled from a
 * separate env var, so it follows a domain cutover automatically and cannot point at the old apex.
 */
export function relaySocketUrl(): string {
  const origin = requireOrigin(apiHostConfig, 'api');
  return `${origin.replace(/^http/, 'ws')}${RELAY_SOCKET_PATH}`;
}

/** How an inbound call was answered, for tests and for metrics. */
export type InboundCallDisposition =
  | 'connected'
  | 'plan-required'
  | 'unrecognized-caller'
  | 'forged-request';

/** The result of deciding what to do with one inbound call. */
export interface InboundCallDecision {
  readonly disposition: InboundCallDisposition;
  readonly twiml: string;
  readonly status: 200 | 403;
  /** The opened session, present only when the call was connected. */
  readonly voiceSessionId?: string;
}

/**
 * Decide what an inbound call hears, and open a session only when it should reach the agent.
 *
 * @remarks
 * Extracted from the route handler so the branch table is testable without an HTTP server, and so
 * the "zero agent turns for a gated caller" property can be asserted directly: this function is
 * the only thing on the inbound path that can call {@link openVoiceSession}, and it does not do
 * so on any refusal branch.
 *
 * @param params - The Twilio POST parameters (`From`, `CallSid`, …).
 * @param now - Injected clock.
 * @returns the TwiML to answer with and what it means.
 */
export async function decideInboundCall(
  params: Readonly<Record<string, string>>,
  now: Date = new Date(),
): Promise<InboundCallDecision> {
  const resolution = await resolveCaller(params['From']);
  if (!resolution.ok) {
    return {
      disposition: 'unrecognized-caller',
      twiml: announcementTwiml(unrecognizedCallerAnnouncement()),
      status: 200,
    };
  }

  const { caller } = resolution;
  const callSid = params['CallSid'] ?? '';
  const entitled = await isAthenaEntitledForCaller(caller.userId);
  if (!entitled) {
    return {
      disposition: 'plan-required',
      twiml: announcementTwiml(planRequiredAnnouncement()),
      status: 200,
    };
  }

  const opened = await openVoiceSession({
    userId: caller.userId,
    channel: 'phone',
    provider: TWILIO_RELAY_PROVIDER_ID,
    callSid,
    phoneNumberId: caller.phoneNumberId,
  });
  rememberCallSid(opened.voiceSessionId, callSid);
  await recordCallFrom(caller.phoneNumberId, now);

  return {
    disposition: 'connected',
    twiml: relayTwiml(relaySocketUrl(), opened.voiceSessionId, callerGreeting(caller.name)),
    status: 200,
    voiceSessionId: opened.voiceSessionId,
  };
}

/** Resolve the caller's workspace and ask whether its plan entitles Athena. */
async function isAthenaEntitledForCaller(userId: string): Promise<boolean> {
  return isAthenaEntitled(await resolveVoiceWorkspace(userId));
}

/**
 * Read a Twilio webhook's `application/x-www-form-urlencoded` body.
 *
 * @remarks
 * Parsed with `URLSearchParams` rather than `Request.formData()` — the signature is computed over
 * the *decoded* parameters, and the multipart parser is both unnecessary here (Twilio never sends
 * multipart on these endpoints) and deprecated in server runtimes.
 *
 * @param request - The inbound request.
 * @returns every parameter as a string map, in the shape the signature check expects.
 */
async function readFormParams(request: Request): Promise<Record<string, string>> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(await request.clone().text())) {
    params[key] = value;
  }
  return params;
}

/** The Twilio telephony webhooks. */
const twilioVoice = new Hono();

twilioVoice.post('/voice', async (c) => {
  const params = await readFormParams(c.req.raw);

  const authentic = verifyTwilioSignature(
    env.TWILIO_AUTH_TOKEN,
    externalRequestUrl(c.req.url, c.req.raw.headers),
    params,
    c.req.header(TWILIO_SIGNATURE_HEADER),
  );
  if (!authentic) {
    // No TwiML, no announcement, no session. A forged request is not a caller.
    return c.text('Forbidden', 403);
  }

  const decision = await decideInboundCall(params);
  return c.body(decision.twiml, decision.status, { 'content-type': 'text/xml; charset=utf-8' });
});

/**
 * The call-status callback Twilio posts when a ConversationRelay session finishes.
 *
 * @remarks
 * Closes the `voice_session` row for calls that ended without the socket saying so — a dropped
 * carrier leg, a Twilio-side failure — so a call that vanished does not leave a session
 * permanently `active`.
 */
twilioVoice.post('/status', async (c) => {
  const params = await readFormParams(c.req.raw);
  const authentic = verifyTwilioSignature(
    env.TWILIO_AUTH_TOKEN,
    externalRequestUrl(c.req.url, c.req.raw.headers),
    params,
    c.req.header(TWILIO_SIGNATURE_HEADER),
  );
  if (!authentic) return c.text('Forbidden', 403);

  const callSid = params['CallSid'];
  if (callSid) {
    const session = liveVoiceSessionByCallSid(callSid);
    if (session) await closeVoiceSession(session.ctx.voiceSessionId, 'caller_hung_up');
  }
  return c.body(null, 204);
});

export default twilioVoice;

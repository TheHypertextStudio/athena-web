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
 * 3. **Does that organization have Athena access?** {@link isAthenaEntitled}. An organization
 *    without access hears {@link productRequiredAnnouncement} — which names the exact purchase URL
 *    — and the call ends.
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
import { apiHosts, requireEnvOrigin } from '@docket/env/api';
import { Hono } from 'hono';

import { env } from '../env';
import { getContainer } from '../container';

import { recordCallFrom, resolveCaller } from './phone-directory';
import {
  callbackAnnouncement,
  callerGreeting,
  productRequiredAnnouncement,
  unrecognizedCallerAnnouncement,
} from './voice-announcements';
import {
  authorizationById,
  authorizationByOutboundSid,
  claimCallbackAuthorization,
  createWeakInboundAuthorization,
  notifyCallbackCooldownAfterFailure,
  setAuthorizationState,
  startCallbackForInboundCall,
} from './phone-call-authorization';
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
import type { TelephonyProvider } from './twilio-telephony';

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

/** TwiML that asks the verified callback recipient for one confirmation digit. */
export function callbackGatherTwiml(authorizationId: string): string {
  const origin = requireEnvOrigin(apiHosts.api, 'API_URL');
  const action = `${origin}/internal/telephony/twilio/callback/${encodeURIComponent(authorizationId)}/digit`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Response>',
    `<Gather input="dtmf" numDigits="1" timeout="8" actionOnEmptyResult="true" method="POST" action="${escapeXml(action)}">`,
    `<Say voice="${ANNOUNCEMENT_VOICE}">This is Athena from Docket. Press 1 to continue your call.</Say>`,
    '</Gather>',
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
  const origin = requireEnvOrigin(apiHosts.api, 'API_URL');
  return `${origin.replace(/^http/, 'ws')}${RELAY_SOCKET_PATH}`;
}

/** How an inbound call was answered, for tests and for metrics. */
export type InboundCallDisposition =
  | 'connected'
  | 'callback-pending'
  | 'callback-refused'
  | 'product-required'
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
 * Confirm one callback digit and open the restricted phone session only on the expected call leg.
 */
export async function confirmCallbackAuthorization(
  authorizationId: string,
  outboundCallSid: string,
  digit: string,
  now: Date = new Date(),
): Promise<InboundCallDecision> {
  const authorization = await authorizationById(authorizationId);
  if (authorization?.outboundCallSid !== outboundCallSid) {
    return callbackRefusedDecision();
  }
  if (authorization.expiresAt.getTime() <= now.getTime()) {
    await setAuthorizationState(authorization.id, 'expired', {
      failureReason: 'authorization_expired',
    });
    return callbackRefusedDecision();
  }
  if (authorization.state === 'connected') {
    const existing = liveVoiceSessionByCallSid(outboundCallSid);
    if (existing) {
      return {
        disposition: 'connected',
        twiml: relayTwiml(relaySocketUrl(), existing.ctx.voiceSessionId, callerGreeting('there')),
        status: 200,
        voiceSessionId: existing.ctx.voiceSessionId,
      };
    }
    return callbackRefusedDecision();
  }
  if (!['dialing', 'awaiting_digit'].includes(authorization.state))
    return callbackRefusedDecision();
  const claimed = await claimCallbackAuthorization(authorization.id, outboundCallSid, now);
  if (!claimed) {
    const existing = liveVoiceSessionByCallSid(outboundCallSid);
    if (!existing) return callbackRefusedDecision();
    return {
      disposition: 'connected',
      twiml: relayTwiml(relaySocketUrl(), existing.ctx.voiceSessionId, callerGreeting('there')),
      status: 200,
      voiceSessionId: existing.ctx.voiceSessionId,
    };
  }
  if (digit !== '1') {
    await setAuthorizationState(authorization.id, 'failed', {
      failureReason: 'confirmation_rejected',
    });
    return callbackRefusedDecision();
  }
  const resolution = await resolveCaller(authorization.destinationE164);
  if (
    !resolution.ok ||
    resolution.caller.userId !== authorization.userId ||
    resolution.caller.phoneNumberId !== authorization.phoneNumberId ||
    !(await isAthenaEntitledForCaller(authorization.userId))
  ) {
    await setAuthorizationState(authorization.id, 'canceled', {
      failureReason: 'phone_access_revoked',
    });
    return callbackRefusedDecision();
  }

  const existing = liveVoiceSessionByCallSid(outboundCallSid);
  if (existing) {
    return {
      disposition: 'connected',
      twiml: relayTwiml(
        relaySocketUrl(),
        existing.ctx.voiceSessionId,
        callerGreeting(resolution.caller.name),
      ),
      status: 200,
      voiceSessionId: existing.ctx.voiceSessionId,
    };
  }
  const opened = await openVoiceSession({
    userId: authorization.userId,
    channel: 'phone',
    provider: TWILIO_RELAY_PROVIDER_ID,
    callSid: outboundCallSid,
    phoneNumberId: authorization.phoneNumberId,
    authorizationMethod: authorization.source === 'docket' ? 'docket' : 'callback',
    stirVerification: authorization.stirVerification,
  });
  rememberCallSid(opened.voiceSessionId, outboundCallSid);
  await setAuthorizationState(authorization.id, 'connected', { authorizedAt: now });
  await recordCallFrom(resolution.caller.phoneNumberId, now);
  return {
    disposition: 'connected',
    twiml: relayTwiml(
      relaySocketUrl(),
      opened.voiceSessionId,
      callerGreeting(resolution.caller.name),
    ),
    status: 200,
    voiceSessionId: opened.voiceSessionId,
  };
}

function callbackRefusedDecision(): InboundCallDecision {
  return {
    disposition: 'callback-refused',
    twiml: announcementTwiml(
      'I could not confirm this call. Open Docket and choose Call me when you are ready.',
    ),
    status: 200,
  };
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
      disposition: 'product-required',
      twiml: announcementTwiml(productRequiredAnnouncement()),
      status: 200,
    };
  }

  const stirVerification = params['StirVerstat'];
  if (stirVerification !== 'TN-Validation-Passed-A') {
    await createWeakInboundAuthorization(caller, callSid, stirVerification, now);
    return {
      disposition: 'callback-pending',
      twiml: announcementTwiml(callbackAnnouncement()),
      status: 200,
    };
  }

  const opened = await openVoiceSession({
    userId: caller.userId,
    channel: 'phone',
    provider: TWILIO_RELAY_PROVIDER_ID,
    callSid,
    phoneNumberId: caller.phoneNumberId,
    authorizationMethod: 'stir_a',
    stirVerification,
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

/** Resolve the caller's organization and ask whether an active product grants Athena. */
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

twilioVoice.post('/callback/:authorizationId/answer', async (c) => {
  const params = await readFormParams(c.req.raw);
  if (!validTwilioRequest(c.req.url, c.req.raw.headers, params)) return c.text('Forbidden', 403);
  const authorization = await authorizationById(c.req.param('authorizationId'));
  const callSid = params['CallSid'];
  if (
    !authorization ||
    !callSid ||
    authorization.outboundCallSid !== callSid ||
    !['dialing', 'awaiting_digit'].includes(authorization.state) ||
    authorization.expiresAt.getTime() <= Date.now()
  ) {
    return c.body(callbackRefusedDecision().twiml, 200, {
      'content-type': 'text/xml; charset=utf-8',
    });
  }
  await setAuthorizationState(authorization.id, 'awaiting_digit');
  return c.body(callbackGatherTwiml(authorization.id), 200, {
    'content-type': 'text/xml; charset=utf-8',
  });
});

twilioVoice.post('/callback/:authorizationId/digit', async (c) => {
  const params = await readFormParams(c.req.raw);
  if (!validTwilioRequest(c.req.url, c.req.raw.headers, params)) return c.text('Forbidden', 403);
  const decision = await confirmCallbackAuthorization(
    c.req.param('authorizationId'),
    params['CallSid'] ?? '',
    params['Digits'] ?? '',
  );
  return c.body(decision.twiml, decision.status, {
    'content-type': 'text/xml; charset=utf-8',
  });
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
  if (callSid) await handleCallStatus(callSid, params['CallStatus'], getContainer().telephony);
  return c.body(null, 204);
});

export default twilioVoice;

const TERMINAL_CALL_STATUSES = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled']);

/** Apply one signed Twilio status transition without closing a call that is still live. */
export async function handleCallStatus(
  callSid: string,
  callStatus: string | undefined,
  telephony: TelephonyProvider,
): Promise<void> {
  if (!callStatus || !TERMINAL_CALL_STATUSES.has(callStatus)) return;

  const session = liveVoiceSessionByCallSid(callSid);
  if (session) await closeVoiceSession(session.ctx.voiceSessionId, 'caller_hung_up');

  if (callStatus === 'completed') {
    await startCallbackForInboundCall(callSid, telephony);
  }

  const callback = await authorizationByOutboundSid(callSid);
  if (!callback || ['completed', 'failed', 'expired', 'canceled'].includes(callback.state)) return;
  const updated = await setAuthorizationState(
    callback.id,
    callback.state === 'connected' ? 'completed' : 'failed',
    callback.state === 'connected'
      ? {}
      : { failureReason: `callback_${callStatus.replace(/-/g, '_')}` },
  );
  if (updated?.state === 'failed') await notifyCallbackCooldownAfterFailure(updated.id);
}

function validTwilioRequest(
  requestUrl: string,
  headers: Headers,
  params: Readonly<Record<string, string>>,
): boolean {
  return verifyTwilioSignature(
    env.TWILIO_AUTH_TOKEN,
    externalRequestUrl(requestUrl, headers),
    params,
    headers.get(TWILIO_SIGNATURE_HEADER) ?? undefined,
  );
}

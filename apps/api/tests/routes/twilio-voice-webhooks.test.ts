/**
 * The Twilio webhook surface: who is allowed to make Athena's phone endpoints do anything.
 *
 * @remarks
 * These four routes are unauthenticated in the ordinary sense — Twilio POSTs to them from the
 * public internet with no session — so the HMAC signature is the *only* thing standing between a
 * stranger and an inbound-call decision, a callback answer, or a call-status write. That check had
 * no test.
 *
 * The properties worth stating plainly:
 *
 * - **A request without a valid signature does nothing at all.** Not a 500, not a partial write,
 *   not an announcement: a 403 and no side effect. A forged request is not a caller.
 * - **A validly signed request is served.** Otherwise the first property is satisfiable by an
 *   endpoint that rejects everything, which is not the same as an endpoint that authenticates.
 *
 * Signatures here are computed with the real `twilioSignature` against the real auth token, so
 * these exercise the production verifier rather than a stub of it.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as TwilioModule from '../../src/routes/twilio-voice';
import { twilioSignature, TWILIO_SIGNATURE_HEADER } from '../../src/routes/twilio-signature';
import { getDb } from '../support/routes-harness';

let twilioVoice!: typeof TwilioModule.default;

/** The token the API's env contract exposes to the routes under test. */
const AUTH_TOKEN = process.env['TWILIO_AUTH_TOKEN'] ?? '';

beforeAll(async () => {
  await getDb();
  twilioVoice = (await import('../../src/routes/twilio-voice')).default;
});

/** A form POST carrying whatever signature the caller supplies. */
async function post(
  path: string,
  params: Record<string, string>,
  signature: string | null,
): Promise<Response> {
  const url = `https://api.docket.test${path}`;
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (signature !== null) headers[TWILIO_SIGNATURE_HEADER] = signature;
  return await twilioVoice.request(url, {
    method: 'POST',
    headers,
    body: new URLSearchParams(params).toString(),
  });
}

/** The same POST, signed the way Twilio signs it. */
async function signedPost(path: string, params: Record<string, string>): Promise<Response> {
  return await post(
    path,
    params,
    twilioSignature(AUTH_TOKEN, `https://api.docket.test${path}`, params),
  );
}

describe('twilio webhook signature enforcement', () => {
  const routes = [
    ['/voice', { From: '+14155550100', CallSid: 'CA_sig_1' }],
    ['/callback/auth_sig_1/answer', { CallSid: 'CA_sig_2' }],
    ['/callback/auth_sig_1/digit', { CallSid: 'CA_sig_3', Digits: '1' }],
    ['/status', { CallSid: 'CA_sig_4', CallStatus: 'completed' }],
  ] as const;

  it.each(routes)('refuses %s when the signature header is absent', async (path, params) => {
    const response = await post(path, { ...params }, null);
    expect(response.status).toBe(403);
  });

  it.each(routes)('refuses %s when the signature is forged', async (path, params) => {
    const response = await post(path, { ...params }, 'not-a-real-signature');
    expect(response.status).toBe(403);
  });

  it.each(routes)(
    'refuses %s when a signed request is replayed with a tampered parameter',
    async (path, params) => {
      // Twilio signs the parameters, not just the URL, so changing one after signing must fail.
      // This is the property that stops a captured webhook being replayed against another call.
      const signature = twilioSignature(AUTH_TOKEN, `https://api.docket.test${path}`, params);
      const response = await post(path, { ...params, CallSid: 'CA_tampered' }, signature);
      expect(response.status).toBe(403);
    },
  );

  it.each(routes)(
    'refuses %s when the signature was computed for a different URL',
    async (path, params) => {
      const signature = twilioSignature(AUTH_TOKEN, 'https://api.docket.test/elsewhere', params);
      const response = await post(path, { ...params }, signature);
      expect(response.status).toBe(403);
    },
  );

  it('answers a validly signed inbound call rather than rejecting everything', async () => {
    // Without this, every assertion above is satisfied by a route that always returns 403.
    const response = await signedPost('/voice', {
      From: '+14155550199',
      CallSid: 'CA_sig_ok',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/xml');
    expect(await response.text()).toContain('<Response>');
  });

  it.each([
    ['/callback/auth_missing/answer', { CallSid: 'CA_sig_ok_2' }],
    ['/callback/auth_missing/digit', { CallSid: 'CA_sig_ok_3', Digits: '1' }],
  ] as const)(
    'accepts the signature on %s and then declines the unknown authorization on its own terms',
    async (path, params) => {
      // Past the signature gate the route is reached, so an unknown authorization id is answered
      // as a call outcome rather than as a 403 — the two refusals must stay distinguishable.
      const response = await signedPost(path, { ...params });

      expect(response.status).not.toBe(403);
    },
  );

  it.each([
    ['/callback/auth_missing/answer', {}],
    ['/callback/auth_missing/digit', { Digits: '1' }],
    ['/status', { CallStatus: 'completed' }],
  ] as const)('handles a validly signed %s that omits CallSid', async (path, params) => {
    // Twilio always sends CallSid, so its absence means a malformed or hand-rolled request. It is
    // past the signature gate, so the route has to decline it rather than dereference nothing.
    const response = await signedPost(path, { ...params });

    expect(response.status).not.toBe(403);
    expect(response.status).toBeLessThan(500);
  });

  it('accepts a validly signed status callback for a call it does not know', async () => {
    const response = await signedPost('/status', {
      CallSid: 'CA_unknown_status',
      CallStatus: 'completed',
    });

    expect(response.status).not.toBe(403);
  });
});

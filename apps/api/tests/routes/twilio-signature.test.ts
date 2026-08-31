/**
 * Rebuilding the URL Twilio actually signed, from behind a proxy.
 *
 * @remarks
 * Twilio signs the absolute URL it called. Cloud Run terminates TLS and forwards over plain HTTP,
 * so the URL the Node server sees is `http://…` on an internal host while Twilio signed
 * `https://api.docket.…`. If this reconstruction is wrong the signature never matches and every
 * inbound call is answered with a 403 — an outage that looks exactly like a credential problem.
 *
 * The signature itself is covered through the webhook routes; what is asserted here is the header
 * precedence, because it is the part that only misbehaves in production topologies.
 */
import { describe, expect, it } from 'vitest';

import { externalRequestUrl, twilioSignature } from '../../src/routes/twilio-signature';

/** Build a Headers bag, omitting the entries a given topology would not send. */
function headers(entries: Record<string, string | undefined>): Headers {
  const bag = new Headers();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) bag.set(key, value);
  }
  return bag;
}

describe('externalRequestUrl', () => {
  it('prefers the forwarded protocol and host over what the local server saw', () => {
    expect(
      externalRequestUrl(
        'http://10.0.0.7:8080/webhooks/twilio/voice',
        headers({
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'api.docket.studio',
          host: '10.0.0.7:8080',
        }),
      ),
    ).toBe('https://api.docket.studio/webhooks/twilio/voice');
  });

  it('takes the outermost proxy from a comma-joined forwarded header', () => {
    // The first value is the hop the provider actually talked to; the rest are internal.
    expect(
      externalRequestUrl(
        'http://10.0.0.7/voice',
        headers({
          'x-forwarded-proto': 'https, http',
          'x-forwarded-host': 'api.docket.studio, 10.0.0.7',
        }),
      ),
    ).toBe('https://api.docket.studio/voice');
  });

  it('falls back to Host when nothing was forwarded', () => {
    expect(
      externalRequestUrl('http://internal/voice', headers({ host: 'api.docket.studio' })),
    ).toBe('http://api.docket.studio/voice');
  });

  it('falls back to the request URL when there are no proxy headers at all', () => {
    expect(externalRequestUrl('https://api.docket.studio/voice', headers({}))).toBe(
      'https://api.docket.studio/voice',
    );
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['a leading empty element', ', api.other.test'],
  ])('ignores a forwarded host that is %s', (_case, forwarded) => {
    // A blank forwarded value must not produce `https:///voice`; it is treated as absent.
    expect(
      externalRequestUrl(
        'https://api.docket.studio/voice',
        headers({ 'x-forwarded-host': forwarded }),
      ),
    ).toBe('https://api.docket.studio/voice');
  });

  it('keeps the query string, which is part of what was signed', () => {
    expect(
      externalRequestUrl(
        'http://internal/voice?attempt=2',
        headers({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.docket.studio' }),
      ),
    ).toBe('https://api.docket.studio/voice?attempt=2');
  });
});

describe('twilioSignature', () => {
  it('signs parameters in sorted key order, independent of insertion order', () => {
    // Twilio sorts before signing, so a map built in a different order must sign identically —
    // otherwise verification would depend on how the form happened to be parsed.
    const url = 'https://api.docket.studio/voice';
    expect(twilioSignature('token', url, { CallSid: 'CA1', From: '+1415', To: '+1650' })).toBe(
      twilioSignature('token', url, { To: '+1650', From: '+1415', CallSid: 'CA1' }),
    );
  });

  it('changes when any signed input changes', () => {
    const url = 'https://api.docket.studio/voice';
    const base = twilioSignature('token', url, { CallSid: 'CA1' });

    expect(twilioSignature('other-token', url, { CallSid: 'CA1' })).not.toBe(base);
    expect(twilioSignature('token', `${url}?x=1`, { CallSid: 'CA1' })).not.toBe(base);
    expect(twilioSignature('token', url, { CallSid: 'CA2' })).not.toBe(base);
    expect(twilioSignature('token', url, { CallSid: 'CA1', Extra: 'x' })).not.toBe(base);
  });

  it('treats an empty parameter value as present rather than skipping it', () => {
    const url = 'https://api.docket.studio/voice';
    expect(twilioSignature('token', url, { CallSid: '' })).not.toBe(
      twilioSignature('token', url, {}),
    );
  });
});

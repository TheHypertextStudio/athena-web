/**
 * Signature verification is the whole security model of a public receiving endpoint, so these
 * tests are about what a *forger* can and cannot do: sign with the wrong key, tamper with the
 * body after signing, replay a captured request later, strip the headers, or send a signature for
 * a different message id. Each of those has its own case, and each asserts the specific stable
 * code — a blanket "it failed" would let a real regression (say, the timestamp check silently
 * never running) pass.
 */
import { describe, expect, it } from 'vitest';

import {
  SVIX_TOLERANCE_SECONDS,
  signSvixPayload,
  verifySvixSignature,
} from '../../src/svix-signature';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const PAYLOAD = '{"type":"email.received","data":{"email_id":"m1"}}';
const ID = 'msg_2abc';

function at(seconds: number): Date {
  return new Date(seconds * 1000);
}

describe('verifySvixSignature', () => {
  const now = at(1_700_000_000);
  const timestamp = String(1_700_000_000);
  const good = `v1,${signSvixPayload(SECRET, ID, timestamp, PAYLOAD)}`;

  it('accepts a request signed with the endpoint secret', () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp,
        signature: good,
        payload: PAYLOAD,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it('accepts when any one of several offered signatures matches (secret rotation)', () => {
    const other = `v1,${signSvixPayload('whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', ID, timestamp, PAYLOAD)}`;
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp,
        signature: `${other} ${good}`,
        payload: PAYLOAD,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a signature produced with a different secret', () => {
    const forged = `v1,${signSvixPayload('whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', ID, timestamp, PAYLOAD)}`;
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp,
        signature: forged,
        payload: PAYLOAD,
        now,
      }),
    ).toEqual({ ok: false, code: 'invalid-signature' });
  });

  it('rejects a body tampered with after signing', () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp,
        signature: good,
        payload: `${PAYLOAD} `,
        now,
      }),
    ).toEqual({ ok: false, code: 'invalid-signature' });
  });

  it('rejects a signature minted for a different message id', () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: 'msg_other',
        timestamp,
        signature: good,
        payload: PAYLOAD,
        now,
      }),
    ).toEqual({ ok: false, code: 'invalid-signature' });
  });

  it('rejects a replay past the tolerance window, in either direction', () => {
    const late = at(1_700_000_000 + SVIX_TOLERANCE_SECONDS + 1);
    const early = at(1_700_000_000 - SVIX_TOLERANCE_SECONDS - 1);
    for (const clock of [late, early]) {
      expect(
        verifySvixSignature({
          secret: SECRET,
          id: ID,
          timestamp,
          signature: good,
          payload: PAYLOAD,
          now: clock,
        }),
      ).toEqual({ ok: false, code: 'stale-timestamp' });
    }
  });

  it('accepts a request right at the edge of the tolerance window', () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp,
        signature: good,
        payload: PAYLOAD,
        now: at(1_700_000_000 + SVIX_TOLERANCE_SECONDS),
      }),
    ).toEqual({ ok: true });
  });

  it('reports a missing header as missing rather than invalid', () => {
    for (const missing of ['id', 'timestamp', 'signature'] as const) {
      const input = {
        secret: SECRET,
        id: ID as string | undefined,
        timestamp: timestamp as string | undefined,
        signature: good as string | undefined,
        payload: PAYLOAD,
        now,
      };
      input[missing] = undefined;
      expect(verifySvixSignature(input)).toEqual({ ok: false, code: 'missing-signature' });
    }
  });

  it('rejects an unparseable timestamp', () => {
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp: 'not-a-number',
        signature: good,
        payload: PAYLOAD,
        now,
      }),
    ).toEqual({ ok: false, code: 'stale-timestamp' });
  });

  it('rejects an unversioned or empty signature list', () => {
    for (const header of ['', '   ', 'v0,abc', 'no-comma']) {
      expect(
        verifySvixSignature({
          secret: SECRET,
          id: ID,
          timestamp,
          signature: header,
          payload: PAYLOAD,
          now,
        }).ok,
      ).toBe(false);
    }
  });

  it('accepts a secret supplied without its whsec_ prefix', () => {
    const bare = SECRET.slice('whsec_'.length);
    const signed = `v1,${signSvixPayload(bare, ID, timestamp, PAYLOAD)}`;
    expect(
      verifySvixSignature({
        secret: SECRET,
        id: ID,
        timestamp,
        signature: signed,
        payload: PAYLOAD,
        now,
      }),
    ).toEqual({ ok: true });
  });
});

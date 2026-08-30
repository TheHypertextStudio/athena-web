/**
 * `@docket/api` — the caller-owned phone-numbers HTTP surface.
 *
 * @remarks
 * `phone-verification.test.ts` already proves the underlying `PhoneVerificationService` state
 * machine (rate limits, attempt budgets, expiry). This file proves the route layer wrapped
 * around it: ownership isolation between callers, the country/dial-code validation gate, the
 * verified/blocked create-time conflicts, and translating each verification refusal into the
 * application-owned copy the surface renders.
 */
import type * as DbModule from '@docket/db';
import { PHONE_VERIFICATION_TTL_MS } from '@docket/athena/phone';
import { CaptureSmsSender } from '@docket/integrations';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { CaptureTelephonyProvider } from '../../src/routes/twilio-telephony';
import type { createPhoneNumberRoutes as CreatePhoneNumberRoutes } from '../../src/routes/phone-numbers';
import type { PhoneVerificationService as PhoneVerificationServiceClass } from '../../src/routes/phone-verification';
import { appWithSession, fakeSession, getDb, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let createPhoneNumberRoutes!: typeof CreatePhoneNumberRoutes;
let PhoneVerificationService!: typeof PhoneVerificationServiceClass;

const CODE = '271828';
const J = { 'content-type': 'application/json' };

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ createPhoneNumberRoutes } = await import('../../src/routes/phone-numbers'));
  ({ PhoneVerificationService } = await import('../../src/routes/phone-verification'));
});

async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** A clock the test moves by hand, mirroring `phone-verification.test.ts`. */
function fixedClock(start: number): { now: () => Date; advance: (ms: number) => void } {
  let ms = start;
  return {
    now: () => new Date(ms),
    advance: (delta: number) => {
      ms += delta;
    },
  };
}

/** A route app + its underlying SMS capture, for one fresh signed-in user. */
async function harness(label: string) {
  const userId = await seedUserWithHub(db, schema, label);
  const sms = new CaptureSmsSender();
  const telephony = new CaptureTelephonyProvider();
  const clock = fixedClock(Date.UTC(2026, 7, 2, 9, 0, 0));
  const createVerification = () =>
    new PhoneVerificationService({
      sms: () => sms,
      now: clock.now,
      generateCode: () => CODE,
    });
  const routes = createPhoneNumberRoutes(createVerification, {
    telephony: () => telephony,
    athenaNumber: () => '+17025550100',
  });
  const app = appWithSession(routes, fakeSession(userId));
  return { app, routes, userId, sms, telephony, clock };
}

interface ChallengeSummaryWire {
  readonly expiresAt: string;
  readonly attemptsRemaining: number;
  readonly resendAvailableAt: string;
  readonly deliveryFailed: boolean;
}

interface PhoneNumberWire {
  readonly id: string;
  readonly masked: string;
  readonly dialCode: string;
  readonly country: string;
  readonly status: string;
  readonly callingEnabled: boolean;
  readonly verifiedAt: string | null;
  readonly challenge: ChallengeSummaryWire | null;
}

interface ChallengeWire {
  readonly phoneNumber: PhoneNumberWire;
  readonly expiresAt: string;
  readonly attemptsRemaining: number;
  readonly resendAvailableAt: string;
  readonly deliveryFailed: boolean;
}

describe('phone number routes', () => {
  it('requires a fresh session before binding a phone credential', async () => {
    const userId = await seedUserWithHub(db, schema, 'PhoneCreateStepUp');
    const session = fakeSession(userId);
    if (!session) throw new Error('expected fake session');
    session.session.createdAt = new Date(Date.now() - 6 * 60 * 1000);
    const routes = createPhoneNumberRoutes(
      () =>
        new PhoneVerificationService({
          sms: () => new CaptureSmsSender(),
          generateCode: () => CODE,
        }),
    );
    const app = appWithSession(routes, session);

    const response = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550101' }),
    });

    expect(response.status).toBe(401);
    expect(await body<{ code: string }>(response)).toMatchObject({ code: 'reauth_required' });
  });

  it('requires freshness for verify, enable, and delete but lets a stale session pause calls', async () => {
    const { app, routes, userId } = await harness('PhoneMutationStepUp');
    const created = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550102' }),
      }),
    );
    const stale = fakeSession(userId);
    if (!stale) throw new Error('expected fake session');
    stale.session.createdAt = new Date(Date.now() - 6 * 60 * 1000);
    const staleApp = appWithSession(routes, stale);

    const verify = await staleApp.request(`/${created.phoneNumber.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: CODE }),
    });
    expect(verify.status).toBe(401);

    await db
      .update(schema.phoneNumber)
      .set({ status: 'verified', verifiedAt: new Date(), callingEnabled: true })
      .where(eq(schema.phoneNumber.id, created.phoneNumber.id));
    const paused = await staleApp.request(`/${created.phoneNumber.id}/calling`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ enabled: false }),
    });
    expect(paused.status).toBe(200);
    const enabled = await staleApp.request(`/${created.phoneNumber.id}/calling`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ enabled: true }),
    });
    expect(enabled.status).toBe(401);
    expect(
      (await staleApp.request(`/${created.phoneNumber.id}`, { method: 'DELETE' })).status,
    ).toBe(401);
  });

  it('requires a signed-in caller for every route', async () => {
    const routes = createPhoneNumberRoutes(
      () =>
        new PhoneVerificationService({
          sms: () => new CaptureSmsSender(),
          generateCode: () => CODE,
        }),
    );
    const app = appWithSession(routes, null);
    expect((await app.request('/')).status).toBe(401);
    expect(
      (
        await app.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550123' }),
        })
      ).status,
    ).toBe(401);
  });

  it('binds a number, texts the code, and lists it back masked', async () => {
    const { app, sms } = await harness('PhoneCreate');

    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550123' }),
    });
    expect(res.status).toBe(200);
    const challenge = await body<ChallengeWire>(res);
    expect(challenge.phoneNumber).toMatchObject({
      dialCode: '1',
      country: 'US',
      status: 'pending',
      callingEnabled: true,
      verifiedAt: null,
    });
    expect(challenge.phoneNumber.masked).not.toContain('4155550123');
    expect(challenge.attemptsRemaining).toBeGreaterThan(0);
    expect(sms.outbox).toHaveLength(1);
    expect(sms.outbox[0]?.body).toContain(CODE);

    const list = await body<{ items: PhoneNumberWire[] }>(await app.request('/'));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.id).toBe(challenge.phoneNumber.id);
  });

  it('starts an authenticated callback only to the stored verified number', async () => {
    const { app, telephony } = await harness('PhoneCallMe');
    const created = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550129' }),
      }),
    );
    await app.request(`/${created.phoneNumber.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: CODE }),
    });

    const response = await app.request(`/${created.phoneNumber.id}/call`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(await body<{ state: string }>(response)).toMatchObject({ state: 'dialing' });
    expect(telephony.callbacks).toHaveLength(1);
    expect(telephony.callbacks[0]?.to).toBe('+14155550129');
  });

  it('refuses a country/dial-code pair that does not match the allowlist', async () => {
    const { app } = await harness('PhoneBadDialCode');
    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ country: 'US', dialCode: '44', nationalNumber: '4155550123' }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects countries whose national-number rules v1 does not validate', async () => {
    const { app } = await harness('PhoneUnsupportedCountry');
    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ country: 'GB', dialCode: '44', nationalNumber: '02079460958' }),
    });
    expect(res.status).toBe(422);
  });

  it('refuses a national number that cannot compose a valid E.164 number', async () => {
    const { app } = await harness('PhoneBadNational');
    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '0' }),
    });
    expect(res.status).toBe(422);
  });

  it('re-sends a challenge for the same pending number instead of creating a duplicate', async () => {
    const { app, clock } = await harness('PhoneReclaimPending');
    const first = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550199' }),
      }),
    );
    // Past the resend-too-soon window, so this reuses the same row for a fresh challenge.
    clock.advance(61_000);
    const second = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550199' }),
      }),
    );
    expect(second.phoneNumber.id).toBe(first.phoneNumber.id);
  });

  it('refuses to re-bind a number that is already verified on the account', async () => {
    const { app } = await harness('PhoneAlreadyVerified');
    const created = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550142' }),
      }),
    );
    await app.request(`/${created.phoneNumber.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: CODE }),
    });

    const again = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550142' }),
    });
    expect(again.status).toBe(409);
  });

  it('refuses to re-bind a number that is blocked', async () => {
    const { app, userId } = await harness('PhoneBlocked');
    await db.insert(schema.phoneNumber).values({
      userId,
      e164: '+14155550188',
      dialCode: '1',
      country: 'US',
      nationalNumber: '4155550188',
      status: 'blocked',
    });

    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550188' }),
    });
    expect(res.status).toBe(409);
  });

  it('resends a fresh code for a pending number via the dedicated endpoint', async () => {
    const { app, sms } = await harness('PhoneResend');
    const created = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550155' }),
      }),
    );
    sms.outbox.length = 0;

    const resent = await app.request(`/${created.phoneNumber.id}/resend`, { method: 'POST' });
    expect(resent.status).toBe(409); // the verification service itself rate-limits an immediate resend
    expect(sms.outbox).toHaveLength(0);
  });

  it('lists a pending number with the limits needed to finish verifying it elsewhere', async () => {
    // The surface gates its code box on this field. Without it a person who requests a code and
    // then reloads settings — or opens them on the handset the code was texted to — has a row
    // saying "waiting for the code" and nowhere to enter one.
    const { app } = await harness('PhoneListChallenge');
    const created = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550170' }),
      }),
    );

    const listed = await body<{ items: PhoneNumberWire[] }>(await app.request('/'));
    const pending = listed.items.find((item) => item.id === created.phoneNumber.id);
    expect(pending?.status).toBe('pending');
    expect(pending?.challenge).toMatchObject({
      expiresAt: created.expiresAt,
      attemptsRemaining: created.attemptsRemaining,
      resendAvailableAt: created.resendAvailableAt,
      deliveryFailed: false,
    });

    // Once the code is spent the challenge is gone, so the surface stops offering to enter one.
    await app.request(`/${created.phoneNumber.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: CODE }),
    });
    const afterVerify = await body<{ items: PhoneNumberWire[] }>(await app.request('/'));
    const verified = afterVerify.items.find((item) => item.id === created.phoneNumber.id);
    expect(verified?.status).toBe('verified');
    expect(verified?.challenge).toBeNull();
  });

  it('lists numbers on a deploy that cannot send SMS at all', async () => {
    // `container.sms` throws outside local mode when no SMS credentials are configured. Reading
    // your own numbers must not depend on the ability to send to them, so nothing on this path may
    // resolve the transport — which is why the service takes a thunk rather than a sender.
    const userId = await seedUserWithHub(db, schema, 'PhoneListNoSms');
    const unconfigured = () =>
      new PhoneVerificationService({
        sms: () => {
          throw new Error('Missing required production SMS config: SMS_ENDPOINT, SMS_API_KEY');
        },
      });
    const app = appWithSession(createPhoneNumberRoutes(unconfigured), fakeSession(userId));

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect((await body<{ items: PhoneNumberWire[] }>(res)).items).toEqual([]);
  });

  it('refuses to resend for a number that is not awaiting verification', async () => {
    const { app } = await harness('PhoneResendVerified');
    const created = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550166' }),
      }),
    );
    await app.request(`/${created.phoneNumber.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: CODE }),
    });

    const resent = await app.request(`/${created.phoneNumber.id}/resend`, { method: 'POST' });
    expect(resent.status).toBe(409);
  });

  it('reports each verification refusal with its own application-owned message', async () => {
    const { app } = await harness('PhoneVerifyRefusals');
    const created = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550177' }),
      }),
    );

    const wrong = await app.request(`/${created.phoneNumber.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: '000000' }),
    });
    expect(wrong.status).toBe(409);
    expect((await body<{ code: string }>(wrong)).code).toBe('conflict');

    const verified = await app.request(`/${created.phoneNumber.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: CODE }),
    });
    expect(verified.status).toBe(200);
    expect((await body<PhoneNumberWire>(verified)).status).toBe('verified');

    // Already settled: the challenge is gone, so the same code no longer answers anything.
    const noChallenge = await app.request(`/${created.phoneNumber.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: CODE }),
    });
    expect(noChallenge.status).toBe(409);
  });

  it('turns calling on and off only for a verified number', async () => {
    const { app } = await harness('PhoneCalling');
    const created = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550133' }),
      }),
    );

    const beforeVerify = await app.request(`/${created.phoneNumber.id}/calling`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ enabled: false }),
    });
    expect(beforeVerify.status).toBe(409);

    await app.request(`/${created.phoneNumber.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: CODE }),
    });

    const off = await app.request(`/${created.phoneNumber.id}/calling`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    expect((await body<PhoneNumberWire>(off)).callingEnabled).toBe(false);

    const on = await app.request(`/${created.phoneNumber.id}/calling`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ enabled: true }),
    });
    expect((await body<PhoneNumberWire>(on)).callingEnabled).toBe(true);
  });

  it('removes a bound number', async () => {
    const { app } = await harness('PhoneDelete');
    const created = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550144' }),
      }),
    );

    const deleted = await app.request(`/${created.phoneNumber.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    // The number was mid-verification, so the response describes it as it stood when it was asked
    // for — a `null` here would say no code had been sent, which is the opposite of what happened.
    expect((await body<PhoneNumberWire>(deleted)).challenge).not.toBeNull();

    const list = await body<{ items: PhoneNumberWire[] }>(await app.request('/'));
    expect(list.items).toHaveLength(0);
  });

  it('refuses a code that outlived its challenge', async () => {
    const { app, clock } = await harness('PhoneVerifyExpired');
    const created = await body<ChallengeWire>(
      await app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550122' }),
      }),
    );

    clock.advance(PHONE_VERIFICATION_TTL_MS + 1_000);
    const late = await app.request(`/${created.phoneNumber.id}/verify`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ code: CODE }),
    });
    expect(late.status).toBe(409);
    expect((await body<{ code: string }>(late)).code).toBe('conflict');

    // The number is still pending, so it can be rescued with a fresh code rather than re-added.
    const list = await body<{ items: PhoneNumberWire[] }>(await app.request('/'));
    expect(list.items[0]?.status).toBe('pending');
  });

  it('hides another caller’s number behind 404 for every owned action', async () => {
    const me = await harness('PhoneOwnershipMe');
    const them = await harness('PhoneOwnershipThem');
    const theirs = await body<ChallengeWire>(
      await them.app.request('/', {
        method: 'POST',
        headers: J,
        body: JSON.stringify({ country: 'US', dialCode: '1', nationalNumber: '4155550111' }),
      }),
    );

    expect(
      (await me.app.request(`/${theirs.phoneNumber.id}/resend`, { method: 'POST' })).status,
    ).toBe(404);
    expect(
      (
        await me.app.request(`/${theirs.phoneNumber.id}/verify`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ code: CODE }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await me.app.request(`/${theirs.phoneNumber.id}/calling`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ enabled: false }),
        })
      ).status,
    ).toBe(404);
    expect((await me.app.request(`/${theirs.phoneNumber.id}`, { method: 'DELETE' })).status).toBe(
      404,
    );
  });
});

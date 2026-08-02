/**
 * Phone-number ownership is proven by a code that is actually delivered (ACH-14).
 *
 * @remarks
 * The failure these tests exist to prevent is the one this codebase already shipped once: a
 * verification code generated and stored but never sent, making verification impossible for any
 * real person. The first test therefore asserts on the *transport*, not on the database.
 */
import type * as DbModule from '@docket/db';
import { CaptureSmsSender } from '@docket/integrations';
import {
  PHONE_VERIFICATION_MAX_ATTEMPTS,
  PHONE_VERIFICATION_MAX_SENDS,
  PHONE_VERIFICATION_TTL_MS,
} from '@docket/types';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as PhoneVerificationModule from '../../src/routes/phone-verification';
import { getDb, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let PhoneVerificationService!: typeof PhoneVerificationModule.PhoneVerificationService;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  ({ PhoneVerificationService } = await import('../../src/routes/phone-verification'));
});

const CODE = '314159';

/** A clock the test moves by hand. */
function fixedClock(start: number): { now: () => Date; advance: (ms: number) => void } {
  let ms = start;
  return {
    now: () => new Date(ms),
    advance: (delta: number) => {
      ms += delta;
    },
  };
}

async function seedNumber(
  label: string,
  e164 = `+1415555${Math.floor(Math.random() * 9000) + 1000}`,
) {
  const userId = await seedUserWithHub(db, schema, label);
  const [row] = await db
    .insert(schema.phoneNumber)
    .values({
      userId,
      e164,
      dialCode: '1',
      country: 'US',
      nationalNumber: e164.slice(2),
      status: 'pending',
    })
    .returning();
  if (!row) throw new Error('failed to seed phone number');
  return { userId, row };
}

describe('phone verification', () => {
  it('actually texts the code to the number being verified', async () => {
    const sms = new CaptureSmsSender();
    const clock = fixedClock(Date.UTC(2026, 7, 2, 9, 0, 0));
    const service = new PhoneVerificationService({
      sms,
      now: clock.now,
      generateCode: () => CODE,
    });
    const { row } = await seedNumber('SmsDelivered');

    const result = await service.issueChallenge(row);

    expect(result.ok).toBe(true);
    expect(sms.outbox).toHaveLength(1);
    expect(sms.outbox[0]?.to).toBe(row.e164);
    expect(sms.outbox[0]?.body).toContain(CODE);
    // The code never appears in cleartext in the row that gates access.
    const [stored] = await db
      .select()
      .from(schema.phoneVerification)
      .where(eq(schema.phoneVerification.phoneNumberId, row.id));
    expect(stored?.codeHash).not.toContain(CODE);
  });

  it('leaves the number unverified until the correct code comes back', async () => {
    const sms = new CaptureSmsSender();
    const clock = fixedClock(Date.UTC(2026, 7, 2, 9, 0, 0));
    const service = new PhoneVerificationService({ sms, now: clock.now, generateCode: () => CODE });
    const { row } = await seedNumber('VerifyHappyPath');

    await service.issueChallenge(row);
    const [beforeVerify] = await db
      .select()
      .from(schema.phoneNumber)
      .where(eq(schema.phoneNumber.id, row.id));
    expect(beforeVerify?.status).toBe('pending');
    expect(beforeVerify?.verifiedAt).toBeNull();

    const wrong = await service.submit(row, '000000');
    expect(wrong).toMatchObject({ ok: false, refusal: 'wrong-code' });
    const [stillPending] = await db
      .select()
      .from(schema.phoneNumber)
      .where(eq(schema.phoneNumber.id, row.id));
    expect(stillPending?.status).toBe('pending');

    const right = await service.submit(row, CODE);
    expect(right.ok).toBe(true);
    const [verified] = await db
      .select()
      .from(schema.phoneNumber)
      .where(eq(schema.phoneNumber.id, row.id));
    expect(verified?.status).toBe('verified');
    expect(verified?.verifiedAt).not.toBeNull();
  });

  it('expires a code and refuses it afterwards', async () => {
    const sms = new CaptureSmsSender();
    const clock = fixedClock(Date.UTC(2026, 7, 2, 9, 0, 0));
    const service = new PhoneVerificationService({ sms, now: clock.now, generateCode: () => CODE });
    const { row } = await seedNumber('VerifyExpiry');

    await service.issueChallenge(row);
    clock.advance(PHONE_VERIFICATION_TTL_MS + 1);

    expect(await service.submit(row, CODE)).toMatchObject({ ok: false, refusal: 'expired' });
    const [still] = await db
      .select()
      .from(schema.phoneNumber)
      .where(eq(schema.phoneNumber.id, row.id));
    expect(still?.status).toBe('pending');
  });

  it('destroys the challenge once the attempt budget is spent', async () => {
    const sms = new CaptureSmsSender();
    const clock = fixedClock(Date.UTC(2026, 7, 2, 9, 0, 0));
    const service = new PhoneVerificationService({ sms, now: clock.now, generateCode: () => CODE });
    const { row } = await seedNumber('VerifyAttempts');

    await service.issueChallenge(row);
    for (let attempt = 1; attempt < PHONE_VERIFICATION_MAX_ATTEMPTS; attempt += 1) {
      const result = await service.submit(row, '111111');
      expect(result).toMatchObject({ ok: false, refusal: 'wrong-code' });
    }
    // The last wrong code exhausts the budget…
    expect(await service.submit(row, '111111')).toMatchObject({
      ok: false,
      refusal: 'wrong-code',
      attemptsRemaining: 0,
    });
    // …and the right code no longer helps, because the challenge is gone.
    expect(await service.submit(row, CODE)).toMatchObject({ ok: false, refusal: 'no-challenge' });
  });

  it('rate limits resends and then the hourly send budget', async () => {
    const sms = new CaptureSmsSender();
    const clock = fixedClock(Date.UTC(2026, 7, 2, 9, 0, 0));
    const service = new PhoneVerificationService({ sms, now: clock.now, generateCode: () => CODE });
    const { row } = await seedNumber('VerifyRateLimit');

    await service.issueChallenge(row);
    // Immediately again: refused, and no second message goes out.
    const tooSoon = await service.issueChallenge(row);
    expect(tooSoon).toMatchObject({ ok: false, refusal: 'resend-too-soon' });
    expect(sms.outbox).toHaveLength(1);

    // Space the remaining sends out; the budget is what stops them, not the interval.
    for (let sent = 1; sent < PHONE_VERIFICATION_MAX_SENDS; sent += 1) {
      clock.advance(61_000);
      expect((await service.issueChallenge(row)).ok).toBe(true);
    }
    expect(sms.outbox).toHaveLength(PHONE_VERIFICATION_MAX_SENDS);

    clock.advance(61_000);
    const capped = await service.issueChallenge(row);
    expect(capped).toMatchObject({ ok: false, refusal: 'send-limit-reached' });
    expect(sms.outbox).toHaveLength(PHONE_VERIFICATION_MAX_SENDS);
  });

  it('retires the previous code when a new one is sent', async () => {
    const sms = new CaptureSmsSender();
    const clock = fixedClock(Date.UTC(2026, 7, 2, 9, 0, 0));
    const codes = ['111111', '222222'];
    let index = 0;
    const service = new PhoneVerificationService({
      sms,
      now: clock.now,
      generateCode: () => codes[index++] ?? '999999',
    });
    const { row } = await seedNumber('VerifyResendRetires');

    await service.issueChallenge(row);
    clock.advance(61_000);
    await service.issueChallenge(row);

    expect(await service.submit(row, '111111')).toMatchObject({
      ok: false,
      refusal: 'wrong-code',
    });
    expect((await service.submit(row, '222222')).ok).toBe(true);
  });

  it('reports a delivery failure instead of leaving the person waiting', async () => {
    const clock = fixedClock(Date.UTC(2026, 7, 2, 9, 0, 0));
    const service = new PhoneVerificationService({
      sms: {
        send: () => Promise.reject(new Error('carrier refused the message')),
      },
      now: clock.now,
      generateCode: () => CODE,
    });
    const { row } = await seedNumber('VerifyDeliveryFailure');

    const result = await service.issueChallenge(row);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.challenge.deliveryFailed).toBe(true);
  });

  it('refuses to re-verify a number that is already verified', async () => {
    const sms = new CaptureSmsSender();
    const clock = fixedClock(Date.UTC(2026, 7, 2, 9, 0, 0));
    const service = new PhoneVerificationService({ sms, now: clock.now, generateCode: () => CODE });
    const { row } = await seedNumber('VerifyIdempotent');

    await service.issueChallenge(row);
    const verified = await service.submit(row, CODE);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    await expect(service.submit(verified.number, CODE)).rejects.toThrow();
  });
});

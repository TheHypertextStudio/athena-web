import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { CaptureTelephonyProvider } from '../../src/routes/twilio-telephony';
import type * as AuthorizationModule from '../../src/routes/phone-call-authorization';
import { getDb, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let authorization!: typeof AuthorizationModule;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  authorization = await import('../../src/routes/phone-call-authorization');
});

describe('phone callback authorization', () => {
  it('dials only the stored verified destination after the inbound leg ends', async () => {
    const userId = await seedUserWithHub(db, schema, 'CallbackDestination');
    const [number] = await db
      .insert(schema.phoneNumber)
      .values({
        userId,
        e164: '+14155550191',
        dialCode: '1',
        country: 'US',
        nationalNumber: '4155550191',
        status: 'verified',
        verifiedAt: new Date(),
        callingEnabled: true,
      })
      .returning();
    if (!number) throw new Error('failed to seed number');
    await authorization.createWeakInboundAuthorization(
      { userId, name: 'Ada', phoneNumberId: number.id, e164: number.e164 },
      'CA_inbound_destination',
      'TN-Validation-Passed-B',
      new Date('2026-08-30T12:00:00.000Z'),
    );
    const telephony = new CaptureTelephonyProvider();

    const started = await authorization.startCallbackForInboundCall(
      'CA_inbound_destination',
      telephony,
      new Date('2026-08-30T12:00:10.000Z'),
    );

    expect(started?.state).toBe('dialing');
    expect(started?.outboundCallSid).toBe(telephony.placedCallSids[0]);
    expect(telephony.callbacks).toHaveLength(1);
    expect(telephony.callbacks[0]?.to).toBe(number.e164);
    const [stored] = await db
      .select()
      .from(schema.phoneCallAuthorization)
      .where(eq(schema.phoneCallAuthorization.inboundCallSid, 'CA_inbound_destination'));
    expect(stored?.outboundCallSid).toBe(telephony.placedCallSids[0]);
  });

  it('allows only one active callback for a verified number', async () => {
    const userId = await seedUserWithHub(db, schema, 'CallbackSingleActive');
    const [number] = await db
      .insert(schema.phoneNumber)
      .values({
        userId,
        e164: '+14155550192',
        dialCode: '1',
        country: 'US',
        nationalNumber: '4155550192',
        status: 'verified',
        verifiedAt: new Date(),
        callingEnabled: true,
      })
      .returning();
    if (!number) throw new Error('failed to seed number');
    const caller = { userId, name: 'Ada', phoneNumberId: number.id, e164: number.e164 };
    const base = new Date('2026-08-30T13:00:00.000Z');
    await authorization.createWeakInboundAuthorization(caller, 'CA_active_1', undefined, base);
    await authorization.createWeakInboundAuthorization(caller, 'CA_active_2', undefined, base);
    const telephony = new CaptureTelephonyProvider();

    await authorization.startCallbackForInboundCall('CA_active_1', telephony, base);
    const second = await authorization.startCallbackForInboundCall('CA_active_2', telephony, base);

    expect(second).toMatchObject({ state: 'failed', failureReason: 'callback_already_active' });
    expect(telephony.callbacks).toHaveLength(1);
  });

  it('offers an authenticated Call me action after two consecutive failures', async () => {
    const userId = await seedUserWithHub(db, schema, 'CallbackCooldown');
    const [number] = await db
      .insert(schema.phoneNumber)
      .values({
        userId,
        e164: '+14155550193',
        dialCode: '1',
        country: 'US',
        nationalNumber: '4155550193',
        status: 'verified',
        verifiedAt: new Date(),
        callingEnabled: true,
      })
      .returning();
    if (!number) throw new Error('failed to seed number');
    const caller = { userId, name: 'Ada', phoneNumberId: number.id, e164: number.e164 };
    const first = await authorization.createWeakInboundAuthorization(
      caller,
      'CA_cooldown_1',
      undefined,
      new Date(),
    );
    await authorization.setAuthorizationState(first.id, 'failed', {
      failureReason: 'callback_no_answer',
    });
    await authorization.notifyCallbackCooldownAfterFailure(first.id);
    const second = await authorization.createWeakInboundAuthorization(
      caller,
      'CA_cooldown_2',
      undefined,
      new Date(),
    );
    await authorization.setAuthorizationState(second.id, 'failed', {
      failureReason: 'callback_no_answer',
    });
    await authorization.notifyCallbackCooldownAfterFailure(second.id);

    const notices = await db
      .select()
      .from(schema.notification)
      .where(eq(schema.notification.id, `phone_callback_cooldown_${second.id}`));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.body).toMatchObject({
      action: 'call_me',
      phoneNumberId: number.id,
    });
  });
});

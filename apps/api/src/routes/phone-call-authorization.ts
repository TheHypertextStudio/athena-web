/** Durable callback authorization for Athena telephone access. */
import { db, notification, phoneCallAuthorization, phoneNumber } from '@docket/db';
import type { PhoneCallAuthorizationState } from '@docket/db';
import { apiHosts, requireEnvOrigin } from '@docket/env/api';
import { and, desc, eq, gt, inArray, isNotNull, ne } from 'drizzle-orm';

import { hasSqlState } from '../lib/sql-state';
import type { ResolvedCaller } from './phone-directory';
import type { TelephonyProvider } from './twilio-telephony';

/** A callback authorization remains usable for five minutes. */
export const CALLBACK_AUTHORIZATION_TTL_MS = 5 * 60 * 1000;
/** Minimum delay between callbacks to one verified number. */
export const CALLBACK_MINIMUM_GAP_MS = 60 * 1000;
/** Maximum callbacks to one verified number in a rolling hour. */
export const CALLBACK_MAX_PER_HOUR = 5;
/** Automatic-callback cooldown after two consecutive failures. */
export const CALLBACK_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;

/** Stored callback authorization row. */
export type PhoneCallAuthorizationRow = typeof phoneCallAuthorization.$inferSelect;

/** Create or load the authorization for one weakly attested inbound call. */
export async function createWeakInboundAuthorization(
  caller: ResolvedCaller,
  inboundCallSid: string,
  stirVerification: string | undefined,
  now: Date,
): Promise<PhoneCallAuthorizationRow> {
  const existing = await authorizationByInboundSid(inboundCallSid);
  if (existing) return existing;
  const [created] = await db
    .insert(phoneCallAuthorization)
    .values({
      userId: caller.userId,
      phoneNumberId: caller.phoneNumberId,
      destinationE164: caller.e164,
      source: 'weak_inbound',
      state: 'awaiting_hangup',
      inboundCallSid,
      stirVerification: stirVerification ?? null,
      expiresAt: new Date(now.getTime() + CALLBACK_AUTHORIZATION_TTL_MS),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: phoneCallAuthorization.inboundCallSid })
    .returning();
  if (created) return created;
  const raced = await authorizationByInboundSid(inboundCallSid);
  if (!raced) throw new Error('phone callback authorization insert returned no row');
  return raced;
}

/** Create a callback authorization from an authenticated Docket action. */
export async function createDocketCallbackAuthorization(
  number: typeof phoneNumber.$inferSelect,
  now: Date = new Date(),
): Promise<PhoneCallAuthorizationRow> {
  const [created] = await db
    .insert(phoneCallAuthorization)
    .values({
      userId: number.userId,
      phoneNumberId: number.id,
      destinationE164: number.e164,
      source: 'docket',
      state: 'awaiting_hangup',
      expiresAt: new Date(now.getTime() + CALLBACK_AUTHORIZATION_TTL_MS),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) throw new Error('phone callback authorization insert returned no row');
  return created;
}

/** Load an authorization by the inbound provider call identifier. */
export async function authorizationByInboundSid(
  inboundCallSid: string,
): Promise<PhoneCallAuthorizationRow | null> {
  const rows = await db
    .select()
    .from(phoneCallAuthorization)
    .where(eq(phoneCallAuthorization.inboundCallSid, inboundCallSid))
    .limit(1);
  return rows[0] ?? null;
}

/** Load one callback authorization by its opaque Docket id. */
export async function authorizationById(id: string): Promise<PhoneCallAuthorizationRow | null> {
  const rows = await db
    .select()
    .from(phoneCallAuthorization)
    .where(eq(phoneCallAuthorization.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Load an authorization by its outbound provider call identifier. */
export async function authorizationByOutboundSid(
  outboundCallSid: string,
): Promise<PhoneCallAuthorizationRow | null> {
  const rows = await db
    .select()
    .from(phoneCallAuthorization)
    .where(eq(phoneCallAuthorization.outboundCallSid, outboundCallSid))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Start the callback after Twilio reports that the inbound leg ended.
 *
 * The destination comes only from the durable authorization created from the verified binding.
 * No inbound status parameter can replace it.
 */
export async function startCallbackForInboundCall(
  inboundCallSid: string,
  telephony: TelephonyProvider,
  now: Date = new Date(),
): Promise<PhoneCallAuthorizationRow | null> {
  const authorization = await authorizationByInboundSid(inboundCallSid);
  if (!authorization) return null;
  return await startCallbackAuthorizationRow(authorization, telephony, now);
}

/** Start a Docket-created callback authorization immediately. */
export async function startCallbackAuthorization(
  authorizationId: string,
  telephony: TelephonyProvider,
  now: Date = new Date(),
): Promise<PhoneCallAuthorizationRow | null> {
  const authorization = await authorizationById(authorizationId);
  if (!authorization) return null;
  return await startCallbackAuthorizationRow(authorization, telephony, now);
}

async function startCallbackAuthorizationRow(
  authorization: PhoneCallAuthorizationRow,
  telephony: TelephonyProvider,
  now: Date,
): Promise<PhoneCallAuthorizationRow | null> {
  if (authorization.outboundCallSid) return authorization;
  if (authorization.state !== 'awaiting_hangup') return authorization;
  if (authorization.expiresAt.getTime() <= now.getTime()) {
    return await updateAuthorization(authorization.id, {
      state: 'expired',
      failureReason: 'authorization_expired',
      updatedAt: now,
    });
  }
  if (!authorization.phoneNumberId) {
    return await updateAuthorization(authorization.id, {
      state: 'canceled',
      failureReason: 'phone_access_revoked',
      updatedAt: now,
    });
  }
  const [number] = await db
    .select({ id: phoneNumber.id, e164: phoneNumber.e164 })
    .from(phoneNumber)
    .where(
      and(
        eq(phoneNumber.id, authorization.phoneNumberId),
        eq(phoneNumber.userId, authorization.userId),
        eq(phoneNumber.status, 'verified'),
        eq(phoneNumber.callingEnabled, true),
      ),
    )
    .limit(1);
  if (number?.e164 !== authorization.destinationE164) {
    return await updateAuthorization(authorization.id, {
      state: 'canceled',
      failureReason: 'phone_access_revoked',
      updatedAt: now,
    });
  }

  const active = await db
    .select({ id: phoneCallAuthorization.id })
    .from(phoneCallAuthorization)
    .where(
      and(
        eq(phoneCallAuthorization.destinationE164, authorization.destinationE164),
        ne(phoneCallAuthorization.id, authorization.id),
        inArray(phoneCallAuthorization.state, [
          'dialing',
          'awaiting_digit',
          'authorized',
          'connected',
        ]),
      ),
    )
    .limit(1);
  if (active[0]) {
    return await updateAuthorization(authorization.id, {
      state: 'failed',
      failureReason: 'callback_already_active',
      updatedAt: now,
    });
  }

  const recent = await db
    .select({
      state: phoneCallAuthorization.state,
      outboundStartedAt: phoneCallAuthorization.outboundStartedAt,
      updatedAt: phoneCallAuthorization.updatedAt,
    })
    .from(phoneCallAuthorization)
    .where(
      and(
        eq(phoneCallAuthorization.destinationE164, authorization.destinationE164),
        isNotNull(phoneCallAuthorization.outboundStartedAt),
        gt(phoneCallAuthorization.outboundStartedAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(phoneCallAuthorization.outboundStartedAt));
  if (recent.length >= CALLBACK_MAX_PER_HOUR) {
    return await updateAuthorization(authorization.id, {
      state: 'failed',
      failureReason: 'callback_hourly_limit',
      updatedAt: now,
    });
  }
  const latest = recent[0];
  if (
    latest?.outboundStartedAt &&
    now.getTime() - latest.outboundStartedAt.getTime() < CALLBACK_MINIMUM_GAP_MS
  ) {
    return await updateAuthorization(authorization.id, {
      state: 'failed',
      failureReason: 'callback_too_soon',
      updatedAt: now,
    });
  }
  if (
    authorization.source === 'weak_inbound' &&
    recent[0]?.state === 'failed' &&
    recent[1]?.state === 'failed' &&
    now.getTime() - recent[0].updatedAt.getTime() < CALLBACK_FAILURE_COOLDOWN_MS
  ) {
    return await updateAuthorization(authorization.id, {
      state: 'failed',
      failureReason: 'callback_failure_cooldown',
      updatedAt: now,
    });
  }

  try {
    await updateAuthorization(authorization.id, {
      state: 'dialing',
      outboundStartedAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (!hasSqlState(error, '23505')) throw error;
    return await updateAuthorization(authorization.id, {
      state: 'failed',
      failureReason: 'callback_already_active',
      updatedAt: now,
    });
  }
  const origin = requireEnvOrigin(apiHosts.api, 'API_URL');
  try {
    const outboundCallSid = await telephony.placeCallback({
      to: authorization.destinationE164,
      answerUrl: `${origin}/internal/telephony/twilio/callback/${authorization.id}/answer`,
      statusCallbackUrl: `${origin}/internal/telephony/twilio/status`,
    });
    return await updateAuthorization(authorization.id, {
      state: 'dialing',
      outboundCallSid,
      updatedAt: now,
    });
  } catch {
    return await updateAuthorization(authorization.id, {
      state: 'failed',
      failureReason: 'provider_unavailable',
      updatedAt: now,
    });
  }
}

/** Move one authorization to a terminal or active state. */
export async function setAuthorizationState(
  id: string,
  state: PhoneCallAuthorizationState,
  values: Partial<
    Pick<PhoneCallAuthorizationRow, 'failureReason' | 'outboundCallSid' | 'authorizedAt'>
  > = {},
): Promise<PhoneCallAuthorizationRow | null> {
  const [updated] = await db
    .update(phoneCallAuthorization)
    .set({ state, ...values, updatedAt: new Date() })
    .where(eq(phoneCallAuthorization.id, id))
    .returning();
  return updated ?? null;
}

/** Atomically let one signed digit webhook claim an outbound call for authorization. */
export async function claimCallbackAuthorization(
  id: string,
  outboundCallSid: string,
  now: Date,
): Promise<PhoneCallAuthorizationRow | null> {
  const [claimed] = await db
    .update(phoneCallAuthorization)
    .set({ state: 'authorized', authorizedAt: now, updatedAt: now })
    .where(
      and(
        eq(phoneCallAuthorization.id, id),
        eq(phoneCallAuthorization.outboundCallSid, outboundCallSid),
        inArray(phoneCallAuthorization.state, ['dialing', 'awaiting_digit']),
        gt(phoneCallAuthorization.expiresAt, now),
      ),
    )
    .returning();
  return claimed ?? null;
}

/** Notify the account after the second consecutive provider or answer failure. */
export async function notifyCallbackCooldownAfterFailure(authorizationId: string): Promise<void> {
  const current = await authorizationById(authorizationId);
  if (current?.source !== 'weak_inbound' || current.state !== 'failed' || !current.phoneNumberId) {
    return;
  }
  const previous = await db
    .select({ id: phoneCallAuthorization.id })
    .from(phoneCallAuthorization)
    .where(
      and(
        eq(phoneCallAuthorization.destinationE164, current.destinationE164),
        ne(phoneCallAuthorization.id, current.id),
        eq(phoneCallAuthorization.state, 'failed'),
      ),
    )
    .orderBy(desc(phoneCallAuthorization.updatedAt))
    .limit(1);
  if (!previous[0]) return;

  await db
    .insert(notification)
    .values({
      id: `phone_callback_cooldown_${current.id}`,
      userId: current.userId,
      type: 'phone_call',
      body: {
        title: 'Athena paused automatic callbacks',
        summary: 'Two callbacks did not connect. Automatic callbacks are paused for 15 minutes.',
        url: '/settings/athena',
        action: 'call_me',
        phoneNumberId: current.phoneNumberId,
      },
    })
    .onConflictDoNothing({ target: notification.id });
}

async function updateAuthorization(
  id: string,
  values: Partial<typeof phoneCallAuthorization.$inferInsert>,
): Promise<PhoneCallAuthorizationRow | null> {
  const [updated] = await db
    .update(phoneCallAuthorization)
    .set(values)
    .where(eq(phoneCallAuthorization.id, id))
    .returning();
  return updated ?? null;
}

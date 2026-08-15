/**
 * `@docket/api` — the caller-owned phone numbers surface, mounted at `/v1/me/phone-numbers`.
 *
 * @remarks
 * Distinct from `/v1/me/contact-points`, and deliberately so. A contact point is a *destination*
 * Docket sends notifications to; a phone number here is an *identity* Docket accepts calls from.
 * Merging them would mean that adding a number for SMS alerts silently also authorized anyone
 * holding that handset to open the owner's Athena conversation — a capability nobody asked for
 * by ticking "text me".
 *
 * Every response is redacted: {@link PhoneNumberOut} carries the dial code and the last two
 * digits, never the national number. A read of this endpoint is not a directory.
 */
import { db, phoneNumber } from '@docket/db';
import {
  composeE164,
  DIAL_CODES,
  maskE164,
  PhoneChallengeOut,
  PhoneNumberCreate,
  PhoneNumberListOut,
  PhoneNumberOut,
  PhoneVerifyBody,
} from '@docket/athena/phone';
import type { PhoneChallengeSummary } from '@docket/athena/phone';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, ConflictError, NotFoundError, ValidationError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';

import {
  attemptsRemaining,
  outstandingChallenge,
  resendAvailableAt,
  type PhoneNumberRow,
  type PhoneVerificationRow,
  type PhoneVerificationService,
} from './phone-verification';

const idParam = z.object({ id: z.string() });

/** Every dial code the country selector offers, as the server's allowlist. */
const DIAL_CODE_BY_COUNTRY = new Map(DIAL_CODES.map((d) => [d.iso2, d.dialCode]));

/**
 * Project a stored binding onto the redacted wire shape.
 *
 * @param row - The stored binding.
 * @param challenge - The number's outstanding challenge, when one is being reported. Passing it is
 *   what lets a client reopen a half-finished verification it did not itself start: the limits ride
 *   on the number rather than only on the response to the request that issued the code.
 * @returns the redacted number, with its live challenge limits when there are any.
 */
function toPhoneNumberOut(
  row: PhoneNumberRow,
  challenge: PhoneVerificationRow | null = null,
): z.input<typeof PhoneNumberOut> {
  return {
    id: row.id,
    masked: maskE164(row.e164, row.dialCode),
    dialCode: row.dialCode,
    country: row.country,
    status: row.status,
    callingEnabled: row.callingEnabled,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    challenge: challenge ? toChallengeSummary(challenge) : null,
  };
}

/** Project an outstanding challenge onto the limits a person is entitled to see. */
function toChallengeSummary(
  challenge: PhoneVerificationRow,
): z.input<typeof PhoneChallengeSummary> {
  return {
    expiresAt: challenge.expiresAt.toISOString(),
    attemptsRemaining: attemptsRemaining(challenge),
    resendAvailableAt: resendAvailableAt(challenge, challenge.createdAt).toISOString(),
    deliveryFailed: challenge.deliveryFailed,
  };
}

/**
 * Build the caller-owned phone number routes.
 *
 * @param createVerification - Builds the one-time-code service from the app container. A factory,
 *   not a resolved instance: the container's SMS transport is lazy, and no route here runs at
 *   startup, so resolving it eagerly would force SMS configuration to exist just to boot the API.
 *   Called fresh inside each handler that needs it, matching {@link PhoneVerificationService}'s own
 *   per-request contract.
 * @returns the Hono sub-app mounted at `/v1/me/phone-numbers`.
 */
export function createPhoneNumberRoutes(createVerification: () => PhoneVerificationService) {
  return new Hono<AppEnv>()
    .get(
      '/',
      apiDoc({
        tag: 'Me Phone',
        summary: 'List bound phone numbers',
        response: PhoneNumberListOut,
        description:
          'List the phone numbers bound to the account, always redacted. A number still awaiting its code carries that code’s remaining lifetime, tries, and resend time, so a half-finished verification can be resumed from any session.',
      }),
      async (c) => {
        const userId = requireUserId(c);
        const rows = await db
          .select()
          .from(phoneNumber)
          .where(eq(phoneNumber.userId, userId))
          .orderBy(desc(phoneNumber.createdAt));

        // Read the challenges directly rather than through `createVerification()`: building the
        // service resolves the container's SMS transport, which throws outside local mode when no
        // SMS credentials are configured, and listing your own numbers must not depend on the
        // ability to send. Only a pending row can have one, and a person holds a handful of
        // numbers — a couple of point lookups, not a fan-out worth batching.
        const items = await Promise.all(
          rows.map(async (row) =>
            toPhoneNumberOut(
              row,
              row.status === 'pending' ? await outstandingChallenge(row.id) : null,
            ),
          ),
        );
        return ok(c, PhoneNumberListOut, { items });
      },
    )
    .post(
      '/',
      apiDoc({
        tag: 'Me Phone',
        summary: 'Bind a phone number and send its verification code',
        response: PhoneChallengeOut,
        description:
          'Record a phone number as pending and text a one-time code to it. The number cannot be used until the code comes back.',
      }),
      zJson(PhoneNumberCreate),
      async (c) => {
        const userId = requireUserId(c);
        const input = c.req.valid('json');
        const expectedDialCode = DIAL_CODE_BY_COUNTRY.get(input.country.toUpperCase());
        if (!expectedDialCode || expectedDialCode !== input.dialCode.replace(/\D/g, '')) {
          throw new ValidationError([
            { message: 'Choose a country from the list.', path: ['country'] },
          ]);
        }
        const e164 = composeE164(input.dialCode, input.nationalNumber);
        if (!e164) {
          throw new ValidationError([
            { message: 'Enter a valid phone number.', path: ['nationalNumber'] },
          ]);
        }

        const existing = await loadByValue(userId, e164);
        if (existing?.status === 'verified') {
          throw new ConflictError('This number is already verified on your account.');
        }
        if (existing?.status === 'blocked') {
          throw new ConflictError('This number cannot be used.');
        }

        const row =
          existing ??
          (
            await db
              .insert(phoneNumber)
              .values({
                userId,
                e164,
                dialCode: input.dialCode.replace(/\D/g, ''),
                country: input.country.toUpperCase(),
                nationalNumber: input.nationalNumber.replace(/\D/g, ''),
                status: 'pending',
              })
              .returning()
          )[0];
        if (!row) throw new Error('phone number insert returned no row');

        return ok(c, PhoneChallengeOut, await issue(createVerification(), row));
      },
    )
    .post(
      '/:id/resend',
      apiDoc({
        tag: 'Me Phone',
        summary: 'Send another verification code',
        response: PhoneChallengeOut,
        description:
          'Retire the outstanding code and text a fresh one. Rate limited per number; the response states when another send is allowed.',
      }),
      zParam(idParam),
      async (c) => {
        const userId = requireUserId(c);
        const row = await requireOwned(userId, c.req.valid('param').id);
        if (row.status !== 'pending') {
          throw new ConflictError('This number is not awaiting verification.');
        }
        return ok(c, PhoneChallengeOut, await issue(createVerification(), row));
      },
    )
    .post(
      '/:id/verify',
      apiDoc({
        tag: 'Me Phone',
        summary: 'Verify a phone number with its one-time code',
        response: PhoneNumberOut,
        description:
          'Prove ownership of a pending number. Wrong codes are counted and the challenge is destroyed once the attempt budget is spent.',
      }),
      zParam(idParam),
      zJson(PhoneVerifyBody),
      async (c) => {
        const userId = requireUserId(c);
        const row = await requireOwned(userId, c.req.valid('param').id);
        const result = await createVerification().submit(row, c.req.valid('json').code);
        if (!result.ok) throw refusalToError(result.refusal, result.attemptsRemaining);
        return ok(c, PhoneNumberOut, toPhoneNumberOut(result.number));
      },
    )
    .post(
      '/:id/calling',
      apiDoc({
        tag: 'Me Phone',
        summary: 'Turn calling on or off for a verified number',
        response: PhoneNumberOut,
        description:
          'Pause or resume Athena answering calls from this number without discarding the proof of ownership.',
      }),
      zParam(idParam),
      zJson(z.object({ enabled: z.boolean() })),
      async (c) => {
        const userId = requireUserId(c);
        const row = await requireOwned(userId, c.req.valid('param').id);
        if (row.status !== 'verified') {
          throw new ConflictError('Verify this number before turning calling on.');
        }
        const [updated] = await db
          .update(phoneNumber)
          .set({ callingEnabled: c.req.valid('json').enabled })
          .where(eq(phoneNumber.id, row.id))
          .returning();
        if (!updated) throw new NotFoundError('Phone number not found');
        return ok(c, PhoneNumberOut, toPhoneNumberOut(updated));
      },
    )
    .delete(
      '/:id',
      apiDoc({
        tag: 'Me Phone',
        summary: 'Remove a phone number',
        response: PhoneNumberOut,
        description:
          'Unbind a number from the account. Calls from it stop reaching Athena immediately.',
      }),
      zParam(idParam),
      async (c) => {
        const userId = requireUserId(c);
        const row = await requireOwned(userId, c.req.valid('param').id);
        // Read before deleting: the response describes the number as it stood at the moment of the
        // call, and a pending number discarded mid-verification did have a code awaiting entry.
        const challenge = row.status === 'pending' ? await outstandingChallenge(row.id) : null;
        await db.delete(phoneNumber).where(eq(phoneNumber.id, row.id));
        return ok(c, PhoneNumberOut, toPhoneNumberOut(row, challenge));
      },
    );
}

/** Issue a challenge and project it, or translate the limit that refused it. */
async function issue(
  verification: PhoneVerificationService,
  row: PhoneNumberRow,
): Promise<z.input<typeof PhoneChallengeOut>> {
  const result = await verification.issueChallenge(row);
  if (!result.ok) {
    throw new ConflictError(
      result.refusal === 'resend-too-soon'
        ? 'A code was just sent. Wait a moment before asking for another.'
        : 'Too many codes have been sent to this number. Try again later.',
    );
  }
  // The same limits ride on the embedded number too, so a client can treat a just-issued challenge
  // and one it read back from the list as the same shape rather than special-casing the fresh one.
  return {
    phoneNumber: toPhoneNumberOut(row, result.challenge),
    ...toChallengeSummary(result.challenge),
  };
}

/**
 * Translate a verification refusal into the error the surface renders.
 *
 * @remarks
 * Application-owned copy, chosen per refusal so a person is told the actual next step rather than
 * "invalid". `wrong-code` names the remaining budget because silently burning attempts and then
 * failing with the same sentence is how people end up locked out without warning.
 */
function refusalToError(
  refusal: 'no-challenge' | 'expired' | 'attempts-exhausted' | 'wrong-code',
  remaining: number,
): ConflictError {
  switch (refusal) {
    case 'no-challenge':
      return new ConflictError('Ask for a new code, then enter it here.');
    case 'expired':
      return new ConflictError('That code has expired. Ask for a new one.');
    case 'attempts-exhausted':
      return new ConflictError('Too many incorrect codes. Ask for a new one.');
    case 'wrong-code':
      return new ConflictError(
        remaining === 1
          ? 'That code is not right. One more try before you need a new code.'
          : `That code is not right. ${String(remaining)} tries left.`,
      );
  }
}

async function loadByValue(userId: string, e164: string): Promise<PhoneNumberRow | null> {
  const rows = await db
    .select()
    .from(phoneNumber)
    .where(and(eq(phoneNumber.userId, userId), eq(phoneNumber.e164, e164)))
    .limit(1);
  return rows[0] ?? null;
}

async function requireOwned(userId: string, id: string): Promise<PhoneNumberRow> {
  const rows = await db
    .select()
    .from(phoneNumber)
    .where(and(eq(phoneNumber.id, id), eq(phoneNumber.userId, userId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Phone number not found');
  return rows[0];
}

function requireUserId(c: Context<AppEnv>): string {
  const userId = c.get('session')?.user.id;
  if (!userId) throw new AuthError('Authentication required.');
  return userId;
}

export default createPhoneNumberRoutes;

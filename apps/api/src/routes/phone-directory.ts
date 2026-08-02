/**
 * `@docket/api` — turning a caller id into an account, or into nobody.
 *
 * @remarks
 * This is the security boundary of the phone channel and it is deliberately one equality read.
 * The number that arrives on an inbound call is matched against `phone_number` rows that are
 * BOTH `verified` AND `callingEnabled`; anything else — pending, blocked, paused, unknown,
 * withheld — resolves to `null`, and a `null` resolution can neither read nor append to any
 * person's conversation because the caller never obtains a user id to scope a query with.
 *
 * There is no fuzzy matching, no "last 7 digits" fallback, and no lookup by the number the caller
 * *claims* to be. Caller id is spoofable, which is exactly why the match must be exact and why
 * the surface never treats a phone call as sufficient authority for a destructive action.
 */
import { db, phoneNumber, user } from '@docket/db';
import { and, eq } from 'drizzle-orm';

/** A caller whose number is bound to an account. */
export interface ResolvedCaller {
  /** The account the verified number belongs to. */
  readonly userId: string;
  /** The person's display name, for the greeting. */
  readonly name: string;
  /** The matched binding. */
  readonly phoneNumberId: string;
  /** The normalized number that matched. */
  readonly e164: string;
}

/**
 * Why an inbound number did not resolve to an account.
 *
 * @remarks
 * Stable codes rather than sentences, and deliberately coarse: the announcement a caller hears
 * must not reveal whether a number is unknown, merely unverified, or blocked, because that turns
 * the phone line into an oracle for testing whether a number belongs to a Docket customer.
 * The distinction exists only for our own logs and metrics.
 */
export type CallerRefusal = 'no-caller-id' | 'unrecognized';

/** The outcome of a caller-id lookup. */
export type CallerResolution =
  | { readonly ok: true; readonly caller: ResolvedCaller }
  | { readonly ok: false; readonly refusal: CallerRefusal };

/**
 * Normalize a caller id as delivered by a telephony provider.
 *
 * @remarks
 * Providers deliver E.164 for PSTN calls, but also deliver `anonymous`, an empty string, or a SIP
 * URI, and some deliver a number with a stray space. Anything that is not unambiguously E.164
 * after stripping separators is treated as absent rather than guessed at.
 *
 * @param raw - The `From` field exactly as the provider sent it.
 * @returns the normalized E.164 number, or `null` when there is no usable caller id.
 */
export function normalizeCallerId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // `sip:+14155550123@example.com` — take the user part before deciding.
  const sip = /^sips?:([^@]+)@/i.exec(trimmed);
  const candidate = (sip?.[1] ?? trimmed).replace(/[\s().-]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(candidate)) return null;
  return candidate;
}

/**
 * Resolve an inbound caller id to the one account that proved it owns the number.
 *
 * @remarks
 * The `verified` + `callingEnabled` pair is applied in SQL, not in JavaScript, so there is no
 * shape of this function in which a row is fetched and then conditionally trusted. The partial
 * unique index `phone_number_verified_unique_idx` guarantees at most one row comes back.
 *
 * @param raw - The provider's `From` field.
 * @returns the resolved caller, or the refusal code explaining why not.
 */
export async function resolveCaller(raw: string | undefined | null): Promise<CallerResolution> {
  const e164 = normalizeCallerId(raw);
  if (!e164) return { ok: false, refusal: 'no-caller-id' };

  const rows = await db
    .select({
      userId: phoneNumber.userId,
      phoneNumberId: phoneNumber.id,
      e164: phoneNumber.e164,
      name: user.name,
    })
    .from(phoneNumber)
    .innerJoin(user, eq(user.id, phoneNumber.userId))
    .where(
      and(
        eq(phoneNumber.e164, e164),
        eq(phoneNumber.status, 'verified'),
        eq(phoneNumber.callingEnabled, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return { ok: false, refusal: 'unrecognized' };
  return {
    ok: true,
    caller: {
      userId: row.userId,
      name: row.name,
      phoneNumberId: row.phoneNumberId,
      e164: row.e164,
    },
  };
}

/** Stamp the moment a verified number last reached Athena, so a stale binding is visible. */
export async function recordCallFrom(phoneNumberId: string, at: Date): Promise<void> {
  await db.update(phoneNumber).set({ lastCalledAt: at }).where(eq(phoneNumber.id, phoneNumberId));
}

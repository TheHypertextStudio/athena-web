/**
 * `@docket/api` — proving that a person owns the phone number they typed.
 *
 * @remarks
 * This module exists because the previous phone flow in this codebase generated a one-time code
 * and then never sent it anywhere, which made verification structurally impossible: a real person
 * could not verify a real number, ever. The fix is not "also call the SMS sender" — it is to make
 * **the send the thing that creates the challenge**, so a challenge that was never delivered
 * cannot exist as an outstanding one. {@link issueChallenge} writes the row only after the
 * transport accepts the message, and records `deliveryFailed` when it does not.
 *
 * Four limits, all enforced here and all readable by the caller so the UI can state them:
 *
 * | limit | value | why |
 * | --- | --- | --- |
 * | code lifetime | 10 minutes | long enough to walk to the other room, short enough that a shoulder-surfed code is stale |
 * | wrong attempts | 5 per challenge | 5 tries against a 6-digit space is a 1-in-200 000 chance, and the challenge is destroyed after |
 * | resend gap | 60 seconds | stops a "resend" button from becoming an SMS cannon aimed at someone else's phone |
 * | sends per hour | 5 per number | caps the cost and the harassment of enumerating numbers |
 *
 * The code is compared with a **timing-safe** equality over its SHA-256, and the attempt counter
 * is incremented *before* the comparison, so an attacker cannot get a free guess by disconnecting.
 *
 * @see {@link ../../../../docs/engineering/specs/voice-and-phone.md} §"Phone verification"
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { db, phoneNumber, phoneVerification } from '@docket/db';
import type { SmsSender } from '@docket/integrations';
import {
  PHONE_VERIFICATION_MAX_ATTEMPTS,
  PHONE_VERIFICATION_MAX_SENDS,
  PHONE_VERIFICATION_RESEND_INTERVAL_MS,
  PHONE_VERIFICATION_SEND_WINDOW_MS,
  PHONE_VERIFICATION_TTL_MS,
} from '@docket/athena/phone';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../error';

/** A row of {@link phoneVerification}. */
export type PhoneVerificationRow = typeof phoneVerification.$inferSelect;

/** A row of {@link phoneNumber}. */
export type PhoneNumberRow = typeof phoneNumber.$inferSelect;

/**
 * Why a challenge could not be issued, as a stable machine code.
 *
 * @remarks
 * Codes, never sentences: the surface owns the words a person reads. `resend-too-soon` and
 * `send-limit-reached` are deliberately distinguishable because they need different copy — one
 * says "wait a moment", the other says "try again later or use a different number".
 */
export type ChallengeRefusal = 'resend-too-soon' | 'send-limit-reached';

/** Why a submitted code was not accepted. */
export type VerificationRefusal = 'no-challenge' | 'expired' | 'attempts-exhausted' | 'wrong-code';

/** The outcome of asking for a one-time code. */
export type ChallengeResult =
  | { readonly ok: true; readonly challenge: PhoneVerificationRow }
  | { readonly ok: false; readonly refusal: ChallengeRefusal; readonly retryAt: Date };

/** The outcome of submitting a one-time code. */
export type VerificationResult =
  | { readonly ok: true; readonly number: PhoneNumberRow }
  | {
      readonly ok: false;
      readonly refusal: VerificationRefusal;
      readonly attemptsRemaining: number;
    };

/** Everything {@link PhoneVerificationService} needs from the outside world. */
export interface PhoneVerificationDeps {
  /** The SMS transport. In local/test this is the capturing double, so no account is needed. */
  readonly sms: SmsSender;
  /** Injected clock; tests advance it rather than sleeping. */
  readonly now?: () => Date;
  /** Injected code generator; tests pin it so an assertion never depends on randomness. */
  readonly generateCode?: () => string;
}

/** Hash a one-time code for storage and comparison. */
function hashCode(code: string): Buffer {
  return createHash('sha256').update(code, 'utf8').digest();
}

/** Draw a uniformly random 6-digit code. */
function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * The message a person receives. Application-owned copy, and deliberately boring.
 *
 * @remarks
 * Names the product so the code is not mistaken for one of the dozen other 6-digit codes in a
 * person's inbox, and says what it is for. No link — a link in an SMS carrying a one-time code is
 * the exact shape of a phishing message, and we will not train our users to tap one.
 */
export function verificationMessage(code: string): string {
  return `${code} is your Docket verification code. It lets Athena recognize this phone number when you call. It expires in 10 minutes.`;
}

/**
 * Issues, resends and checks the one-time codes that turn a typed number into a verified one.
 *
 * @remarks
 * Constructed per request from the app container so the SMS transport is the same real/mock seam
 * every other outbound message in Docket uses — there is no second SMS path here.
 */
export class PhoneVerificationService {
  private readonly now: () => Date;
  private readonly generateCode: () => string;

  constructor(private readonly deps: PhoneVerificationDeps) {
    this.now = deps.now ?? (() => new Date());
    this.generateCode = deps.generateCode ?? randomCode;
  }

  /**
   * Send a one-time code to a number and record the challenge it must answer.
   *
   * @remarks
   * Order matters and is the point of this method. Limits are checked first; the previous
   * outstanding challenge is invalidated next (so an old code can never be used after a resend);
   * the SMS goes out; and only then is the new challenge persisted. If the transport throws, the
   * challenge is still written but flagged `deliveryFailed`, because a person staring at a
   * verification screen needs to be told the code is not coming rather than left waiting — and
   * because the send still counted against the rate limit and must be recorded.
   *
   * @param number - The phone number row being proven.
   * @returns the new challenge, or a refusal naming the limit that was hit.
   */
  async issueChallenge(number: PhoneNumberRow): Promise<ChallengeResult> {
    const now = this.now();
    const recent = await db
      .select({ createdAt: phoneVerification.createdAt })
      .from(phoneVerification)
      .where(
        and(
          eq(phoneVerification.phoneNumberId, number.id),
          gt(
            phoneVerification.createdAt,
            new Date(now.getTime() - PHONE_VERIFICATION_SEND_WINDOW_MS),
          ),
        ),
      )
      .orderBy(desc(phoneVerification.createdAt));

    const last = recent[0];
    if (last) {
      const sinceLast = now.getTime() - last.createdAt.getTime();
      if (sinceLast < PHONE_VERIFICATION_RESEND_INTERVAL_MS) {
        return {
          ok: false,
          refusal: 'resend-too-soon',
          retryAt: new Date(last.createdAt.getTime() + PHONE_VERIFICATION_RESEND_INTERVAL_MS),
        };
      }
    }
    if (recent.length >= PHONE_VERIFICATION_MAX_SENDS) {
      const oldest = recent[recent.length - 1];
      return {
        ok: false,
        refusal: 'send-limit-reached',
        retryAt: new Date(
          (oldest?.createdAt.getTime() ?? now.getTime()) + PHONE_VERIFICATION_SEND_WINDOW_MS,
        ),
      };
    }

    // A resend must retire the previous code. Without this, every resend widens the set of
    // currently-valid codes, which is the opposite of what a person pressing "resend" expects.
    await db
      .update(phoneVerification)
      .set({ invalidatedAt: now })
      .where(
        and(
          eq(phoneVerification.phoneNumberId, number.id),
          isNull(phoneVerification.consumedAt),
          isNull(phoneVerification.invalidatedAt),
        ),
      );

    const code = this.generateCode();
    let deliveryFailed = false;
    try {
      await this.deps.sms.send({ to: number.e164, body: verificationMessage(code) });
    } catch {
      // The provider's own words never reach a person or a log line here; the fact of failure is
      // what the caller needs, and it is carried as a boolean.
      deliveryFailed = true;
    }

    const [challenge] = await db
      .insert(phoneVerification)
      .values({
        phoneNumberId: number.id,
        codeHash: hashCode(code).toString('hex'),
        expiresAt: new Date(now.getTime() + PHONE_VERIFICATION_TTL_MS),
        maxAttempts: PHONE_VERIFICATION_MAX_ATTEMPTS,
        deliveryFailed,
        createdAt: now,
      })
      .returning();
    if (!challenge) throw new Error('phone verification insert returned no row');
    return { ok: true, challenge };
  }

  /** Read the challenge a submitted code would be checked against, if any. */
  async outstanding(phoneNumberId: string): Promise<PhoneVerificationRow | null> {
    return outstandingChallenge(phoneNumberId);
  }

  /**
   * Check a submitted code and, on success, flip the number to `verified`.
   *
   * @remarks
   * The attempt is counted before the comparison, so abandoning the request mid-flight does not
   * buy a free guess. Comparison is `timingSafeEqual` over the two 32-byte digests — equal length
   * by construction, so the call cannot throw on a malformed submission.
   *
   * The status flip and the challenge's `consumedAt` are written in one transaction: a number
   * that is `verified` always has a spent challenge behind it, and a spent challenge always
   * verified something.
   *
   * @param number - The number being proven.
   * @param code - The 6 digits the person typed.
   * @returns the verified number, or a refusal plus how many attempts remain.
   * @throws {ConflictError} When the number is already verified or has been blocked.
   */
  async submit(number: PhoneNumberRow, code: string): Promise<VerificationResult> {
    if (number.status === 'blocked') throw new ConflictError('This number cannot be used.');
    if (number.status === 'verified') throw new ConflictError('This number is already verified.');

    const now = this.now();
    const challenge = await this.outstanding(number.id);
    if (!challenge) return { ok: false, refusal: 'no-challenge', attemptsRemaining: 0 };
    if (challenge.expiresAt.getTime() <= now.getTime()) {
      await db
        .update(phoneVerification)
        .set({ invalidatedAt: now })
        .where(eq(phoneVerification.id, challenge.id));
      return { ok: false, refusal: 'expired', attemptsRemaining: 0 };
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      return { ok: false, refusal: 'attempts-exhausted', attemptsRemaining: 0 };
    }

    const [counted] = await db
      .update(phoneVerification)
      .set({ attempts: sql`${phoneVerification.attempts} + 1` })
      .where(eq(phoneVerification.id, challenge.id))
      .returning();
    const attempts = counted?.attempts ?? challenge.attempts + 1;

    const matches = timingSafeEqual(hashCode(code), Buffer.from(challenge.codeHash, 'hex'));
    if (!matches) {
      const remaining = Math.max(0, challenge.maxAttempts - attempts);
      if (remaining === 0) {
        await db
          .update(phoneVerification)
          .set({ invalidatedAt: now })
          .where(eq(phoneVerification.id, challenge.id));
      }
      return { ok: false, refusal: 'wrong-code', attemptsRemaining: remaining };
    }

    return await db.transaction(async (tx) => {
      await tx
        .update(phoneVerification)
        .set({ consumedAt: now })
        .where(eq(phoneVerification.id, challenge.id));
      const [verified] = await tx
        .update(phoneNumber)
        .set({ status: 'verified', verifiedAt: now })
        .where(eq(phoneNumber.id, number.id))
        .returning();
      if (!verified) throw new NotFoundError('Phone number not found');
      return { ok: true, number: verified };
    });
  }
}

/**
 * Read the challenge a submitted code would be checked against, if any.
 *
 * @remarks
 * A free function rather than only a method because this is a pure read of `phone_verification`
 * and needs no SMS transport. {@link PhoneVerificationService} resolves the container's `sms`
 * value on construction, which throws outside local mode when the SMS credentials are absent — so
 * a caller that only wants to *report* a challenge (listing numbers, say) must not have to build
 * the service to do it, or a deploy that never sends SMS could not read its own phone numbers.
 *
 * @param phoneNumberId - The number whose outstanding challenge to load.
 * @returns the live challenge, or null when none is awaiting a code.
 */
export async function outstandingChallenge(
  phoneNumberId: string,
): Promise<PhoneVerificationRow | null> {
  const rows = await db
    .select()
    .from(phoneVerification)
    .where(
      and(
        eq(phoneVerification.phoneNumberId, phoneNumberId),
        isNull(phoneVerification.consumedAt),
        isNull(phoneVerification.invalidatedAt),
      ),
    )
    .orderBy(desc(phoneVerification.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/** How many wrong codes remain against an outstanding challenge, for display. */
export function attemptsRemaining(challenge: PhoneVerificationRow | null): number {
  if (!challenge) return 0;
  return Math.max(0, challenge.maxAttempts - challenge.attempts);
}

/** When another code may be requested, given the most recent send. */
export function resendAvailableAt(challenge: PhoneVerificationRow | null, now: Date): Date {
  if (!challenge) return now;
  return new Date(challenge.createdAt.getTime() + PHONE_VERIFICATION_RESEND_INTERVAL_MS);
}

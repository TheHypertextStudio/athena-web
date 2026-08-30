/**
 * `@docket/db` — phone bindings and voice sessions.
 *
 * @remarks
 * Two tables and one invariant. The invariant is that **an inbound call is bound to an account
 * only by a number whose ownership was proven**, and it is enforced by a partial unique index
 * rather than by the resolver's care: `phone_number_verified_unique_idx` makes it impossible for
 * two accounts to both hold the same number in `verified`. The caller-id lookup is therefore a
 * single equality read that either finds exactly one account or finds none — there is no
 * "pick the best match" step where a bug could hand one person's conversation to another.
 *
 * The challenge lives in its own table rather than as columns on the number for two reasons.
 * A challenge is short-lived and a number is not, so a wrong-code attempt must never write to the
 * row that grants access; and a re-send has to be rate-limited against the *history* of sends,
 * which needs rows, not a counter that a delete would reset.
 *
 * Every column added here is nullable or defaulted, and no existing table is altered, so the
 * migration is additive against live production data.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { agentSession } from './agents';
import { user } from './auth';
import { organization } from './identity';

/** Lifecycle of a bound phone number; mirrors `PhoneNumberStatus` in `@docket/types`. */
export type PhoneNumberStatus = 'pending' | 'verified' | 'blocked';

/** Which transport a voice session ran over; mirrors `VoiceChannel` in `@docket/types`. */
export type VoiceSessionChannel = 'web' | 'phone';

/** Lifecycle of a voice session row. */
export type VoiceSessionStatus = 'active' | 'ended';

/** Verification backend recorded for one challenge. */
export type PhoneVerificationProvider = 'legacy_sms' | 'twilio_verify' | 'capture';

/** Origin of a durable callback authorization. */
export type PhoneCallAuthorizationSource = 'weak_inbound' | 'docket';

/** State of the callback authorization state machine. */
export type PhoneCallAuthorizationState =
  | 'awaiting_hangup'
  | 'dialing'
  | 'awaiting_digit'
  | 'authorized'
  | 'connected'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'canceled';

/** Signal that authorized one phone voice session. */
export type VoiceSessionAuthorizationMethod = 'stir_a' | 'callback' | 'docket';

/**
 * A phone number a person has bound to their Docket account.
 *
 * @remarks
 * `e164` is the normalized dial string and the only field the caller-id resolver reads; the
 * national/dial-code split is kept so the settings surface can re-render the number the way its
 * owner typed it without ever having to parse E.164 back apart.
 *
 * `callingEnabled` is separate from `status` on purpose: turning off "Athena may answer calls from
 * this number" must not throw away the proof of ownership, or every pause would cost the person
 * another SMS round trip.
 */
export const phoneNumber = pgTable(
  'phone_number',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Normalized dial string, `+` followed by digits. The caller-id lookup key. */
    e164: text('e164').notNull(),
    /** E.164 country calling code, digits only — kept for redisplay, never re-derived. */
    dialCode: text('dial_code').notNull(),
    /** ISO 3166-1 alpha-2 country the number was entered under. */
    country: text('country').notNull(),
    /** The number as its owner typed it, national form, separators stripped. */
    nationalNumber: text('national_number').notNull(),
    status: text('status').$type<PhoneNumberStatus>().notNull().default('pending'),
    /** Whether Athena answers calls from this number, independent of proven ownership. */
    callingEnabled: boolean('calling_enabled').notNull().default(true),
    verifiedAt: timestamp('verified_at'),
    /** When a call from this number last reached Athena — shown so a stale binding is visible. */
    lastCalledAt: timestamp('last_called_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    /**
     * One account per verified number, database-enforced.
     *
     * @remarks
     * Partial so two people may each hold the same number *pending* — which happens honestly when
     * a number changes hands — while only the one who completed the challenge holds it verified.
     */
    uniqueIndex('phone_number_verified_unique_idx')
      .on(t.e164)
      .where(sql`${t.status} = 'verified'`),
    uniqueIndex('phone_number_user_value_idx').on(t.userId, t.e164),
    index('phone_number_user_idx').on(t.userId, t.createdAt),
    check('phone_number_status_check', sql`${t.status} in ('pending','verified','blocked')`),
    check('phone_number_e164_check', sql`${t.e164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    /** Proven ownership and a verification timestamp are the same fact; neither exists alone. */
    check(
      'phone_number_verified_at_check',
      sql`(${t.status} = 'verified') = (${t.verifiedAt} is not null)`,
    ),
  ],
);

/**
 * One outstanding (or spent) one-time-code challenge against a phone number.
 *
 * @remarks
 * Managed verification providers own new codes and never expose them to Docket. Legacy rows retain
 * their SHA-256 hash only for the remaining ten-minute deployment compatibility window. `attempts`
 * counts wrong submissions and is compared against `maxAttempts` before either provider path runs.
 * Rows remain after consumption or exhaustion because a deletable send history is not a limit.
 */
export const phoneVerification = pgTable(
  'phone_verification',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    /** Owner retained even when the pending binding is removed, so account limits survive. */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Nullable because deleting a pending binding must not delete its send history. */
    phoneNumberId: text('phone_number_id').references(() => phoneNumber.id, {
      onDelete: 'set null',
    }),
    /** Normalized destination retained for provider-independent rolling limits. */
    e164: text('e164').notNull(),
    /** Backend that owns this challenge and its code. */
    provider: text('provider').$type<PhoneVerificationProvider>().notNull().default('legacy_sms'),
    /** Opaque provider correlation id. Null only for challenges issued before managed Verify. */
    providerChallengeId: text('provider_challenge_id'),
    /** Last normalized provider state, never raw provider copy. */
    providerStatus: text('provider_status'),
    /** SHA-256 of a legacy 6-digit code. Managed providers never expose a code to Docket. */
    codeHash: text('code_hash'),
    expiresAt: timestamp('expires_at').notNull(),
    /** Wrong-code submissions so far. */
    attempts: integer('attempts').notNull().default(0),
    /** Wrong-code submissions this challenge tolerates before it is destroyed. */
    maxAttempts: integer('max_attempts').notNull().default(5),
    /** When the correct code was accepted. Null while outstanding. */
    consumedAt: timestamp('consumed_at'),
    /** When the challenge was abandoned — superseded by a resend, or attempts exhausted. */
    invalidatedAt: timestamp('invalidated_at'),
    /** True when the SMS transport refused the message, so the UI can say so honestly. */
    deliveryFailed: boolean('delivery_failed').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('phone_verification_number_idx').on(t.phoneNumberId, t.createdAt),
    index('phone_verification_e164_idx').on(t.e164, t.createdAt),
    index('phone_verification_user_idx').on(t.userId, t.createdAt),
    check('phone_verification_attempts_check', sql`${t.attempts} >= 0`),
    check('phone_verification_max_attempts_check', sql`${t.maxAttempts} > 0`),
    check(
      'phone_verification_provider_check',
      sql`${t.provider} in ('legacy_sms','twilio_verify','capture')`,
    ),
  ],
);

/** Stable row used to serialize verification-send reservations for one normalized number. */
export const phoneVerificationRateLock = pgTable('phone_verification_rate_lock', {
  e164: text('e164').primaryKey(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** Durable authorization for a weak inbound call or an authenticated Docket callback request. */
export const phoneCallAuthorization = pgTable(
  'phone_call_authorization',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    phoneNumberId: text('phone_number_id').references(() => phoneNumber.id, {
      onDelete: 'set null',
    }),
    /** Snapshot of the linked destination. Inbound request parameters never populate this field. */
    destinationE164: text('destination_e164').notNull(),
    source: text('source').$type<PhoneCallAuthorizationSource>().notNull(),
    state: text('state').$type<PhoneCallAuthorizationState>().notNull().default('awaiting_hangup'),
    inboundCallSid: text('inbound_call_sid'),
    outboundCallSid: text('outbound_call_sid'),
    /** Raw Twilio verification label retained for support and aggregate metrics. */
    stirVerification: text('stir_verification'),
    expiresAt: timestamp('expires_at').notNull(),
    outboundStartedAt: timestamp('outbound_started_at'),
    authorizedAt: timestamp('authorized_at'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('phone_call_authorization_inbound_sid_idx').on(t.inboundCallSid),
    uniqueIndex('phone_call_authorization_outbound_sid_idx').on(t.outboundCallSid),
    uniqueIndex('phone_call_authorization_active_number_idx')
      .on(t.phoneNumberId)
      .where(
        sql`${t.phoneNumberId} is not null and ${t.state} in ('dialing','awaiting_digit','authorized','connected')`,
      ),
    index('phone_call_authorization_number_idx').on(t.phoneNumberId, t.createdAt),
    index('phone_call_authorization_destination_idx').on(t.destinationE164, t.createdAt),
    check('phone_call_authorization_source_check', sql`${t.source} in ('weak_inbound','docket')`),
    check(
      'phone_call_authorization_state_check',
      sql`${t.state} in ('awaiting_hangup','dialing','awaiting_digit','authorized','connected','completed','failed','expired','canceled')`,
    ),
    check(
      'phone_call_authorization_destination_check',
      sql`${t.destinationE164} ~ '^\\+[1-9][0-9]{6,14}$'`,
    ),
  ],
);

/**
 * One live or finished voice session over one transport.
 *
 * @remarks
 * This row is **not** where the conversation lives. Spoken turns are written into
 * `session_activity` on the `agent_session` this row points at — the person's single canonical
 * Athena conversation — so a phone call and a web chat land in the same timeline by construction
 * rather than by a later merge. What this table holds is only what the *transport* knows and the
 * conversation does not: which call it was, which number it came from, and whether the account
 * was entitled when it started.
 *
 * `callSid` is unique so a provider webhook retry (they retry) cannot open a second session for
 * the same call.
 */
export const voiceSession = pgTable(
  'voice_session',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    /** The canonical Athena conversation every turn of this session is written into. */
    conversationId: text('conversation_id')
      .notNull()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Workspace focus at the moment the session started, if any. */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    channel: text('channel').$type<VoiceSessionChannel>().notNull(),
    status: text('status').$type<VoiceSessionStatus>().notNull().default('active'),
    /** The verified number the call came from; null for a browser session. */
    phoneNumberId: text('phone_number_id').references(() => phoneNumber.id, {
      onDelete: 'set null',
    }),
    /** The telephony provider's call identifier; null for a browser session. */
    callSid: text('call_sid'),
    /** Signal that authorized a phone session. Null for browser and legacy phone sessions. */
    authorizationMethod: text('authorization_method').$type<VoiceSessionAuthorizationMethod>(),
    /** Carrier attestation observed on inbound entry, when one existed. */
    stirVerification: text('stir_verification'),
    /** The realtime speech provider backing this session (`openai-realtime`, `twilio-relay`, `mock`). */
    provider: text('provider').notNull(),
    /** How many turns the person spoke — cheap health signal for a channel that can fail silently. */
    userTurns: integer('user_turns').notNull().default(0),
    /** How many turns Athena spoke. */
    assistantTurns: integer('assistant_turns').notNull().default(0),
    /** How many of Athena's turns the person cut into. */
    interruptions: integer('interruptions').notNull().default(0),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    endedAt: timestamp('ended_at'),
    /** Stable machine reason, never provider or exception text. */
    endedReason: text('ended_reason'),
  },
  (t) => [
    uniqueIndex('voice_session_call_sid_idx').on(t.callSid),
    index('voice_session_conversation_idx').on(t.conversationId, t.startedAt),
    index('voice_session_user_idx').on(t.userId, t.startedAt),
    check('voice_session_channel_check', sql`${t.channel} in ('web','phone')`),
    check('voice_session_status_check', sql`${t.status} in ('active','ended')`),
    /**
     * A phone session must name the call it is; a web session must not pretend to be one.
     *
     * @remarks
     * Without this, a bug that forgot to set `callSid` would produce a phone session that the
     * retry-dedupe unique index cannot protect, and every provider retry would open a new one.
     */
    check(
      'voice_session_phone_call_sid_check',
      sql`(${t.channel} = 'phone') = (${t.callSid} is not null)`,
    ),
  ],
);

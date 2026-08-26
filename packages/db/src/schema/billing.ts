/** `@docket/db` — organization product ownership and provider synchronization. */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { productEntitlementSource, productEntitlementStatus } from '../enums';
import { genId } from '../id';
import { user } from './auth';
import { organization } from './identity';

/** Public discount programs configured by Docket. */
export const BILLING_DISCOUNT_PROGRAM_KEYS = ['student', 'nonprofit'] as const;
/** Public discount program key. */
export type BillingDiscountProgramKey = (typeof BILLING_DISCOUNT_PROGRAM_KEYS)[number];

/** Customer application lifecycle. */
export const BILLING_DISCOUNT_APPLICATION_STATUSES = [
  'submitted',
  'needs_information',
  'approved',
  'rejected',
  'withdrawn',
  'expired',
] as const;
/** Customer application status. */
export type BillingDiscountApplicationStatus =
  (typeof BILLING_DISCOUNT_APPLICATION_STATUSES)[number];

/** Award lifecycle while Docket and Stripe synchronize a discount. */
export const BILLING_DISCOUNT_AWARD_STATUSES = [
  'scheduled',
  'applying',
  'active',
  'ending',
  'expired',
  'revoked',
  'provider_failed',
] as const;
/** Discount award status. */
export type BillingDiscountAwardStatus = (typeof BILLING_DISCOUNT_AWARD_STATUSES)[number];

/** Provider synchronization lifecycle for retryable billing writes. */
export const BILLING_PROVIDER_SYNC_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
] as const;
/** Provider synchronization status. */
export type BillingProviderSyncStatus = (typeof BILLING_PROVIDER_SYNC_STATUSES)[number];

/** Credit lifecycle from preview through Stripe issuance. */
export const BILLING_CREDIT_STATUSES = ['previewed', 'issuing', 'issued', 'failed'] as const;
/** Billing credit status. */
export type BillingCreditStatus = (typeof BILLING_CREDIT_STATUSES)[number];

/** One durable provider customer and trial history for one organization. */
export const organizationBillingAccount = pgTable(
  'organization_billing_account',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    trialConsumedAt: timestamp('trial_consumed_at'),
    billingCountry: text('billing_country'),
    countryVerifiedAt: timestamp('country_verified_at'),
    countryVerificationRequired: boolean('country_verification_required').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex('organization_billing_customer_uq').on(table.stripeCustomerId)],
);

/** One hosted Checkout attempt, retained so repeated clicks cannot create subscriptions. */
export const billingCheckoutAttempt = pgTable(
  'billing_checkout_attempt',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    productKey: text('product_key').notNull(),
    status: text('status').notNull(),
    stripeSessionId: text('stripe_session_id'),
    checkoutUrl: text('checkout_url'),
    expiresAt: timestamp('expires_at').notNull(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('billing_checkout_org_idx').on(table.organizationId, table.createdAt),
    uniqueIndex('billing_checkout_open_org_product_uq')
      .on(table.organizationId, table.productKey)
      .where(sql`${table.status} IN ('creating', 'open')`),
  ],
);

/** A claimed provider webhook delivery. Its primary key makes retries idempotent. */
export const billingProviderEvent = pgTable(
  'billing_provider_event',
  {
    providerEventId: text('provider_event_id').primaryKey(),
    provider: text('provider').notNull().default('stripe'),
    type: text('type').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    providerCreatedAt: timestamp('provider_created_at').notNull(),
    processedAt: timestamp('processed_at'),
    processingError: text('processing_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('billing_provider_event_org_idx').on(table.organizationId, table.providerCreatedAt),
    index('billing_provider_event_unprocessed_idx')
      .on(table.createdAt)
      .where(sql`${table.processedAt} IS NULL`),
  ],
);

/** One public eligibility program. Private partner awards do not require a program row. */
export const billingDiscountProgram = pgTable(
  'billing_discount_program',
  {
    key: text('key').$type<BillingDiscountProgramKey>().primaryKey(),
    name: text('name').notNull(),
    audience: text('audience').$type<BillingDiscountProgramKey>().notNull(),
    percentOff: integer('percent_off').notNull(),
    reviewMonths: integer('review_months').notNull(),
    terms: text('terms').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check('billing_discount_program_percent_check', sql`${table.percentOff} BETWEEN 1 AND 90`),
    check(
      'billing_discount_program_review_months_check',
      sql`${table.reviewMonths} BETWEEN 1 AND 24`,
    ),
  ],
);

/** One customer's eligibility request. Provider awards remain separate from the review record. */
export const billingDiscountApplication = pgTable(
  'billing_discount_application',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    programKey: text('program_key')
      .$type<BillingDiscountProgramKey>()
      .notNull()
      .references(() => billingDiscountProgram.key),
    applicantUserId: text('applicant_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    status: text('status').$type<BillingDiscountApplicationStatus>().notNull(),
    evidenceType: text('evidence_type'),
    institutionalEmail: text('institutional_email'),
    ein: text('ein'),
    requestDetails: jsonb('request_details').$type<Record<string, unknown>>().notNull().default({}),
    informationRequest: text('information_request'),
    decisionReason: text('decision_reason'),
    submittedAt: timestamp('submitted_at').notNull().defaultNow(),
    informationRequestedAt: timestamp('information_requested_at'),
    decidedAt: timestamp('decided_at'),
    expiresAt: timestamp('expires_at'),
    withdrawnAt: timestamp('withdrawn_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('billing_discount_application_org_idx').on(table.organizationId, table.createdAt),
    index('billing_discount_application_queue_idx').on(table.status, table.submittedAt),
    uniqueIndex('billing_discount_application_review_org_uq')
      .on(table.organizationId)
      .where(sql`${table.status} IN ('submitted', 'needs_information')`),
    check(
      'billing_discount_application_status_check',
      sql`${table.status} IN ('submitted', 'needs_information', 'approved', 'rejected', 'withdrawn', 'expired')`,
    ),
  ],
);

/** Immutable customer-visible history for application submissions and staff decisions. */
export const billingDiscountApplicationEvent = pgTable(
  'billing_discount_application_event',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    applicationId: text('application_id')
      .notNull()
      .references(() => billingDiscountApplication.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    reason: text('reason'),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    staffUserId: text('staff_user_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('billing_discount_application_event_idx').on(table.applicationId, table.createdAt),
  ],
);

/** Private uploaded evidence for an application. The API brokers every read. */
export const billingDiscountEvidence = pgTable(
  'billing_discount_evidence',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    applicationId: text('application_id')
      .notNull()
      .references(() => billingDiscountApplication.id, { onDelete: 'cascade' }),
    evidenceType: text('evidence_type').notNull(),
    blobKey: text('blob_key').notNull(),
    fileName: text('file_name'),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    deleteAfter: timestamp('delete_after').notNull(),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('billing_discount_evidence_delete_idx')
      .on(table.deleteAfter)
      .where(sql`${table.deletedAt} IS NULL`),
    check('billing_discount_evidence_size_check', sql`${table.byteSize} > 0`),
  ],
);

/** One approved discount. A partial unique index prevents stacking during provider sync. */
export const billingDiscountAward = pgTable(
  'billing_discount_award',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    applicationId: text('application_id').references(() => billingDiscountApplication.id, {
      onDelete: 'set null',
    }),
    programKey: text('program_key')
      .$type<BillingDiscountProgramKey>()
      .references(() => billingDiscountProgram.key),
    percentOff: integer('percent_off').notNull(),
    status: text('status').$type<BillingDiscountAwardStatus>().notNull(),
    startsAt: timestamp('starts_at').notNull(),
    endsAt: timestamp('ends_at').notNull(),
    reviewAt: timestamp('review_at').notNull(),
    reason: text('reason').notNull(),
    approvedByStaffId: text('approved_by_staff_id'),
    providerCouponId: text('provider_coupon_id'),
    providerDiscountId: text('provider_discount_id'),
    providerSyncError: text('provider_sync_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('billing_discount_award_org_idx').on(table.organizationId, table.createdAt),
    uniqueIndex('billing_discount_award_current_org_uq')
      .on(table.organizationId)
      .where(
        sql`${table.status} IN ('scheduled', 'applying', 'active', 'ending', 'provider_failed')`,
      ),
    check('billing_discount_award_percent_check', sql`${table.percentOff} BETWEEN 1 AND 90`),
    check('billing_discount_award_window_check', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'billing_discount_award_status_check',
      sql`${table.status} IN ('scheduled', 'applying', 'active', 'ending', 'expired', 'revoked', 'provider_failed')`,
    ),
  ],
);

/** Durable retry record for one provider mutation such as applying an award or issuing a credit. */
export const billingProviderSync = pgTable(
  'billing_provider_sync',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    awardId: text('award_id').references(() => billingDiscountAward.id, {
      onDelete: 'set null',
    }),
    operation: text('operation').notNull(),
    status: text('status').$type<BillingProviderSyncStatus>().notNull().default('pending'),
    idempotencyKey: text('idempotency_key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('billing_provider_sync_idempotency_uq').on(table.idempotencyKey),
    index('billing_provider_sync_due_idx').on(table.status, table.nextAttemptAt),
    check('billing_provider_sync_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'billing_provider_sync_status_check',
      sql`${table.status} IN ('pending', 'running', 'succeeded', 'failed')`,
    ),
  ],
);

/** Previewed or issued tax-aware Stripe credit for one award. */
export const billingCredit = pgTable(
  'billing_credit',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    awardId: text('award_id')
      .notNull()
      .references(() => billingDiscountAward.id, { onDelete: 'restrict' }),
    status: text('status').$type<BillingCreditStatus>().notNull(),
    currency: text('currency').notNull(),
    baseAmount: integer('base_amount').notNull(),
    taxAmount: integer('tax_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull(),
    servicePeriodStartsAt: timestamp('service_period_starts_at').notNull(),
    servicePeriodEndsAt: timestamp('service_period_ends_at').notNull(),
    providerInvoiceId: text('provider_invoice_id').notNull(),
    providerCreditNoteId: text('provider_credit_note_id'),
    providerPreview: jsonb('provider_preview')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    issuedAt: timestamp('issued_at'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('billing_credit_org_idx').on(table.organizationId, table.createdAt),
    uniqueIndex('billing_credit_provider_note_uq').on(table.providerCreditNoteId),
    check(
      'billing_credit_amount_check',
      sql`${table.baseAmount} >= 0 AND ${table.totalAmount} >= 0`,
    ),
    check(
      'billing_credit_status_check',
      sql`${table.status} IN ('previewed', 'issuing', 'issued', 'failed')`,
    ),
  ],
);

/**
 * Durable ownership of one paid product by one organization.
 *
 * @remarks
 * Baseline Docket access has no row. This table records only paid or complimentary products, so
 * capability checks cannot accidentally turn the free product into a billing state.
 */
export const organizationProductEntitlement = pgTable(
  'organization_product_entitlement',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    productKey: text('product_key').notNull(),
    status: productEntitlementStatus('status').notNull(),
    source: productEntitlementSource('source').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    trialEndsAt: timestamp('trial_ends_at'),
    currentPeriodEnd: timestamp('current_period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    graceEndsAt: timestamp('grace_ends_at'),
    providerObservedAt: timestamp('provider_observed_at'),
    canceledAt: timestamp('canceled_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.productKey] }),
    index('organization_product_status_idx').on(table.productKey, table.status),
    index('organization_product_subscription_idx').on(table.stripeSubscriptionId),
  ],
);

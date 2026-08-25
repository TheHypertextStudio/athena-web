/** Customer discount applications, evidence, awards, and credit history. */
import {
  BILLING_DISCOUNT_APPLICATION_STATUSES,
  BILLING_DISCOUNT_AWARD_STATUSES,
  BILLING_DISCOUNT_PROGRAM_KEYS,
  billingCredit,
  billingDiscountApplication,
  billingDiscountApplicationEvent,
  billingDiscountAward,
  billingDiscountEvidence,
  billingDiscountProgram,
  db,
  genId,
  organization,
} from '@docket/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { getContainer } from '../container';
import { AuthError, ConflictError, NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { hasSqlState } from '../lib/sql-state';
import { zForm, zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

/** Public program details shown before a customer applies. */
export const DiscountProgramOut = z.object({
  key: z.enum(BILLING_DISCOUNT_PROGRAM_KEYS),
  name: z.string(),
  percentOff: z.number().int(),
  reviewMonths: z.number().int(),
  terms: z.string(),
});
/** Public program response value. */
export type DiscountProgramOut = z.infer<typeof DiscountProgramOut>;

/** One immutable application-history entry. */
export const DiscountApplicationEventOut = z.object({
  id: z.string(),
  type: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
/** Application-history response value. */
export type DiscountApplicationEventOut = z.infer<typeof DiscountApplicationEventOut>;

/** Customer-visible discount application. */
export const DiscountApplicationOut = z.object({
  id: z.string(),
  programKey: z.enum(BILLING_DISCOUNT_PROGRAM_KEYS),
  status: z.enum(BILLING_DISCOUNT_APPLICATION_STATUSES),
  evidenceType: z.string().nullable(),
  institutionalEmail: z.string().nullable(),
  ein: z.string().nullable(),
  informationRequest: z.string().nullable(),
  decisionReason: z.string().nullable(),
  submittedAt: z.string(),
  decidedAt: z.string().nullable(),
  events: z.array(DiscountApplicationEventOut),
});
/** Discount application response value. */
export type DiscountApplicationOut = z.infer<typeof DiscountApplicationOut>;

/** Customer-visible awarded discount. */
export const DiscountAwardOut = z.object({
  id: z.string(),
  programKey: z.enum(BILLING_DISCOUNT_PROGRAM_KEYS).nullable(),
  percentOff: z.number().int(),
  status: z.enum(BILLING_DISCOUNT_AWARD_STATUSES),
  startsAt: z.string(),
  endsAt: z.string(),
  reviewAt: z.string(),
  reason: z.string(),
});
/** Discount award response value. */
export type DiscountAwardOut = z.infer<typeof DiscountAwardOut>;

/** Customer-visible credit issued for an approved mid-period discount. */
export const DiscountCreditOut = z.object({
  id: z.string(),
  status: z.enum(['previewed', 'issuing', 'issued', 'failed']),
  currency: z.string(),
  totalAmount: z.number().int(),
  issuedAt: z.string().nullable(),
});
/** Discount credit response value. */
export type DiscountCreditOut = z.infer<typeof DiscountCreditOut>;

/** Customer discount center summary. */
export const DiscountsOut = z.object({
  programs: z.array(DiscountProgramOut),
  application: DiscountApplicationOut.nullable(),
  award: DiscountAwardOut.nullable(),
  credit: DiscountCreditOut.nullable(),
});
/** Discount center response value. */
export type DiscountsOut = z.infer<typeof DiscountsOut>;

/** Initial customer application shape. */
export const SubmitDiscountApplicationBody = z
  .discriminatedUnion('programKey', [
    z.object({
      programKey: z.literal('student'),
      evidenceType: z.enum(['institutional_email', 'enrollment_document']),
      institutionalEmail: z.email().optional(),
    }),
    z.object({
      programKey: z.literal('nonprofit'),
      evidenceType: z.enum(['irs_registry', 'determination_letter']),
      ein: z.string().regex(/^\d{2}-?\d{7}$/),
    }),
  ])
  .superRefine((value, ctx) => {
    if (value.programKey === 'student' && value.evidenceType === 'institutional_email') {
      if (!value.institutionalEmail) {
        ctx.addIssue({ code: 'custom', path: ['institutionalEmail'], message: 'Required' });
      }
    }
  });
/** Initial customer application value. */
export type SubmitDiscountApplicationBody = z.infer<typeof SubmitDiscountApplicationBody>;

/** Additional information supplied after a staff request. */
export const SupplementDiscountApplicationBody = z
  .object({
    institutionalEmail: z.email().optional(),
    ein: z
      .string()
      .regex(/^\d{2}-?\d{7}$/)
      .optional(),
    note: z.string().trim().min(1).max(2_000),
  })
  .strict();
/** Supplement response value. */
export type SupplementDiscountApplicationBody = z.infer<typeof SupplementDiscountApplicationBody>;

/** The application path parameter. */
const applicationParam = z.object({ applicationId: z.string() });

/** Max private evidence upload size. */
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
/** Evidence types that Docket can store and staff can inspect safely as downloads. */
const EVIDENCE_MIME_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

/** Structural multipart upload value shared by browser and Node File implementations. */
interface UploadedEvidence {
  /** Original filename. */
  readonly name: string;
  /** File size in bytes. */
  readonly size: number;
  /** Claimed MIME type. */
  readonly type: string;
  /** Read the uploaded bytes. */
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Validated private evidence upload. */
const evidenceForm = z.object({
  file: z
    .custom<UploadedEvidence>((value) => value instanceof File, { message: 'A file is required.' })
    .refine((file) => file.size > 0, { message: 'The file is empty.' })
    .refine((file) => file.size <= MAX_EVIDENCE_BYTES, {
      message: 'The file exceeds the 4 MB limit.',
    })
    .refine((file) => EVIDENCE_MIME_TYPES.includes(file.type as never), {
      message: 'Evidence must be a PDF, PNG, or JPEG file.',
    }),
});

/** Convert an application and its events to the public response. */
function applicationOut(
  application: typeof billingDiscountApplication.$inferSelect,
  events: readonly (typeof billingDiscountApplicationEvent.$inferSelect)[],
): z.input<typeof DiscountApplicationOut> {
  return {
    id: application.id,
    programKey: application.programKey,
    status: application.status,
    evidenceType: application.evidenceType,
    institutionalEmail: application.institutionalEmail,
    ein: application.ein,
    informationRequest: application.informationRequest,
    decisionReason: application.decisionReason,
    submittedAt: application.submittedAt.toISOString(),
    decidedAt: application.decidedAt?.toISOString() ?? null,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

/** Convert an award to the public response. */
function awardOut(
  award: typeof billingDiscountAward.$inferSelect,
): z.input<typeof DiscountAwardOut> {
  return {
    id: award.id,
    programKey: award.programKey,
    percentOff: award.percentOff,
    status: award.status,
    startsAt: award.startsAt.toISOString(),
    endsAt: award.endsAt.toISOString(),
    reviewAt: award.reviewAt.toISOString(),
    reason: award.reason,
  };
}

/** Load one application owned by the current organization and signed-in applicant. */
async function loadOwnedApplication(
  organizationId: string,
  applicationId: string,
  userId: string,
): Promise<typeof billingDiscountApplication.$inferSelect> {
  const [application] = await db
    .select()
    .from(billingDiscountApplication)
    .where(
      and(
        eq(billingDiscountApplication.id, applicationId),
        eq(billingDiscountApplication.organizationId, organizationId),
        eq(billingDiscountApplication.applicantUserId, userId),
      ),
    )
    .limit(1);
  if (!application) throw new NotFoundError('Discount application not found');
  return application;
}

/** Insert an application and its first immutable history event. */
async function submitApplication(
  organizationId: string,
  userId: string,
  input: SubmitDiscountApplicationBody,
): Promise<typeof billingDiscountApplication.$inferSelect> {
  try {
    return await db.transaction(async (tx) => {
      const [application] = await tx
        .insert(billingDiscountApplication)
        .values({
          organizationId,
          applicantUserId: userId,
          programKey: input.programKey,
          status: 'submitted',
          evidenceType: input.evidenceType,
          institutionalEmail:
            input.programKey === 'student' ? (input.institutionalEmail ?? null) : null,
          ein: input.programKey === 'nonprofit' ? input.ein : null,
        })
        .returning();
      if (!application) throw new Error('Discount application insert returned no row');
      await tx.insert(billingDiscountApplicationEvent).values({
        applicationId: application.id,
        type: 'submitted',
        actorUserId: userId,
      });
      return application;
    });
  } catch (error) {
    if (hasSqlState(error, '23505')) {
      throw new ConflictError(
        'This workspace already has a discount application in review',
        'discount_application_pending',
      );
    }
    throw error;
  }
}

/** Customer discount router, mounted at `/v1/orgs/:orgId/billing/discounts`. */
const billingDiscounts = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Billing',
      summary: 'Get discount programs and status',
      response: DiscountsOut,
      description:
        'Returns public Student and Nonprofit terms plus this workspace’s latest application, current award, and latest issued credit. Raw Stripe ids and evidence storage keys never leave this customer response.',
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const [programs, applications, awards, credits] = await Promise.all([
        db.select().from(billingDiscountProgram).where(eq(billingDiscountProgram.active, true)),
        db
          .select()
          .from(billingDiscountApplication)
          .where(eq(billingDiscountApplication.organizationId, orgId))
          .orderBy(desc(billingDiscountApplication.createdAt))
          .limit(1),
        db
          .select()
          .from(billingDiscountAward)
          .where(eq(billingDiscountAward.organizationId, orgId))
          .orderBy(desc(billingDiscountAward.createdAt))
          .limit(1),
        db
          .select()
          .from(billingCredit)
          .where(eq(billingCredit.organizationId, orgId))
          .orderBy(desc(billingCredit.createdAt))
          .limit(1),
      ]);
      const application = applications[0] ?? null;
      const events = application
        ? await db
            .select()
            .from(billingDiscountApplicationEvent)
            .where(eq(billingDiscountApplicationEvent.applicationId, application.id))
            .orderBy(billingDiscountApplicationEvent.createdAt)
        : [];
      const award = awards[0] ?? null;
      const credit = credits[0] ?? null;
      return ok(c, DiscountsOut, {
        programs: programs.map((program) => ({
          key: program.key,
          name: program.name,
          percentOff: program.percentOff,
          reviewMonths: program.reviewMonths,
          terms: program.terms,
        })),
        application: application ? applicationOut(application, events) : null,
        award: award ? awardOut(award) : null,
        credit: credit
          ? {
              id: credit.id,
              status: credit.status,
              currency: credit.currency,
              totalAmount: credit.totalAmount,
              issuedAt: credit.issuedAt?.toISOString() ?? null,
            }
          : null,
      });
    },
  )
  .post(
    '/applications',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
      tag: 'Billing',
      summary: 'Submit a discount application',
      capability: 'manage',
      response: DiscountApplicationOut,
      description:
        'Submits a Student or Nonprofit eligibility application. Student institutional-email evidence uses the verified email in the current Better Auth session instead of accepting a second custom verification system.',
    }),
    zJson(SubmitDiscountApplicationBody),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { orgId } = c.get('actorCtx');
      const input = c.req.valid('json');
      const [org] = await db
        .select({ isPersonal: organization.isPersonal })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1);
      if (!org) throw new NotFoundError('Organization not found');
      if (input.programKey === 'student') {
        if (!org.isPersonal) {
          throw new ConflictError('Student discounts apply only to a personal workspace');
        }
        if (
          input.evidenceType === 'institutional_email' &&
          (!session.user.emailVerified ||
            session.user.email.toLowerCase() !== input.institutionalEmail?.toLowerCase())
        ) {
          throw new ConflictError(
            'Use the verified email on your Docket account for institutional-email evidence',
          );
        }
      } else if (org.isPersonal) {
        throw new ConflictError('Nonprofit discounts apply only to nonprofit organizations');
      }
      const application = await submitApplication(orgId, session.user.id, input);
      const events = await db
        .select()
        .from(billingDiscountApplicationEvent)
        .where(eq(billingDiscountApplicationEvent.applicationId, application.id));
      return created(c, DiscountApplicationOut, applicationOut(application, events));
    },
  )
  .post(
    '/renew',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
      tag: 'Billing',
      summary: 'Apply to renew a discount',
      capability: 'manage',
      response: DiscountApplicationOut,
      description:
        'Starts a new eligibility review for the current Student or Nonprofit award. The existing award remains active through its current paid period while finance reviews the renewal.',
    }),
    zJson(SubmitDiscountApplicationBody),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { orgId } = c.get('actorCtx');
      const input = c.req.valid('json');
      const [award] = await db
        .select()
        .from(billingDiscountAward)
        .where(
          and(
            eq(billingDiscountAward.organizationId, orgId),
            inArray(billingDiscountAward.status, ['active', 'ending']),
          ),
        )
        .limit(1);
      if (award?.programKey !== input.programKey) {
        throw new ConflictError('This workspace has no matching discount to renew');
      }
      if (
        input.programKey === 'student' &&
        input.evidenceType === 'institutional_email' &&
        (!session.user.emailVerified ||
          session.user.email.toLowerCase() !== input.institutionalEmail?.toLowerCase())
      ) {
        throw new ConflictError(
          'Use the verified email on your Docket account for institutional-email evidence',
        );
      }
      const application = await submitApplication(orgId, session.user.id, input);
      const events = await db
        .select()
        .from(billingDiscountApplicationEvent)
        .where(eq(billingDiscountApplicationEvent.applicationId, application.id));
      return created(c, DiscountApplicationOut, applicationOut(application, events));
    },
  )
  .post(
    '/applications/:applicationId/supplement',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Billing',
      summary: 'Supply requested discount information',
      capability: 'manage',
      response: DiscountApplicationOut,
      description:
        'Returns a needs-information application to the finance queue with the customer’s note and any corrected institutional email or EIN.',
    }),
    zParam(applicationParam),
    zJson(SupplementDiscountApplicationBody),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { orgId } = c.get('actorCtx');
      const { applicationId } = c.req.valid('param');
      const input = c.req.valid('json');
      const application = await loadOwnedApplication(orgId, applicationId, session.user.id);
      if (application.status !== 'needs_information') {
        throw new ConflictError('This application is not waiting for more information');
      }
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(billingDiscountApplication)
          .set({
            status: 'submitted',
            informationRequest: null,
            institutionalEmail: input.institutionalEmail ?? application.institutionalEmail,
            ein: input.ein ?? application.ein,
            requestDetails: { note: input.note },
          })
          .where(eq(billingDiscountApplication.id, application.id))
          .returning();
        if (!row) throw new NotFoundError('Discount application not found');
        await tx.insert(billingDiscountApplicationEvent).values({
          applicationId: application.id,
          type: 'supplemented',
          reason: input.note,
          actorUserId: session.user.id,
        });
        return row;
      });
      const events = await db
        .select()
        .from(billingDiscountApplicationEvent)
        .where(eq(billingDiscountApplicationEvent.applicationId, updated.id))
        .orderBy(billingDiscountApplicationEvent.createdAt);
      return ok(c, DiscountApplicationOut, applicationOut(updated, events));
    },
  )
  .post(
    '/applications/:applicationId/withdraw',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Billing',
      summary: 'Withdraw a discount application',
      capability: 'manage',
      response: DiscountApplicationOut,
      description:
        'Withdraws a submitted or needs-information application without changing any active award.',
    }),
    zParam(applicationParam),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { orgId } = c.get('actorCtx');
      const { applicationId } = c.req.valid('param');
      const application = await loadOwnedApplication(orgId, applicationId, session.user.id);
      if (!['submitted', 'needs_information'].includes(application.status)) {
        throw new ConflictError('This application can no longer be withdrawn');
      }
      const now = new Date();
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(billingDiscountApplication)
          .set({ status: 'withdrawn', withdrawnAt: now, decidedAt: now })
          .where(eq(billingDiscountApplication.id, application.id))
          .returning();
        if (!row) throw new NotFoundError('Discount application not found');
        await tx.insert(billingDiscountApplicationEvent).values({
          applicationId: application.id,
          type: 'withdrawn',
          actorUserId: session.user.id,
        });
        await tx
          .update(billingDiscountEvidence)
          .set({ deleteAfter: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) })
          .where(eq(billingDiscountEvidence.applicationId, application.id));
        return row;
      });
      const events = await db
        .select()
        .from(billingDiscountApplicationEvent)
        .where(eq(billingDiscountApplicationEvent.applicationId, updated.id))
        .orderBy(billingDiscountApplicationEvent.createdAt);
      return ok(c, DiscountApplicationOut, applicationOut(updated, events));
    },
  )
  .post(
    '/applications/:applicationId/evidence',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
      tag: 'Billing',
      summary: 'Upload private discount evidence',
      capability: 'manage',
      response: DiscountApplicationOut,
      description:
        'Stores one PDF, PNG, or JPEG in private object storage. The customer response exposes no object URL. Staff download it through the authenticated finance route, and Docket schedules deletion 30 days after a final decision.',
    }),
    zParam(applicationParam),
    zForm(evidenceForm),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { orgId } = c.get('actorCtx');
      const { applicationId } = c.req.valid('param');
      const { file } = c.req.valid('form');
      const application = await loadOwnedApplication(orgId, applicationId, session.user.id);
      if (!['submitted', 'needs_information'].includes(application.status)) {
        throw new ConflictError('This application no longer accepts evidence');
      }
      const evidenceId = genId();
      const blobKey = `billing-discount-evidence/${orgId}/${application.id}/${evidenceId}`;
      await getContainer().blob.put(blobKey, new Uint8Array(await file.arrayBuffer()), file.type);
      try {
        await db.transaction(async (tx) => {
          await tx.insert(billingDiscountEvidence).values({
            id: evidenceId,
            applicationId: application.id,
            evidenceType: application.evidenceType ?? 'document',
            blobKey,
            fileName: file.name || null,
            mimeType: file.type,
            byteSize: file.size,
            deleteAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          });
          await tx.insert(billingDiscountApplicationEvent).values({
            applicationId: application.id,
            type: 'evidence_uploaded',
            actorUserId: session.user.id,
          });
        });
      } catch (error) {
        await getContainer().blob.delete(blobKey);
        throw error;
      }
      const events = await db
        .select()
        .from(billingDiscountApplicationEvent)
        .where(eq(billingDiscountApplicationEvent.applicationId, application.id))
        .orderBy(billingDiscountApplicationEvent.createdAt);
      return created(c, DiscountApplicationOut, applicationOut(application, events));
    },
  );

export default billingDiscounts;

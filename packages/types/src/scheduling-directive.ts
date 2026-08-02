/**
 * `@docket/types` — the directive feed and the daily loop that drives it.
 *
 * @remarks
 * A **directive** is a small, versioned read surface answering "what should I be doing right
 * now, and is it going badly", plus the loop that keeps that answer current: day start →
 * check-ins → drift reorganization → end-of-day review.
 *
 * Per `docs/engineering/specs/curfew-integration.md` §0, nothing in this file — no field, enum
 * value, or machine code — names or models any particular device-control client. Docket
 * publishes *content* ("this is the day, this is how it is going, this gate is holding and this
 * is what releases it") and never an enforcement instruction ("lock the screen", "quit that
 * app"). A consumer maps posture and gates onto whatever enforcement it owns; a second consumer
 * with entirely different enforcement reads the identical payload.
 */
import { z } from 'zod';

import { DateString, OrganizationId, TaskId } from './primitives';
import { WorkShape } from './scheduling';

/** How the day is going, most to least on schedule. */
export const DirectivePosture = z
  .enum(['on_track', 'attention_needed', 'intervention_recommended'])
  .meta({
    id: 'DirectivePosture',
    description:
      'The current read on the day, most to least on schedule. Deliberately generic — a device-control client maps this onto whatever enforcement it owns. Docket never says what to enforce.',
  });
/** Directive-posture value. */
export type DirectivePosture = z.infer<typeof DirectivePosture>;

/** Every {@link DirectivePosture}, least to most severe. */
export const DIRECTIVE_POSTURES: readonly DirectivePosture[] = DirectivePosture.options;

/** One committed item of today's plan, exactly as the plan records it. */
export const DirectivePlanItemOut = z
  .object({
    taskId: TaskId.nullable().describe('The task this item tracks; null for a plain time block.'),
    calendarItemId: z.string().nullable(),
    organizationId: OrganizationId.nullable(),
    title: z.string(),
    shape: WorkShape.nullable().describe(
      'The work shape, when this block was shaped by the planner.',
    ),
    status: z
      .enum(['planned', 'done'])
      .describe(
        "Mirrors the plan's own status exactly. There is deliberately no `deferred` value: a dropped item is removed, never relabeled.",
      ),
    startsAt: z.string().nullable(),
    endsAt: z.string().nullable(),
    url: z.string().nullable().describe('Deep link into the Docket web app for this item.'),
  })
  .meta({ id: 'DirectivePlanItemOut' });
/** Directive-plan-item value. */
export type DirectivePlanItemOut = z.infer<typeof DirectivePlanItemOut>;

/** The one thing that deserves full attention right now, if any. */
export const DirectiveRecommendedAction = z
  .object({
    kind: z.literal('narrow_focus'),
    taskId: TaskId.nullable(),
    calendarItemId: z.string().nullable(),
    title: z.string(),
  })
  .meta({
    id: 'DirectiveRecommendedAction',
    description: 'A narrowing recommendation — never an enforcement instruction.',
  });
/** Directive-recommended-action value. */
export type DirectiveRecommendedAction = z.infer<typeof DirectiveRecommendedAction>;

/** Which end of the day a gate sits at. */
export const DirectiveGateKind = z.enum(['day_start', 'day_end']).meta({ id: 'DirectiveGateKind' });
/** Directive-gate-kind value. */
export type DirectiveGateKind = z.infer<typeof DirectiveGateKind>;

/** A step a gate is still waiting on, as a stable machine code. */
export const DirectiveGateStep = z
  .enum(['agenda_reviewed', 'day_reconciled', 'day_reflected', 'tomorrow_confirmed'])
  .meta({
    id: 'DirectiveGateStep',
    description:
      'A step that must be completed before a gate releases. Stable machine codes — the consuming client owns whatever sentence it shows.',
  });
/** Directive-gate-step value. */
export type DirectiveGateStep = z.infer<typeof DirectiveGateStep>;

/**
 * A held gate and the condition that releases it.
 *
 * @remarks
 * This is the whole vocabulary Docket has for "the user should not move on yet". It states a
 * condition, never a mechanism: `state: 'holding'` plus the outstanding steps. What holding
 * *means* — a full-screen overlay, a focus mode, a browser extension, or simply a reminder — is
 * entirely the consumer's decision.
 */
export const DirectiveGateOut = z
  .object({
    kind: DirectiveGateKind,
    state: z.enum(['open', 'holding']),
    outstandingSteps: z.array(DirectiveGateStep),
    releasedAt: z.string().nullable(),
  })
  .meta({
    id: 'DirectiveGateOut',
    description: 'A condition the day is waiting on. Never an enforcement instruction.',
  });
/** Directive-gate value. */
export type DirectiveGateOut = z.infer<typeof DirectiveGateOut>;

/** Whether today's plan is ready to be shown. */
export const DirectiveAgendaReadiness = z.enum(['ready', 'not_generated', 'empty_week']).meta({
  id: 'DirectiveAgendaReadiness',
  description:
    "Whether today's agenda can be presented: 'ready', 'not_generated' (no planning run covers today), or 'empty_week' (a run covers today but placed nothing).",
});
/** Directive-agenda-readiness value. */
export type DirectiveAgendaReadiness = z.infer<typeof DirectiveAgendaReadiness>;

/** The full daily directive. */
export const DirectiveOut = z
  .object({
    schemaVersion: z.literal('directive/1'),
    directiveId: z.string().describe('This snapshot’s id; echo it to acknowledge it.'),
    date: DateString,
    timezone: z.string(),
    generatedAt: z.string(),
    agendaReadiness: DirectiveAgendaReadiness,
    plan: z.array(DirectivePlanItemOut),
    attention: z.object({
      blocked: z.number().int().min(0),
      dueToday: z.number().int().min(0),
      approvalsPending: z.number().int().min(0),
    }),
    posture: DirectivePosture,
    reason: z
      .string()
      .max(280)
      .describe('Plain-language, application-owned, safe to show verbatim.'),
    recommendedAction: DirectiveRecommendedAction.nullable(),
    gates: z.array(DirectiveGateOut),
    checkInsDue: z
      .number()
      .int()
      .min(0)
      .describe('Check-ins whose scheduled time has passed and which are still unanswered.'),
  })
  .meta({
    id: 'DirectiveOut',
    description: 'The generic daily-directive projection any device-posture client can consume.',
  });
/** Directive value. */
export type DirectiveOut = z.infer<typeof DirectiveOut>;

/** A consuming client reporting what it did with a directive. */
export const AcknowledgeDirectiveInput = z
  .object({
    directiveId: z.string(),
    appliedPosture: DirectivePosture.describe('The posture the client actually acted on.'),
    enforced: z.boolean().describe('Whether the client changed device state in response.'),
    note: z.string().max(500).nullable().optional(),
  })
  .meta({ id: 'AcknowledgeDirectiveInput' });
/** Acknowledge-directive-input value. */
export type AcknowledgeDirectiveInput = z.infer<typeof AcknowledgeDirectiveInput>;

/** Acknowledgement receipt. */
export const AcknowledgeDirectiveOutput = z
  .object({ acknowledged: z.literal(true), acknowledgedAt: z.string() })
  .meta({ id: 'AcknowledgeDirectiveOutput' });
/** Acknowledge-directive-output value. */
export type AcknowledgeDirectiveOutput = z.infer<typeof AcknowledgeDirectiveOutput>;

/** The day-start payload: is the agenda ready, and has the person been through it. */
export const DayStartOut = z
  .object({
    date: DateString,
    timezone: z.string(),
    readiness: DirectiveAgendaReadiness,
    ready: z.boolean().describe('True only when `readiness` is `ready`.'),
    agenda: z.array(DirectivePlanItemOut),
    acknowledgedAt: z
      .string()
      .nullable()
      .describe('When the person completed the morning agenda review. Null until they do.'),
    gate: DirectiveGateOut,
  })
  .meta({
    id: 'DayStartOut',
    description:
      "The start-of-day handshake. `ready: false` with a `readiness` code is returned rather than an empty agenda, so a consumer can tell 'nothing planned' from 'not planned yet'.",
  });
/** Day-start value. */
export type DayStartOut = z.infer<typeof DayStartOut>;

/** How a person answered a check-in. */
export const CheckInResponse = z.enum(['on_track', 'behind', 'switched', 'done']).meta({
  id: 'CheckInResponse',
  description:
    "The person's own answer to a check-in: on track, behind on the current block, switched to something else, or already done.",
});
/** Check-in-response value. */
export type CheckInResponse = z.infer<typeof CheckInResponse>;

/** One scheduled check-in against the day's goals. */
export const DayCheckInOut = z
  .object({
    id: z.string(),
    date: DateString,
    scheduledAt: z.string(),
    firedAt: z.string().nullable(),
    respondedAt: z.string().nullable(),
    response: CheckInResponse.nullable(),
    missed: z
      .boolean()
      .describe('True when the check-in came due, went unanswered, and its window has closed.'),
    blockCalendarItemId: z.string().nullable(),
    blockTitle: z.string().nullable().describe('The block this check-in is about, if any.'),
    outstandingGoals: z
      .number()
      .int()
      .min(0)
      .describe("How many of the day's blocks were still unfinished when this check-in came due."),
    prompt: z.string().describe('Application-owned question copy.'),
  })
  .meta({ id: 'DayCheckInOut' });
/** Day-check-in value. */
export type DayCheckInOut = z.infer<typeof DayCheckInOut>;

/** Answering a check-in. */
export const DayCheckInRespondInput = z
  .object({ response: CheckInResponse, note: z.string().max(500).nullable().optional() })
  .meta({ id: 'DayCheckInRespondInput' });
/** Day-check-in-respond-input value. */
export type DayCheckInRespondInput = z.infer<typeof DayCheckInRespondInput>;

/** What the person decided about a piece of unfinished work. */
export const ReconcileDisposition = z.enum(['completed', 'rescheduled', 'dropped']).meta({
  id: 'ReconcileDisposition',
  description:
    'The decision on one unfinished item: it actually got done, it moves to another day, or it is dropped (which requires a reason).',
});
/** Reconcile-disposition value. */
export type ReconcileDisposition = z.infer<typeof ReconcileDisposition>;

/** One unfinished item awaiting a decision in the evening review. */
export const ReviewItemOut = z
  .object({
    key: z.string().describe('Stable key: the calendar item or plan item this row stands for.'),
    calendarItemId: z.string().nullable(),
    taskId: TaskId.nullable(),
    organizationId: OrganizationId.nullable(),
    title: z.string(),
    shape: WorkShape.nullable(),
    startsAt: z.string().nullable(),
    endsAt: z.string().nullable(),
    disposition: ReconcileDisposition.nullable(),
    rescheduledTo: DateString.nullable(),
    reason: z.string().nullable().describe("The person's own words when an item is dropped."),
  })
  .meta({ id: 'ReviewItemOut' });
/** Review-item value. */
export type ReviewItemOut = z.infer<typeof ReviewItemOut>;

/** The three structured questions the day's review asks. */
export const ReviewPromptKey = z
  .enum(['what_moved', 'what_blocked', 'what_changes_tomorrow'])
  .meta({
    id: 'ReviewPromptKey',
    description:
      'The fixed structured questions of the end-of-day review. A defined set, not a free-text box.',
  });
/** Review-prompt-key value. */
export type ReviewPromptKey = z.infer<typeof ReviewPromptKey>;

/** Every {@link ReviewPromptKey}, in the order they are asked. */
export const REVIEW_PROMPT_KEYS: readonly ReviewPromptKey[] = ReviewPromptKey.options;

/** One answered (or unanswered) review question. */
export const ReviewAnswerOut = z
  .object({
    key: ReviewPromptKey,
    prompt: z.string().describe('Application-owned question copy.'),
    answer: z.string().nullable(),
    required: z.boolean(),
  })
  .meta({ id: 'ReviewAnswerOut' });
/** Review-answer value. */
export type ReviewAnswerOut = z.infer<typeof ReviewAnswerOut>;

/** Which step of the evening flow the person is on. */
export const ReviewStepKey = z
  .enum(['reconcile', 'reflect', 'prepare_tomorrow'])
  .meta({ id: 'ReviewStepKey' });
/** Review-step-key value. */
export type ReviewStepKey = z.infer<typeof ReviewStepKey>;

/** Every {@link ReviewStepKey}, in flow order. */
export const REVIEW_STEP_KEYS: readonly ReviewStepKey[] = ReviewStepKey.options;

/** One step of the evening flow and whether it is satisfied. */
export const ReviewStepOut = z
  .object({
    key: ReviewStepKey,
    title: z.string(),
    complete: z.boolean(),
    outstanding: z
      .number()
      .int()
      .min(0)
      .describe('How many things inside this step still need an answer.'),
  })
  .meta({ id: 'ReviewStepOut' });
/** Review-step value. */
export type ReviewStepOut = z.infer<typeof ReviewStepOut>;

/** One block proposed for tomorrow, awaiting explicit confirmation. */
export const TomorrowProposalOut = z
  .object({
    key: z.string(),
    title: z.string(),
    shape: WorkShape.nullable(),
    startsAt: z.string(),
    endsAt: z.string(),
    organizationId: OrganizationId.nullable(),
    carriedFromKey: z.string().nullable().describe('The reconciled item this came from, if any.'),
  })
  .meta({ id: 'TomorrowProposalOut' });
/** Tomorrow-proposal value. */
export type TomorrowProposalOut = z.infer<typeof TomorrowProposalOut>;

/** The end-of-day review: reconcile, reflect, prepare tomorrow. */
export const DayReviewOut = z
  .object({
    date: DateString,
    timezone: z.string(),
    steps: z.array(ReviewStepOut),
    items: z.array(ReviewItemOut),
    answers: z.array(ReviewAnswerOut),
    tomorrowDate: DateString,
    tomorrowProposals: z.array(TomorrowProposalOut),
    tomorrowConfirmedAt: z
      .string()
      .nullable()
      .describe("When the person explicitly confirmed tomorrow's agenda. Never auto-set."),
    complete: z.boolean().describe('True only when all three steps are satisfied.'),
    completedAt: z.string().nullable(),
    gate: DirectiveGateOut,
  })
  .meta({ id: 'DayReviewOut', description: 'The structured end-of-day review and its gate.' });
/** Day-review value. */
export type DayReviewOut = z.infer<typeof DayReviewOut>;

/** Dispositioning one unfinished item. */
export const ReviewDispositionInput = z
  .object({
    key: z.string(),
    disposition: ReconcileDisposition,
    rescheduledTo: DateString.nullable().optional(),
    reason: z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.disposition !== 'dropped' || (v.reason ?? '').trim().length > 0, {
    path: ['reason'],
    message: 'Dropping an item requires a reason',
  })
  .refine((v) => v.disposition !== 'rescheduled' || v.rescheduledTo != null, {
    path: ['rescheduledTo'],
    message: 'Rescheduling an item requires a date',
  })
  .meta({ id: 'ReviewDispositionInput' });
/** Review-disposition-input value. */
export type ReviewDispositionInput = z.infer<typeof ReviewDispositionInput>;

/** Answering one structured review question. */
export const ReviewAnswerInput = z
  .object({ key: ReviewPromptKey, answer: z.string().max(2000) })
  .meta({ id: 'ReviewAnswerInput' });
/** Review-answer-input value. */
export type ReviewAnswerInput = z.infer<typeof ReviewAnswerInput>;

/** Confirming tomorrow's agenda — the last step, and never implicit. */
export const ConfirmTomorrowInput = z
  .object({ acceptedKeys: z.array(z.string()).max(100) })
  .meta({ id: 'ConfirmTomorrowInput' });
/** Confirm-tomorrow-input value. */
export type ConfirmTomorrowInput = z.infer<typeof ConfirmTomorrowInput>;

/** Result of a drift reorganization pass. */
export const ReorganizeResultOut = z
  .object({
    date: DateString,
    reorganizedAt: z.string(),
    movedBlocks: z.array(
      z.object({
        calendarItemId: z.string(),
        title: z.string(),
        fromStartsAt: z.string(),
        toStartsAt: z.string(),
        toEndsAt: z.string(),
        minutesShifted: z.number().int(),
      }),
    ),
    displacedBlocks: z
      .array(z.object({ calendarItemId: z.string(), title: z.string() }))
      .describe('Blocks that no longer fit the remaining day and were removed from it.'),
    driftMinutes: z
      .number()
      .int()
      .describe('How far behind the day had fallen when this pass ran.'),
  })
  .meta({ id: 'ReorganizeResultOut' });
/** Reorganize-result value. */
export type ReorganizeResultOut = z.infer<typeof ReorganizeResultOut>;

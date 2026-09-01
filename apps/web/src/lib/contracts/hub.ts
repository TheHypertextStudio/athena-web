/**
 * `domain packages` — Hub aggregation slice DTOs.
 *
 * @remarks
 * The Hub is the caller's personal cross-organization data boundary. Its read surfaces
 * aggregate across every organization the session user is an active human Actor in,
 * returning org-chipped items (each carries its originating `organizationId`). These
 * are read-only projections composed from per-org work, notifications, agent sessions,
 * and daily-plan data; mutations happen on the underlying org-scoped or Hub-scoped
 * routers. Tenant data is never merged — each item is independently capability-filtered
 * and carries its own org chip.
 */
import { z } from 'zod';

import { AuditEventOut } from '@docket/connections/activity-contract';
import { Health } from '@docket/work/capability-contract';
import { Priority } from '@docket/work/task-contract';
import { NotificationOut } from '@docket/notifications/notification-contract';
import { ActorId, OrganizationId } from '@docket/identity-access/ids';
import { DailyPlanItemId } from '@docket/planning/ids';
import { InitiativeId, MilestoneId, ProgramId, ProjectId, TaskId } from '@docket/work/ids';
import { SearchDocumentKind, SearchOut } from './search';
import { WorkStatusCategory } from '@docket/work/work-status-contract';

/**
 * An organization "chip" — the minimal org identity stamped onto every aggregated Hub
 * item so the UI can label which tenant a row belongs to without merging tenant data.
 */
export const OrgChip = z
  .object({
    id: OrganizationId.describe('The organization id this chip identifies.'),
    name: z.string().describe("The organization's display name, shown on the chip."),
    slug: z
      .string()
      .describe("The organization's URL slug, used to route from a Hub item into that org."),
    avatar: z
      .string()
      .nullable()
      .optional()
      .describe("The organization's avatar image URL, or null when it has none."),
  })
  .meta({ id: 'OrgChip', description: 'The org label stamped onto an aggregated Hub item.' });
/** Org-chip value. */
export type OrgChip = z.infer<typeof OrgChip>;

/** A compact, org-chipped Task projection for Hub aggregations. */
export const HubTaskItem = z
  .object({
    id: TaskId.describe('The Task id, unique within its org.'),
    organizationId: OrganizationId.describe(
      'The org the Task belongs to (its org chip) — set on every item so the cross-org view never merges tenants.',
    ),
    title: z.string().describe('The Task title.'),
    summary: z
      .string()
      .nullable()
      .describe(
        "A short plain-text excerpt of the Task's description, or null when it has none. Bounded server-side so a Hub row never carries a whole document.",
      ),
    state: z
      .string()
      .describe(
        "The key of the Task's current status in its own workspace (e.g. `todo`, `in_progress`, `done`). A workspace names its own statuses, so this key means something only inside that workspace.",
      ),
    stateType: WorkStatusCategory.describe(
      'The category the status behaves as. The Hub gathers work from several workspaces at once, each with its own status names, so this is what a status glyph and any grouping across them read.',
    ),
    priority: Priority.describe("The Task's priority level."),
    assigneeId: ActorId.nullable()
      .optional()
      .describe('The Actor the Task is assigned to, or null when unassigned.'),
    projectId: ProjectId.nullable()
      .optional()
      .describe('The Project the Task lives under, or null when it has no project.'),
    dueDate: z
      .string()
      .nullable()
      .optional()
      .describe("The Task's due date (ISO `YYYY-MM-DD`), or null when none is set."),
  })
  .meta({ id: 'HubTaskItem', description: 'An org-chipped task in a Hub aggregation.' });
/** Hub task-item value. */
export type HubTaskItem = z.infer<typeof HubTaskItem>;

/** A compact, org-chipped Project projection for the Hub portfolio. */
export const HubProjectItem = z
  .object({
    id: ProjectId.describe('The Project id, unique within its org.'),
    organizationId: OrganizationId.describe('The org the Project belongs to (its org chip).'),
    name: z.string().describe('The Project name.'),
    status: z
      .string()
      .describe(
        "The Project's lifecycle status (e.g. `planned`, `active`, `completed`). Free-form per org.",
      ),
    health: z
      .string()
      .nullable()
      .optional()
      .describe(
        "The Project's health signal (e.g. `on_track`, `at_risk`, `off_track`), or null when unset.",
      ),
    targetDate: z
      .string()
      .nullable()
      .optional()
      .describe("The Project's target completion date (ISO `YYYY-MM-DD`), or null when none."),
  })
  .meta({ id: 'HubProjectItem', description: 'An org-chipped project in the Hub portfolio.' });
/** Hub project-item value. */
export type HubProjectItem = z.infer<typeof HubProjectItem>;

/** The "needs attention" trio + inbox count surfaced at the top of the Hub Today cockpit. */
export const HubNeedsAttention = z
  .object({
    /** Agent sessions across the caller's orgs that are awaiting the caller's approval. */
    approvals: z
      .array(HubTaskItem)
      .describe(
        "Tasks (from agent sessions, across the caller's orgs) awaiting the caller's approval — the most urgent pane.",
      ),
    /** Tasks the caller is involved in that are blocked by an incomplete dependency. */
    blocked: z
      .array(HubTaskItem)
      .describe(
        'Tasks the caller is involved in that are blocked by an incomplete dependency, across their orgs.',
      ),
    /** Tasks due on the requested date, across the caller's orgs. */
    dueToday: z
      .array(HubTaskItem)
      .describe("Tasks due on the requested date, across the caller's orgs."),
    /** Count of unread notifications across the caller's orgs. */
    inbox: z
      .number()
      .int()
      .describe(
        "Count of unread notifications across the caller's orgs (the same number as `GET /notifications/count` → `unread`). >= 0.",
      ),
  })
  .meta({ id: 'HubNeedsAttention', description: "The Today cockpit's needs-attention trio." });
/** Hub needs-attention value. */
export type HubNeedsAttention = z.infer<typeof HubNeedsAttention>;

/** Whether Today is awaiting planning, actively executing a plan, or clear. */
export const HubTodayPlanState = z
  .enum(['unplanned', 'active', 'cleared'])
  .meta({ id: 'HubTodayPlanState', description: "The caller's planning state for one day." });
/** Hub Today plan-state value. */
export type HubTodayPlanState = z.infer<typeof HubTodayPlanState>;

/** An accepted daily-plan task enriched for the finite Today focus sequence. */
export const HubTodayPlanItem = HubTaskItem.extend({
  planItemId: DailyPlanItemId.describe('The personal daily-plan row backing this task.'),
  planStatus: z.enum(['planned', 'done']).describe("The plan row's completion state."),
  sort: z.number().int().describe("The plan row's persisted ordering value."),
  position: z.number().int().describe("The plan row's accepted sort position."),
  estimateMinutes: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('Estimated focused minutes, or null when no useful estimate exists.'),
  timeboxStartsAt: z.iso
    .datetime()
    .nullable()
    .describe('The accepted timebox start, or null when unscheduled.'),
  timeboxEndsAt: z.iso
    .datetime()
    .nullable()
    .describe('The accepted timebox end, or null when unscheduled.'),
  blocked: z.boolean().describe('Whether an incomplete dependency prevents this task from moving.'),
  dependencyImpact: z
    .number()
    .int()
    .min(0)
    .describe('Count of incomplete tasks this task directly unblocks.'),
  reason: z
    .string()
    .nullable()
    .describe(
      'Application-owned explanation for this item occupying its position — a deadline, a running timer, a scheduled window, or work it unblocks. Null when its position is simply the order the caller accepted, which needs no explanation.',
    ),
}).meta({
  id: 'HubTodayPlanItem',
  description: 'A task in the accepted personal plan, enriched for Today.',
});
/** Hub Today accepted-plan item value. */
export type HubTodayPlanItem = z.infer<typeof HubTodayPlanItem>;

/** The current actionable plan item and the one immediately following it. */
export const HubTodayFocus = z
  .object({
    now: HubTodayPlanItem.nullable().describe('The single actionable item to work on now.'),
    after: HubTodayPlanItem.nullable().describe('The next actionable item after Now.'),
  })
  .meta({ id: 'HubTodayFocus', description: "Today's finite two-step execution sequence." });
/** Hub Today focus value. */
export type HubTodayFocus = z.infer<typeof HubTodayFocus>;

/** Latest durable status-update excerpt shown on a Today work card. */
export const HubTodayLatestUpdate = z
  .object({
    excerpt: z.string().describe('A bounded plain-text excerpt from the durable update.'),
    createdAt: z.iso.datetime().describe('When the update was recorded.'),
  })
  .meta({ id: 'HubTodayLatestUpdate', description: 'A grounded status-update excerpt.' });
/** Hub Today latest-update value. */
export type HubTodayLatestUpdate = z.infer<typeof HubTodayLatestUpdate>;

/** Project status composition used by Work in motion. */
export const HubTodayProjectStatus = z
  .object({
    kind: z.literal('project'),
    id: ProjectId,
    organizationId: OrganizationId,
    name: z.string(),
    status: z.string(),
    health: Health.nullable(),
    latestUpdate: HubTodayLatestUpdate.nullable(),
    nextMilestone: z
      .object({ id: MilestoneId, name: z.string(), targetDate: z.iso.date() })
      .nullable(),
    progress: z.object({
      completed: z.number().int().min(0),
      total: z.number().int().min(0),
    }),
  })
  .meta({ id: 'HubTodayProjectStatus', description: 'A grounded Project status card for Today.' });
/** Hub Today Project-status value. */
export type HubTodayProjectStatus = z.infer<typeof HubTodayProjectStatus>;

/** Initiative status composition used by Work in motion. */
export const HubTodayInitiativeStatus = z
  .object({
    kind: z.literal('initiative'),
    id: InitiativeId,
    organizationId: OrganizationId,
    name: z.string(),
    status: z.string(),
    health: Health.nullable(),
    latestUpdate: HubTodayLatestUpdate.nullable(),
    targetDate: z.iso.date().nullable(),
    connectedWork: z.object({
      onTrack: z.number().int().min(0),
      atRisk: z.number().int().min(0),
      offTrack: z.number().int().min(0),
      total: z.number().int().min(0),
    }),
  })
  .meta({
    id: 'HubTodayInitiativeStatus',
    description: 'A grounded Initiative status card for Today.',
  });
/** Hub Today Initiative-status value. */
export type HubTodayInitiativeStatus = z.infer<typeof HubTodayInitiativeStatus>;

/** A Project or Initiative status story selected for Work in motion. */
export const HubTodayStatusCard = z.discriminatedUnion('kind', [
  HubTodayProjectStatus,
  HubTodayInitiativeStatus,
]);
/** Hub Today status-card value. */
export type HubTodayStatusCard = z.infer<typeof HubTodayStatusCard>;

/** A visible, actionable task that can fit the caller's remaining day. */
export const HubTodaySuggestion = HubTaskItem.extend({
  estimateMinutes: z.number().int().positive(),
  dependencyImpact: z.number().int().min(0),
  reason: z.string().describe('Application-owned reason the task is a feasible next move.'),
}).meta({ id: 'HubTodaySuggestion', description: 'A feasible momentum suggestion for Today.' });
/** Hub Today suggestion value. */
export type HubTodaySuggestion = z.infer<typeof HubTodaySuggestion>;

/** Result of completing an accepted Today item through the Task's real workflow. */
export const HubTodayCompleteOut = z
  .object({
    task: HubTaskItem,
    planItemId: DailyPlanItemId,
    planStatus: z.literal('done'),
  })
  .meta({
    id: 'HubTodayCompleteOut',
    description: 'The Task and personal plan state after semantic Today completion.',
  });
/** Hub Today completion result. */
export type HubTodayCompleteOut = z.infer<typeof HubTodayCompleteOut>;

/**
 * The Hub `today` surface: a finite daily operating projection grounded in accepted plan rows,
 * visible work status, deterministic attention, and feasible next actions.
 */
export const HubTodayOut = z
  .object({
    date: z
      .string()
      .describe(
        'The calendar day (ISO `YYYY-MM-DD`) this cockpit covers — echoes the requested `date`.',
      ),
    planState: HubTodayPlanState,
    brief: z.object({
      text: z.string().describe("Athena's concise, deterministic reading of the day."),
      href: z.string().nullable().describe('A relevant in-app destination, or null.'),
      attentionCount: z.number().int().min(0),
    }),
    /** Tasks the caller explicitly accepted into this date's personal plan. */
    plan: z.array(HubTodayPlanItem),
    focus: HubTodayFocus,
    statusCards: z.array(HubTodayStatusCard).max(4),
    suggestions: z.array(HubTodaySuggestion).max(3),
    /** Daily-plan items with a timebox window, for the calendar pane. */
    calendar: z
      .array(
        z.object({
          taskId: TaskId.describe('The Task this timebox block represents.'),
          organizationId: OrganizationId.describe('The org the Task belongs to (org chip).'),
          startsAt: z.string().describe('ISO-8601 start of the timebox block.'),
          endsAt: z.string().describe('ISO-8601 end of the timebox block.'),
        }),
      )
      .describe(
        'Daily-plan items that carry a timebox window, rendered as blocks on the calendar pane. Only timeboxed items appear here.',
      ),
    needsAttention: HubNeedsAttention.describe(
      'The cross-org needs-attention trio (approvals, blocked, dueToday) plus the unread inbox count.',
    ),
  })
  .meta({ id: 'HubTodayOut', description: "The caller's cross-org daily operating projection." });
/** Hub-today value. */
export type HubTodayOut = z.infer<typeof HubTodayOut>;

/** The Hub `inbox` surface: the caller's cross-org unread-first notification feed. */
export const HubInboxOut = z
  .object({
    items: z
      .array(NotificationOut)
      .describe(
        "The caller's notifications across every org, newest first, each org-chipped. The same set as `GET /notifications` with no filters.",
      ),
  })
  .meta({ id: 'HubInboxOut', description: "The caller's cross-org notification inbox." });
/** Hub-inbox value. */
export type HubInboxOut = z.infer<typeof HubInboxOut>;

/** The Hub `activity` surface: the caller's cross-org passive-awareness audit feed. */
export const HubActivityOut = z
  .object({
    items: z
      .array(AuditEventOut)
      .describe(
        "Audit events across the caller's orgs, ordered by the requested `order` (default newest first), each org-chipped.",
      ),
    nextCursor: z
      .string()
      .optional()
      .describe(
        "Opaque forward cursor (the last event's id) for the next page; absent when there are no more events.",
      ),
    total: z
      .number()
      .int()
      .optional()
      .describe('Optional total count of matching events, when computed; absent when not.'),
  })
  .meta({ id: 'HubActivityOut', description: "The caller's cross-org activity feed." });
/** Hub-activity value. */
export type HubActivityOut = z.infer<typeof HubActivityOut>;

/** A dated checkpoint diamond on a Project bar in the portfolio timeline. */
export const HubMilestoneItem = z
  .object({
    id: MilestoneId.describe('The milestone id.'),
    name: z.string().describe('The milestone name shown at the diamond.'),
    targetDate: z
      .string()
      .nullable()
      .optional()
      .describe(
        "The milestone's target date (ISO `YYYY-MM-DD`) — where the diamond sits on the timeline — or null when undated.",
      ),
  })
  .meta({ id: 'HubMilestoneItem', description: 'A milestone diamond on a portfolio bar.' });
/** Hub milestone-item value. */
export type HubMilestoneItem = z.infer<typeof HubMilestoneItem>;

/** A Project "bar" in a portfolio swimlane: its dates, health, and milestone diamonds. */
export const HubProjectBar = z
  .object({
    id: ProjectId.describe('The Project id.'),
    organizationId: OrganizationId.describe('The org the Project belongs to (org chip).'),
    name: z.string().describe('The Project name shown on the bar.'),
    status: z.string().describe("The Project's lifecycle status (free-form per org)."),
    health: z
      .string()
      .nullable()
      .optional()
      .describe(
        "The Project's health signal (e.g. `on_track`/`at_risk`), driving the bar color, or null when unset.",
      ),
    startDate: z
      .string()
      .nullable()
      .optional()
      .describe(
        "The Project's start date (ISO `YYYY-MM-DD`) — the bar's left edge — or null when unset.",
      ),
    targetDate: z
      .string()
      .nullable()
      .optional()
      .describe(
        "The Project's target date (ISO `YYYY-MM-DD`) — the bar's right edge — or null when unset.",
      ),
    milestones: z
      .array(HubMilestoneItem)
      .describe('The milestone diamonds plotted along this Project bar.'),
  })
  .meta({ id: 'HubProjectBar', description: 'A project bar in a portfolio swimlane.' });
/** Hub project-bar value. */
export type HubProjectBar = z.infer<typeof HubProjectBar>;

/** A Program "lane" within an org swimlane, containing its Project bars. */
export const HubProgramLane = z
  .object({
    program: z
      .object({
        id: ProgramId.describe('The Program id.'),
        organizationId: OrganizationId.describe('The org the Program belongs to (org chip).'),
        name: z.string().describe('The Program name labelling the lane.'),
        status: z.string().describe("The Program's lifecycle status (free-form per org)."),
        health: z
          .string()
          .nullable()
          .optional()
          .describe("The Program's health signal, or null when unset."),
      })
      .describe('The Program heading this lane.'),
    projects: z
      .array(HubProjectBar)
      .describe('The Project bars belonging to this Program, in timeline order.'),
  })
  .meta({ id: 'HubProgramLane', description: 'A program lane within an org swimlane.' });
/** Hub program-lane value. */
export type HubProgramLane = z.infer<typeof HubProgramLane>;

/** An org swimlane in the portfolio: its org chip → program lanes → project bars. */
export const HubPortfolioSwimlane = z
  .object({
    organization: OrgChip.describe('The org chip identifying this swimlane (tenant band).'),
    programs: z
      .array(HubProgramLane)
      .describe('The Program lanes within this org, each containing its Project bars.'),
    /** Projects in this org with no program (direct under the org), as bars. */
    unassigned: z
      .array(HubProjectBar)
      .describe(
        'Projects in this org that have no Program (they hang directly off the org), rendered as bars beneath the program lanes.',
      ),
  })
  .meta({ id: 'HubPortfolioSwimlane', description: 'An org swimlane in the Hub portfolio.' });
/** Hub portfolio-swimlane value. */
export type HubPortfolioSwimlane = z.infer<typeof HubPortfolioSwimlane>;

/**
 * The Hub `portfolio` surface: org swimlanes → Program lanes → Project bars, on one
 * timeline. Tenant bands stay separate — each swimlane carries its own org chip.
 */
export const HubPortfolioOut = z
  .object({
    swimlanes: z
      .array(HubPortfolioSwimlane)
      .describe(
        "One swimlane per org the caller belongs to (kept as separate tenant bands), each holding that org's program lanes and project bars.",
      ),
  })
  .meta({ id: 'HubPortfolioOut', description: "The caller's cross-org portfolio timeline." });
/** Hub-portfolio value. */
export type HubPortfolioOut = z.infer<typeof HubPortfolioOut>;

/** The entity kinds the cross-org Hub search can return. */
export const HubSearchHitType = SearchDocumentKind.describe(
  'The semantic kind of a Hub search result. Prefer SearchResult.kind for new code.',
);
/** Hub-search-hit-type value. */
export type HubSearchHitType = z.infer<typeof HubSearchHitType>;

/** One org-chipped, typed entity hit in the cross-org Hub search palette. */
export const HubSearchHit = z
  .object({
    organizationId: OrganizationId.describe(
      'The org the matched entity belongs to (org chip) — lets the palette label and route across tenants.',
    ),
    type: HubSearchHitType.describe('Whether the hit is a `task`, `project`, or `program`.'),
    id: z
      .string()
      .describe(
        "The matched entity's id (a TaskId/ProjectId/ProgramId depending on `type`), unique within its org.",
      ),
    title: z
      .string()
      .describe("The matched entity's display name/title (the field the query matched against)."),
  })
  .meta({ id: 'HubSearchHit', description: 'An org-chipped entity hit in Hub search.' });
/** Hub-search-hit value. */
export type HubSearchHit = z.infer<typeof HubSearchHit>;

/** The Hub `search` surface: cross-org, semantic workspace search results. */
export const HubSearchOut = SearchOut.meta({
  id: 'HubSearchOut',
  description: 'Cross-org semantic Hub search results.',
});
/** Hub-search value. */
export type HubSearchOut = z.infer<typeof HubSearchOut>;

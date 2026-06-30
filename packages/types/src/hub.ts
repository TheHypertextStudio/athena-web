/**
 * `@docket/types` — Hub aggregation slice DTOs.
 *
 * @remarks
 * The Hub is the caller's personal, cross-org command center. Its read surfaces
 * aggregate across every organization the session user is an active human Actor in,
 * returning org-chipped items (each carries its originating `organizationId`). These
 * are read-only projections composed from per-org work, notifications, agent sessions,
 * and daily-plan data; mutations happen on the underlying org-scoped or Hub-scoped
 * routers. Tenant data is never merged — each item is independently capability-filtered
 * and carries its own org chip.
 */
import { z } from 'zod';

import { AuditEventOut } from './activity';
import { Priority } from './capability';
import { NotificationOut } from './notification';
import { ActorId, MilestoneId, OrganizationId, ProgramId, ProjectId, TaskId } from './primitives';

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
    state: z
      .string()
      .describe(
        "The Task's current workflow state in its org (e.g. `todo`, `in_progress`, `done`). Free-form because each org can define its own states.",
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

/**
 * The Hub `today` surface: the three-pane cockpit for a date — the caller's daily-plan
 * tasks (`plan`), their timeboxed calendar blocks (`calendar`), and the cross-org
 * `needsAttention` trio (approvals, blocked, dueToday, inbox count).
 */
export const HubTodayOut = z
  .object({
    date: z
      .string()
      .describe(
        'The calendar day (ISO `YYYY-MM-DD`) this cockpit covers — echoes the requested `date`.',
      ),
    /** Tasks the caller pulled into Today via their daily plan, plus tasks due that date. */
    plan: z
      .array(HubTaskItem)
      .describe(
        "The day's task list: tasks the caller pulled into Today via their daily plan, plus tasks due that date, org-chipped.",
      ),
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
  .meta({ id: 'HubTodayOut', description: "The caller's cross-org Today cockpit for a day." });
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
export const HubSearchHitType = z
  .enum(['task', 'project', 'program'])
  .describe(
    'The entity kind of a Hub search hit: `task`, `project`, or `program`. Determines which icon and route the palette uses.',
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

/** The Hub `search` surface: cross-org, org-chipped, typed entity hits for a query. */
export const HubSearchOut = z
  .object({
    query: z
      .string()
      .describe(
        'The search query that was run (echoed back so the client can match responses to inputs).',
      ),
    results: z
      .array(HubSearchHit)
      .describe(
        "The org-chipped, typed entity hits matching the query across the caller's orgs, truncated to the requested `limit`. Empty when nothing matched or the caller has no memberships.",
      ),
  })
  .meta({ id: 'HubSearchOut', description: 'Cross-org Hub search results.' });
/** Hub-search value. */
export type HubSearchOut = z.infer<typeof HubSearchOut>;

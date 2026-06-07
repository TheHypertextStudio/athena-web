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
    id: OrganizationId,
    name: z.string(),
    slug: z.string(),
    avatar: z.string().nullable().optional(),
  })
  .meta({ id: 'OrgChip', description: 'The org label stamped onto an aggregated Hub item.' });
/** Org-chip value. */
export type OrgChip = z.infer<typeof OrgChip>;

/** A compact, org-chipped Task projection for Hub aggregations. */
export const HubTaskItem = z
  .object({
    id: TaskId,
    organizationId: OrganizationId,
    title: z.string(),
    state: z.string(),
    priority: Priority,
    assigneeId: ActorId.nullable().optional(),
    projectId: ProjectId.nullable().optional(),
    dueDate: z.string().nullable().optional(),
  })
  .meta({ id: 'HubTaskItem', description: 'An org-chipped task in a Hub aggregation.' });
/** Hub task-item value. */
export type HubTaskItem = z.infer<typeof HubTaskItem>;

/** A compact, org-chipped Project projection for the Hub portfolio. */
export const HubProjectItem = z
  .object({
    id: ProjectId,
    organizationId: OrganizationId,
    name: z.string(),
    status: z.string(),
    health: z.string().nullable().optional(),
    targetDate: z.string().nullable().optional(),
  })
  .meta({ id: 'HubProjectItem', description: 'An org-chipped project in the Hub portfolio.' });
/** Hub project-item value. */
export type HubProjectItem = z.infer<typeof HubProjectItem>;

/** The "needs attention" trio + inbox count surfaced at the top of the Hub Today cockpit. */
export const HubNeedsAttention = z
  .object({
    /** Agent sessions across the caller's orgs that are awaiting the caller's approval. */
    approvals: z.array(HubTaskItem),
    /** Tasks the caller is involved in that are blocked by an incomplete dependency. */
    blocked: z.array(HubTaskItem),
    /** Tasks due on the requested date, across the caller's orgs. */
    dueToday: z.array(HubTaskItem),
    /** Count of unread notifications across the caller's orgs. */
    inbox: z.number().int(),
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
    date: z.string(),
    /** Tasks the caller pulled into Today via their daily plan, plus tasks due that date. */
    plan: z.array(HubTaskItem),
    /** Daily-plan items with a timebox window, for the calendar pane. */
    calendar: z.array(
      z.object({
        taskId: TaskId,
        organizationId: OrganizationId,
        startsAt: z.string(),
        endsAt: z.string(),
      }),
    ),
    needsAttention: HubNeedsAttention,
  })
  .meta({ id: 'HubTodayOut', description: "The caller's cross-org Today cockpit for a day." });
/** Hub-today value. */
export type HubTodayOut = z.infer<typeof HubTodayOut>;

/** The Hub `inbox` surface: the caller's cross-org unread-first notification feed. */
export const HubInboxOut = z
  .object({
    items: z.array(NotificationOut),
  })
  .meta({ id: 'HubInboxOut', description: "The caller's cross-org notification inbox." });
/** Hub-inbox value. */
export type HubInboxOut = z.infer<typeof HubInboxOut>;

/** The Hub `activity` surface: the caller's cross-org passive-awareness audit feed. */
export const HubActivityOut = z
  .object({
    items: z.array(AuditEventOut),
    nextCursor: z.string().optional(),
    total: z.number().int().optional(),
  })
  .meta({ id: 'HubActivityOut', description: "The caller's cross-org activity feed." });
/** Hub-activity value. */
export type HubActivityOut = z.infer<typeof HubActivityOut>;

/** A dated checkpoint diamond on a Project bar in the portfolio timeline. */
export const HubMilestoneItem = z
  .object({
    id: MilestoneId,
    name: z.string(),
    targetDate: z.string().nullable().optional(),
  })
  .meta({ id: 'HubMilestoneItem', description: 'A milestone diamond on a portfolio bar.' });
/** Hub milestone-item value. */
export type HubMilestoneItem = z.infer<typeof HubMilestoneItem>;

/** A Project "bar" in a portfolio swimlane: its dates, health, and milestone diamonds. */
export const HubProjectBar = z
  .object({
    id: ProjectId,
    organizationId: OrganizationId,
    name: z.string(),
    status: z.string(),
    health: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    targetDate: z.string().nullable().optional(),
    milestones: z.array(HubMilestoneItem),
  })
  .meta({ id: 'HubProjectBar', description: 'A project bar in a portfolio swimlane.' });
/** Hub project-bar value. */
export type HubProjectBar = z.infer<typeof HubProjectBar>;

/** A Program "lane" within an org swimlane, containing its Project bars. */
export const HubProgramLane = z
  .object({
    program: z.object({
      id: ProgramId,
      organizationId: OrganizationId,
      name: z.string(),
      status: z.string(),
      health: z.string().nullable().optional(),
    }),
    projects: z.array(HubProjectBar),
  })
  .meta({ id: 'HubProgramLane', description: 'A program lane within an org swimlane.' });
/** Hub program-lane value. */
export type HubProgramLane = z.infer<typeof HubProgramLane>;

/** An org swimlane in the portfolio: its org chip → program lanes → project bars. */
export const HubPortfolioSwimlane = z
  .object({
    organization: OrgChip,
    programs: z.array(HubProgramLane),
    /** Projects in this org with no program (direct under the org), as bars. */
    unassigned: z.array(HubProjectBar),
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
    swimlanes: z.array(HubPortfolioSwimlane),
  })
  .meta({ id: 'HubPortfolioOut', description: "The caller's cross-org portfolio timeline." });
/** Hub-portfolio value. */
export type HubPortfolioOut = z.infer<typeof HubPortfolioOut>;

/** The entity kinds the cross-org Hub search can return. */
export const HubSearchHitType = z.enum(['task', 'project', 'program']);
/** Hub-search-hit-type value. */
export type HubSearchHitType = z.infer<typeof HubSearchHitType>;

/** One org-chipped, typed entity hit in the cross-org Hub search palette. */
export const HubSearchHit = z
  .object({
    organizationId: OrganizationId,
    type: HubSearchHitType,
    id: z.string(),
    title: z.string(),
  })
  .meta({ id: 'HubSearchHit', description: 'An org-chipped entity hit in Hub search.' });
/** Hub-search-hit value. */
export type HubSearchHit = z.infer<typeof HubSearchHit>;

/** The Hub `search` surface: cross-org, org-chipped, typed entity hits for a query. */
export const HubSearchOut = z
  .object({
    query: z.string(),
    results: z.array(HubSearchHit),
  })
  .meta({ id: 'HubSearchOut', description: 'Cross-org Hub search results.' });
/** Hub-search value. */
export type HubSearchOut = z.infer<typeof HubSearchOut>;

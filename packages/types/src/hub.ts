/**
 * `@docket/types` — Hub aggregation slice DTOs.
 *
 * @remarks
 * The Hub is the caller's personal, cross-org command center. Its read surfaces
 * aggregate across every organization the session user is a human Actor in, returning
 * org-chipped items (each carries its originating `organizationId`). These are
 * read-only projections composed from per-org work, notifications, and daily-plan
 * data; mutations happen on the underlying org-scoped or Hub-scoped routers.
 */
import { z } from 'zod';

import { Priority } from './capability';
import { NotificationOut } from './notification';
import { ActorId, OrganizationId, ProjectId, TaskId } from './primitives';

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

/** The Hub `today` surface: the caller's daily-plan-referenced + due tasks for a date. */
export const HubTodayOut = z
  .object({
    date: z.string(),
    tasks: z.array(HubTaskItem),
  })
  .meta({ id: 'HubTodayOut', description: "The caller's cross-org tasks for a day." });
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

/** The Hub `portfolio` surface: the caller's cross-org active projects. */
export const HubPortfolioOut = z
  .object({
    projects: z.array(HubProjectItem),
  })
  .meta({ id: 'HubPortfolioOut', description: "The caller's cross-org project portfolio." });
/** Hub-portfolio value. */
export type HubPortfolioOut = z.infer<typeof HubPortfolioOut>;

/** The Hub `search` surface: cross-org task + project hits for a query. */
export const HubSearchOut = z
  .object({
    query: z.string(),
    tasks: z.array(HubTaskItem),
    projects: z.array(HubProjectItem),
  })
  .meta({ id: 'HubSearchOut', description: 'Cross-org Hub search results.' });
/** Hub-search value. */
export type HubSearchOut = z.infer<typeof HubSearchOut>;

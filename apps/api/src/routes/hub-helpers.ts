import { actor, db } from '@docket/db';
import type {
  auditEvent,
  milestone,
  notification,
  organization,
  program,
  project,
  task,
} from '@docket/db';
import type {
  AuditEventOut,
  HubMilestoneItem,
  HubSearchHit,
  HubTaskItem,
  NotificationOut,
  OrgChip,
} from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { WorkStatusCategory } from '@docket/types';
import { loadStatusSets } from '../lib/work-status';

import { buildTaskViewFilter, type ViewableTaskParts } from './task-helpers';

/** TaskRow is the selected database row shape consumed by these API route serializers. */
export type TaskRow = typeof task.$inferSelect;
/** ProjectRow is the selected database row shape consumed by these API route serializers. */
export type ProjectRow = typeof project.$inferSelect;
/** ProgramRow is the selected database row shape consumed by these API route serializers. */
export type ProgramRow = typeof program.$inferSelect;
/** MilestoneRow is the selected database row shape consumed by these API route serializers. */
export type MilestoneRow = typeof milestone.$inferSelect;
/** OrgRow is the selected database row shape consumed by these API route serializers. */
export type OrgRow = typeof organization.$inferSelect;
/** NotificationRow is the selected database row shape consumed by these API route serializers. */
export type NotificationRow = typeof notification.$inferSelect;
/** AuditEventRow is the selected database row shape consumed by these API route serializers. */
export type AuditEventRow = typeof auditEvent.$inferSelect;

/** A current human membership used to make Hub-wide task visibility decisions. */
export interface ActiveCallerActor {
  readonly id: string;
  readonly organizationId: string;
}

/** One canonical task-view predicate for each organization in a Hub aggregation. */
export type HubTaskViewFilters = ReadonlyMap<string, (task: ViewableTaskParts) => boolean>;

/** IN_FLIGHT_PROJECT_STATES lists the statuses treated specially by this API route helper. */
export const IN_FLIGHT_PROJECT_STATES = ['planned', 'active'] as const;

/**
 * Resolve the status category of tasks drawn from several workspaces at once.
 *
 * @remarks
 * The Hub fans out across every workspace the reader belongs to, so a single status set cannot
 * answer for all of it. This groups the rows by workspace, resolves each workspace's task
 * statuses once — honouring any team that keeps its own — and returns a lookup the serializer can
 * use per row. The alternative, resolving per row, would be a query per task on a page that is
 * already a fan-out.
 *
 * @param rows - The task rows about to be serialized.
 * @returns the status category for each task id that resolves.
 */
export async function taskCategoriesFor(
  rows: readonly TaskRow[],
): Promise<ReadonlyMap<string, WorkStatusCategory>> {
  const byOrg = new Map<string, TaskRow[]>();
  for (const row of rows) {
    const bucket = byOrg.get(row.organizationId);
    if (bucket === undefined) byOrg.set(row.organizationId, [row]);
    else bucket.push(row);
  }
  const resolved = new Map<string, WorkStatusCategory>();
  await Promise.all(
    [...byOrg].map(async ([orgId, orgRows]) => {
      const sets = await loadStatusSets(orgId, {
        entityTypes: ['task'],
        teamIds: orgRows.map((row) => row.teamId),
      });
      for (const row of orgRows) {
        const category = sets.categoryOf(row.statusId);
        if (category !== undefined) resolved.set(row.id, category);
      }
    }),
  );
  return resolved;
}

/** Longest summary a Hub row carries. One line at a readable measure. */
const SUMMARY_MAX = 140;

/**
 * How much of a description the fallback ever inspects.
 *
 * @remarks
 * The result is capped at {@link SUMMARY_MAX}, so the lead sentence can only ever come from the
 * opening of the text — running ten passes over a whole multi-kilobyte document to produce 140
 * characters is work with no effect on the answer. A Hub read serializes well over a hundred tasks,
 * so this is the difference between scanning a paragraph per row and scanning a document per row.
 */
const SUMMARY_SCAN_MAX = 2_000;

/** Markdown syntax that carries no meaning once the text is one plain line. */
const MARKDOWN_NOISE: readonly (readonly [RegExp, string])[] = [
  [/```[\s\S]*?```/g, ' '], // fenced code
  [/`([^`]+)`/g, '$1'], // inline code
  [/!\[[^\]]*\]\([^)]*\)/g, ' '], // images
  [/\[([^\]]+)\]\([^)]*\)/g, '$1'], // links keep their text
  [/^\s{0,3}#{1,6}\s+.*$/gm, ' '], // headings: a label, not a summary — drop the whole line
  [/^\s{0,3}>\s?/gm, ''], // block quotes
  [/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, ''], // list markers
  [/\*\*([^*]+)\*\*/g, '$1'], // bold
  [/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1'], // italic
  [/^\s{0,3}(?:[-*_]\s*){3,}$/gm, ' '], // rules
];

/**
 * Reduce a Task description to the one line that tells someone what the task is.
 *
 * @remarks
 * This is the **fallback**, used only when `task.summary` is null. A written summary always wins;
 * this is what a row shows when nothing has produced one.
 *
 * A description's opening sentence is conventionally its statement of intent, so it is what a
 * person scanning a list needs; the rest is detail they open the task for. Truncating the raw body
 * at a character count instead cuts mid-word, and on a description that opens with a heading or a
 * checklist it returns punctuation rather than a sentence.
 *
 * Heading lines are dropped whole rather than unwrapped. A heading names a section; keeping its
 * text merely glued a label to the sentence after it ("Print review Check the fold registration…").
 *
 * Markdown is stripped first so the line reads as prose rather than as source. Generating a summary
 * here instead would mean a model call per row on a list endpoint, and would make the same row read
 * differently on each load; that belongs on the write path, which is why `task.summary` exists.
 *
 * @param description - The stored description, which may be Markdown and may be absent.
 * @returns one plain-text line, or null when the description holds no prose.
 */
function taskSummary(description: string | null): string | null {
  if (!description) return null;
  let text = description.slice(0, SUMMARY_SCAN_MAX);
  for (const [pattern, replacement] of MARKDOWN_NOISE) text = text.replace(pattern, replacement);
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return null;

  // The first sentence, when the text actually has sentence punctuation before the cap. The
  // following character must open a new sentence, because a bare "period then space" also matches
  // the inside of "e.g. rebuild the form" or "No. 4 press check" and would return the abbreviation
  // as the whole summary. A match of only a word or two is rejected for the same reason.
  const sentence = /^(.+?[.!?])(?:\s+(?=[A-Z0-9"'([])|$)/.exec(flat.slice(0, SUMMARY_MAX + 40));
  const lead = sentence?.[1];
  if (lead && lead.length <= SUMMARY_MAX && lead.split(' ').length >= 4) return lead;

  if (flat.length <= SUMMARY_MAX) return flat;
  // Otherwise cut on a word boundary rather than mid-word.
  const clipped = flat.slice(0, SUMMARY_MAX);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > SUMMARY_MAX * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/**
 * toTaskItem converts internal API route data into the public API response shape.
 *
 * @remarks
 * The Hub gathers work from every workspace the reader belongs to, each naming its own statuses,
 * so the status *category* travels with the row. A reader of a Hub item has no single workspace
 * whose statuses it could look the key up in.
 *
 * @param t - The task row.
 * @param stateType - The category of the task's status, resolved by the caller in bulk.
 * @returns the serialized Hub task item.
 */
export function toTaskItem(t: TaskRow, stateType: WorkStatusCategory): z.input<typeof HubTaskItem> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    summary: t.summary ?? taskSummary(t.description),
    state: t.state,
    stateType,
    priority: t.priority,
    assigneeId: t.assigneeId,
    projectId: t.projectId,
    dueDate: t.dueDate?.toISOString() ?? null,
  };
}

/** toNotificationOut converts internal API route data into the public API response shape. */
export function toNotificationOut(n: NotificationRow): z.input<typeof NotificationOut> {
  return {
    id: n.id,
    userId: n.userId,
    organizationId: n.organizationId,
    type: n.type,
    body: n.body,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** toAuditEventOut converts internal API route data into the public API response shape. */
export function toAuditEventOut(e: AuditEventRow): z.input<typeof AuditEventOut> {
  return {
    id: e.id,
    organizationId: e.organizationId,
    actorId: e.actorId,
    initiatorId: e.initiatorId,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    type: e.type,
    metadata: e.metadata,
    createdAt: e.createdAt.toISOString(),
  };
}

/** toOrgChip converts internal API route data into the public API response shape. */
export function toOrgChip(o: OrgRow): z.input<typeof OrgChip> {
  return { id: o.id, name: o.name, slug: o.slug, avatar: o.avatar };
}

/** toMilestoneItem converts internal API route data into the public API response shape. */
export function toMilestoneItem(m: MilestoneRow): z.input<typeof HubMilestoneItem> {
  return {
    id: m.id,
    name: m.name,
    targetDate: m.targetDate?.toISOString() ?? null,
  };
}

/** toSearchHit converts internal API route data into the public API response shape. */
export function toSearchHit(
  organizationId: string,
  type: z.input<typeof HubSearchHit>['type'],
  id: string,
  title: string,
): z.input<typeof HubSearchHit> {
  return { organizationId, type, id, title };
}

/** Resolve the user's active, unarchived human memberships for Hub aggregations. */
export async function activeCallerActors(userId: string): Promise<ActiveCallerActor[]> {
  return db
    .select({ id: actor.id, organizationId: actor.organizationId })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
}

/** The org ids the user is an active, unarchived human Actor in (their cross-org scope). */
export async function callerOrgIds(userId: string): Promise<string[]> {
  return (await activeCallerActors(userId)).map((actor) => actor.organizationId);
}

/** The caller's active, unarchived human Actor ids (one per org), for assigned-to-me filters. */
export async function callerActorIds(userId: string): Promise<string[]> {
  return (await activeCallerActors(userId)).map((actor) => actor.id);
}

/**
 * Build one canonical task-view predicate per active Hub membership.
 *
 * The predicates are intentionally shared across whole result sets: resolving grants once per
 * org prevents task-by-task authorization queries while keeping every Hub pane on the same rule.
 */
export async function buildHubTaskViewFilters(
  actors: readonly ActiveCallerActor[],
): Promise<HubTaskViewFilters> {
  return new Map(
    await Promise.all(
      actors.map(
        async (actor) =>
          [
            actor.organizationId,
            await buildTaskViewFilter(actor.organizationId, actor.id),
          ] as const,
      ),
    ),
  );
}

/** Keep only task rows that pass their owning organization's prebuilt Hub view predicate. */
export function filterViewableHubTasks<T extends ViewableTaskParts & { organizationId: string }>(
  tasks: readonly T[],
  filters: HubTaskViewFilters,
): T[] {
  return tasks.filter((task) => filters.get(task.organizationId)?.(task) ?? false);
}

/** Whether an ISO timestamp string falls on the given `YYYY-MM-DD` UTC date. */
export function sameDay(iso: string | null | undefined, date: string): boolean {
  if (!iso) return false;
  return iso.slice(0, 10) === date;
}

/** Group rows by a derived key into a Map preserving insertion order. */
export function groupBy<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

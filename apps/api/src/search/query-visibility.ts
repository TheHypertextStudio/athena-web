/**
 * `@docket/api` — permission-filtered visibility for search documents.
 *
 * @remarks
 * `filterVisibleRows` is the single most dangerous thing in the search module to duplicate — a
 * second copy would be a cross-tenant leak that nothing type-checks and that reads as correct in
 * review. Every other module in `search/` that needs to know what a caller may see imports it
 * from here rather than reimplementing it.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { searchDocument } from '@docket/db';

import {
  resourceAccessKey,
  resolveResourceAccess,
  type ResourceAccessRef,
  type ResourceAccessResult,
} from '../permissions/resource-access';
import type { SearchCaller, SearchDocumentRow } from './query-types';

/**
 * The `search_document` WHERE-clause fragment bounding candidate rows to ones this caller could
 * possibly see: personally owned, or in one of their accessible orgs.
 *
 * @remarks
 * This only narrows what the database fetches — it is not the permission check itself. Real
 * visibility (grants, event recipients, private-row ownership) is enforced afterward, in
 * application code, by {@link filterVisibleRows}. An agent caller (no owning user) reaches org
 * documents only; an empty candidate set is the correct answer for one with no accessible orgs,
 * not a reason to widen the predicate.
 */
export function documentVisibilityCondition(
  table: typeof searchDocument,
  ownerUserId: string | null,
  orgIds: readonly string[],
) {
  const ownedByCaller = ownerUserId ? eq(table.userId, ownerUserId) : undefined;
  return orgIds.length > 0
    ? or(inArray(table.organizationId, [...orgIds]), ownedByCaller)
    : (ownedByCaller ?? sql`false`);
}

/** One org the caller can act in, and the Actor/role identity every grant check reads from. */
export interface CallerOrgAccess {
  organizationId: string;
  actorId: string;
  roleId: string | null;
  isGuest: boolean;
}

/** The visibility mode a `search_document` row carries, read from its `visibility` JSON column. */
export type SearchVisibility =
  | { mode: 'org_members' }
  | { mode: 'user_private' }
  | { mode: 'grantable'; subjectKind?: unknown; subjectId?: unknown }
  | { mode: 'event'; subjectKind?: unknown; subjectId?: unknown };

/**
 * Resolve the caller's per-org Actor rows, which carry the role every grant check reads from.
 *
 * @remarks
 * A user resolves to one active human Actor per org they belong to. An agent resolves to exactly
 * one Actor — its own — in exactly one org, so an agent's search can never reach beyond the
 * workspace it was created in.
 *
 * @param caller - The searching principal.
 * @returns one access record per org the caller can act in.
 */
export async function resolveCallerAccess(caller: SearchCaller): Promise<CallerOrgAccess[]> {
  const schema = await import('@docket/db');
  const identity =
    caller.kind === 'user'
      ? and(eq(schema.actor.userId, caller.userId), eq(schema.actor.kind, 'human'))
      : and(
          eq(schema.actor.id, caller.actorId),
          eq(schema.actor.organizationId, caller.organizationId),
        );
  const rows = await schema.db
    .select({
      organizationId: schema.actor.organizationId,
      actorId: schema.actor.id,
      roleId: schema.actor.roleId,
      roleKey: schema.role.key,
      roleDefaultVisibility: schema.role.defaultVisibility,
    })
    .from(schema.actor)
    .leftJoin(
      schema.role,
      and(
        eq(schema.actor.roleId, schema.role.id),
        eq(schema.actor.organizationId, schema.role.organizationId),
      ),
    )
    .where(and(identity, eq(schema.actor.status, 'active')));
  return rows.map((row) => ({
    organizationId: row.organizationId,
    actorId: row.actorId,
    roleId: row.roleId,
    isGuest: row.roleKey === 'guest' || row.roleDefaultVisibility === 'private',
  }));
}

/** Keep only the rows this caller may see, resolving grants and event-recipient status in bulk. */
export async function filterVisibleRows(
  rows: readonly SearchDocumentRow[],
  caller: { ownerUserId: string | null; accessByOrg: ReadonlyMap<string, CallerOrgAccess> },
): Promise<{ rows: SearchDocumentRow[]; recipientEventIds: ReadonlySet<string> }> {
  const subjectRefs = new Map<string, ResourceAccessRef>();
  const eventIds: string[] = [];

  for (const row of rows) {
    const visibility = readVisibility(row.visibility);
    if (visibility.mode === 'event') eventIds.push(row.entityId);
    const subject = visibilitySubject(row, visibility);
    if (subject) subjectRefs.set(resourceAccessKey(subject), subject);
  }

  // Grant resolution and recipient fan-out both key off the caller's own user id but read
  // otherwise-independent tables, so they run concurrently rather than as two sequential round
  // trips. An agent caller has no personal grants or recipient fan-out to resolve — it reaches
  // grantable resources through `org_members` and its own actor scope instead.
  const [subjectAccess, recipientEventIds]: [
    ReadonlyMap<string, ResourceAccessResult>,
    ReadonlySet<string>,
  ] = caller.ownerUserId
    ? await Promise.all([
        resolveResourceAccess(caller.ownerUserId, [...subjectRefs.values()]),
        loadRecipientEventIds(caller.ownerUserId, eventIds),
      ])
    : [new Map(), new Set()];

  const visibleRows = rows.filter((row) => {
    const visibility = readVisibility(row.visibility);
    switch (visibility.mode) {
      // Guard the null caller explicitly: a row with no owner must not match an ownerless
      // caller by both sides being nullish.
      case 'user_private':
        return caller.ownerUserId !== null && row.userId === caller.ownerUserId;
      case 'org_members':
        return Boolean(row.organizationId && caller.accessByOrg.has(row.organizationId));
      case 'grantable': {
        const subject = visibilitySubject(row, visibility);
        return subject ? (subjectAccess.get(resourceAccessKey(subject))?.canView ?? false) : false;
      }
      case 'event': {
        if (recipientEventIds.has(row.entityId)) return true;
        const subject = visibilitySubject(row, visibility);
        if (subject) return subjectAccess.get(resourceAccessKey(subject))?.canView ?? false;
        if (row.userId) return row.userId === caller.ownerUserId;
        return Boolean(row.organizationId && caller.accessByOrg.has(row.organizationId));
      }
    }
  });
  return { rows: visibleRows, recipientEventIds };
}

function readVisibility(value: unknown): SearchVisibility {
  if (typeof value === 'object' && value !== null && 'mode' in value) {
    const mode = (value as { mode?: unknown }).mode;
    if (
      mode === 'org_members' ||
      mode === 'user_private' ||
      mode === 'grantable' ||
      mode === 'event'
    ) {
      return value as SearchVisibility;
    }
  }
  return { mode: 'org_members' };
}

function visibilitySubject(
  row: SearchDocumentRow,
  visibility: SearchVisibility,
): ResourceAccessRef | null {
  if (!row.organizationId) return null;
  const subjectKind =
    visibility.mode === 'grantable' || visibility.mode === 'event'
      ? visibility.subjectKind
      : undefined;
  const subjectId =
    visibility.mode === 'grantable' || visibility.mode === 'event'
      ? visibility.subjectId
      : undefined;
  const kind = typeof subjectKind === 'string' ? subjectKind : row.subjectKind;
  const id = typeof subjectId === 'string' ? subjectId : row.subjectId;
  return kind && id ? { organizationId: row.organizationId, kind, id } : null;
}

async function loadRecipientEventIds(
  userId: string,
  eventIds: readonly string[],
): Promise<Set<string>> {
  const uniqueEventIds = [...new Set(eventIds)];
  if (uniqueEventIds.length === 0) return new Set();
  const schema = await import('@docket/db');
  const rows = await schema.db
    .select({ eventId: schema.eventRecipient.eventId })
    .from(schema.eventRecipient)
    .where(
      and(
        eq(schema.eventRecipient.userId, userId),
        inArray(schema.eventRecipient.eventId, uniqueEventIds),
      ),
    );
  return new Set(rows.map((row) => row.eventId));
}

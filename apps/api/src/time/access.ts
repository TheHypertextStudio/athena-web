/**
 * `time/access` — ownership, target validation, and context-redaction policy.
 *
 * @remarks
 * Time is Hub-owned, but its links may point into many organizations. Keeping this policy outside
 * command and projection code prevents a new ledger feature from accidentally treating an
 * organization membership check as permanent read permission.
 */
import {
  actor,
  calendarItem,
  cycle,
  db,
  hub,
  initiative,
  organization,
  program,
  project,
  task,
  timeCategory,
} from '@docket/db';
import type { timeContext } from '@docket/db';
import type {
  EntityRef,
  TimeAllocationReplace,
  TimeContextCreate,
  TimeRecordCreate,
} from '@docket/types';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { ConflictError, NotFoundError } from '../error';

/** One launch context with the trusted organization scope resolved at write time. */
export interface PreparedTimeContext {
  readonly role: TimeContextCreate['role'];
  readonly entityRef: EntityRef;
  readonly organizationId: string | null;
}

/** Resolve the authenticated user's personal Hub. */
export async function resolveTimeHubId(userId: string): Promise<string> {
  const rows = await db.select({ id: hub.id }).from(hub).where(eq(hub.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Hub not found');
  return row.id;
}

/** Require a category to be owned by the caller's Hub. */
export async function assertOwnedTimeCategory(
  categoryId: string | null | undefined,
  hubId: string,
): Promise<void> {
  if (!categoryId) return;
  const rows = await db
    .select({ id: timeCategory.id })
    .from(timeCategory)
    .where(and(eq(timeCategory.id, categoryId), eq(timeCategory.hubId, hubId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Time category not found');
}

/** Resolve an active human actor for a user in one organization. */
async function actorForUser(userId: string, organizationId: string) {
  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.organizationId, organizationId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Prove the caller has active membership in a workspace without revealing another tenant. */
export async function assertOrganizationReadable(
  userId: string,
  organizationId: string,
): Promise<void> {
  if (!(await actorForUser(userId, organizationId))) {
    throw new NotFoundError('Workspace context not found');
  }
}

/** Resolve a Docket context to an organization and establish initial read access. */
async function resolveDocketContextOrganization(
  userId: string,
  entityRef: EntityRef,
): Promise<string | null> {
  if (entityRef.source !== 'docket') return null;
  const id = entityRef.docketEntityId ?? entityRef.externalId;
  let organizationId: string | null = null;
  switch (entityRef.kind) {
    case 'work_item': {
      const rows = await db
        .select({ organizationId: task.organizationId })
        .from(task)
        .where(eq(task.id, id))
        .limit(1);
      organizationId = rows[0]?.organizationId ?? null;
      break;
    }
    case 'project': {
      const rows = await db
        .select({ organizationId: project.organizationId })
        .from(project)
        .where(eq(project.id, id))
        .limit(1);
      organizationId = rows[0]?.organizationId ?? null;
      break;
    }
    case 'program': {
      const rows = await db
        .select({ organizationId: program.organizationId })
        .from(program)
        .where(eq(program.id, id))
        .limit(1);
      organizationId = rows[0]?.organizationId ?? null;
      break;
    }
    case 'initiative': {
      const rows = await db
        .select({ organizationId: initiative.organizationId })
        .from(initiative)
        .where(eq(initiative.id, id))
        .limit(1);
      organizationId = rows[0]?.organizationId ?? null;
      break;
    }
    case 'cycle': {
      const rows = await db
        .select({ organizationId: cycle.organizationId })
        .from(cycle)
        .where(eq(cycle.id, id))
        .limit(1);
      organizationId = rows[0]?.organizationId ?? null;
      break;
    }
    case 'organization': {
      const rows = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, id))
        .limit(1);
      organizationId = rows[0]?.id ?? null;
      break;
    }
    case 'calendar_event': {
      const rows = await db
        .select({ id: calendarItem.id })
        .from(calendarItem)
        .where(and(eq(calendarItem.id, id), eq(calendarItem.userId, userId)))
        .limit(1);
      if (!rows[0]) throw new NotFoundError('Calendar context not found');
      return null;
    }
    case 'thread':
    case 'message':
    case 'document':
    case 'person':
      throw new NotFoundError('Time context not found');
  }
  if (!organizationId) throw new NotFoundError('Time context not found');
  await assertOrganizationReadable(userId, organizationId);
  return organizationId;
}

/** Validate a context mutation and return the trusted scope persisted with it. */
export async function validateTimeContext(
  userId: string,
  input: TimeContextCreate,
): Promise<string | null> {
  const referenceOrganizationId = await resolveDocketContextOrganization(userId, input.entityRef);
  if (
    input.organizationId &&
    referenceOrganizationId &&
    input.organizationId !== referenceOrganizationId
  ) {
    throw new ConflictError('Time context workspace does not match its referenced item');
  }
  const organizationId = input.organizationId ?? referenceOrganizationId;
  if (organizationId) await assertOrganizationReadable(userId, organizationId);
  return organizationId;
}

/** Validate every TrackableContext relation before a live command can switch the tracker. */
export async function prepareInitialTimeContexts(
  userId: string,
  input: z.input<typeof TimeRecordCreate>['context'],
): Promise<PreparedTimeContext[]> {
  const contexts: TimeContextCreate[] = [];
  if (input.primaryRef) contexts.push({ role: 'primary', entityRef: input.primaryRef });
  if (input.workspaceRef) contexts.push({ role: 'related', entityRef: input.workspaceRef });
  for (const entityRef of input.contextualRefs ?? []) {
    contexts.push({ role: 'related', entityRef });
  }
  return Promise.all(
    contexts.map(async (context) => ({
      role: context.role,
      entityRef: context.entityRef,
      organizationId: await validateTimeContext(userId, context),
    })),
  );
}

/** Validate one allocation target and return the target's canonical scope. */
export async function validateTimeAllocationTarget(
  userId: string,
  hubId: string,
  allocation: TimeAllocationReplace['allocations'][number],
): Promise<string | null> {
  let organizationId: string | null = null;
  switch (allocation.targetKind) {
    case 'workspace':
      await assertOrganizationReadable(userId, allocation.targetId);
      organizationId = allocation.targetId;
      break;
    case 'task': {
      const rows = await db
        .select({ organizationId: task.organizationId })
        .from(task)
        .where(eq(task.id, allocation.targetId))
        .limit(1);
      organizationId = rows[0]?.organizationId ?? null;
      break;
    }
    case 'project': {
      const rows = await db
        .select({ organizationId: project.organizationId })
        .from(project)
        .where(eq(project.id, allocation.targetId))
        .limit(1);
      organizationId = rows[0]?.organizationId ?? null;
      break;
    }
    case 'category':
      await assertOwnedTimeCategory(allocation.targetId, hubId);
      if (allocation.organizationId) {
        throw new ConflictError('Personal category allocations cannot name a workspace');
      }
      return null;
  }
  if (!organizationId) throw new NotFoundError('Allocation target not found');
  await assertOrganizationReadable(userId, organizationId);
  if (allocation.organizationId && allocation.organizationId !== organizationId) {
    throw new ConflictError('Allocation workspace does not match its target');
  }
  return organizationId;
}

/** Check current access to one persisted Docket context before returning its snapshots. */
export async function canReadTimeContext(
  userId: string,
  context: typeof timeContext.$inferSelect,
): Promise<boolean> {
  if (context.sourceSystem !== 'docket') return true;
  const id = context.docketEntityId ?? context.externalId;
  if (context.entityKind === 'calendar_event') {
    const rows = await db
      .select({ id: calendarItem.id })
      .from(calendarItem)
      .where(and(eq(calendarItem.id, id), eq(calendarItem.userId, userId)))
      .limit(1);
    return Boolean(rows[0]);
  }
  if (!context.organizationId) return false;
  // Time Ledger records are personal: the only reader here is their creator. An active human
  // membership is therefore the current access boundary for the stored organization snapshot.
  // If membership is revoked, the caller keeps the duration fact but loses the identifying link.
  return Boolean(await actorForUser(userId, context.organizationId));
}

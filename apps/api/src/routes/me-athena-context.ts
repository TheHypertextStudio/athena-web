/** Invocation-context validation for the caller-owned Athena API. */
import { canActor, type ResourceKind } from '@docket/authz';
import {
  actor,
  calendarItem,
  calendarItemTaskLink,
  calendarLayerShare,
  db,
  event,
  eventRecipient,
  initiative,
  program,
  project,
  task,
} from '@docket/db';
import type { AthenaInvocationContext } from '@docket/types';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { z } from 'zod';

import { NotFoundError } from '../error';

/** A normalized invocation plus the caller's current Actor in its workspace. */
export interface ResolvedAthenaInvocation {
  /** Validated invocation focus persisted with the first user activity. */
  readonly context: z.input<typeof AthenaInvocationContext> | null;
  /** Active human Actor for the resolved workspace, or null for neutral work. */
  readonly actorId: string | null;
}

/** Load the caller's active human Actor in a workspace, hiding membership failures. */
export async function activeAthenaActor(userId: string, workspaceId: string): Promise<string> {
  const rows = await db
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.organizationId, workspaceId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Workspace not found');
  return rows[0].id;
}

/** Resolve one workspace-owned source row and verify resource-level view access. */
async function workSourceWorkspace(
  userId: string,
  type: Extract<ResourceKind, 'task' | 'project' | 'initiative' | 'program'>,
  id: string,
): Promise<{ readonly workspaceId: string; readonly actorId: string }> {
  const rows =
    type === 'task'
      ? await db
          .select({ workspaceId: task.organizationId })
          .from(task)
          .where(and(eq(task.id, id), isNull(task.archivedAt)))
          .limit(1)
      : type === 'project'
        ? await db
            .select({ workspaceId: project.organizationId })
            .from(project)
            .where(and(eq(project.id, id), isNull(project.archivedAt)))
            .limit(1)
        : type === 'initiative'
          ? await db
              .select({ workspaceId: initiative.organizationId })
              .from(initiative)
              .where(and(eq(initiative.id, id), isNull(initiative.archivedAt)))
              .limit(1)
          : await db
              .select({ workspaceId: program.organizationId })
              .from(program)
              .where(and(eq(program.id, id), isNull(program.archivedAt)))
              .limit(1);
  const workspaceId = rows[0]?.workspaceId;
  if (!workspaceId) throw new NotFoundError('Source not found');
  const actorId = await activeAthenaActor(userId, workspaceId);
  const access = await canActor(actorId, 'view', { kind: type, id, orgId: workspaceId }, db);
  if (!access.allow) throw new NotFoundError('Source not found');
  return { workspaceId, actorId };
}

/** Resolve a caller-owned calendar item to one stated or unambiguous shared workspace. */
async function calendarSourceWorkspace(
  userId: string,
  id: string,
  statedWorkspaceId?: string,
): Promise<{ readonly workspaceId: string; readonly actorId: string }> {
  const items = await db
    .select({ layerId: calendarItem.layerId })
    .from(calendarItem)
    .where(and(eq(calendarItem.id, id), eq(calendarItem.userId, userId)))
    .limit(1);
  const item = items[0];
  if (!item) throw new NotFoundError('Source not found');

  const linked = await db
    .select({ workspaceId: calendarItemTaskLink.organizationId })
    .from(calendarItemTaskLink)
    .where(eq(calendarItemTaskLink.calendarItemId, id));
  const shared = await db
    .select({ workspaceId: calendarLayerShare.organizationId })
    .from(calendarLayerShare)
    .where(eq(calendarLayerShare.layerId, item.layerId));
  const candidates = [...new Set([...linked, ...shared].map((row) => row.workspaceId))];
  const workspaceId = statedWorkspaceId ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!workspaceId || !candidates.includes(workspaceId))
    throw new NotFoundError('Source not found');
  return { workspaceId, actorId: await activeAthenaActor(userId, workspaceId) };
}

/** Resolve a personal Stream event that concerns the caller. */
async function streamSourceWorkspace(
  userId: string,
  id: string,
): Promise<{ readonly workspaceId: string; readonly actorId: string }> {
  const rows = await db
    .selectDistinct({ workspaceId: event.organizationId })
    .from(event)
    .leftJoin(
      eventRecipient,
      and(eq(eventRecipient.eventId, event.id), eq(eventRecipient.userId, userId)),
    )
    .where(
      and(
        eq(event.id, id),
        isNull(event.archivedAt),
        or(eq(event.userId, userId), eq(eventRecipient.userId, userId)),
      ),
    )
    .limit(1);
  const workspaceId = rows[0]?.workspaceId;
  if (!workspaceId) throw new NotFoundError('Source not found');
  return { workspaceId, actorId: await activeAthenaActor(userId, workspaceId) };
}

/**
 * Validate optional Athena invocation focus without turning it into authorization.
 *
 * @remarks
 * A source is loaded from its canonical table, any supplied workspace must match, and the caller
 * must currently have an active human Actor there. Later tools repeat their own authorization;
 * this resolver only protects contextual attribution at creation/refocus time.
 */
export async function resolveAthenaInvocation(
  userId: string,
  input?: z.input<typeof AthenaInvocationContext>,
): Promise<ResolvedAthenaInvocation> {
  if (!input) return { context: null, actorId: null };
  if (!input.source) {
    const workspaceId = input.workspaceId;
    if (!workspaceId) return { context: null, actorId: null };
    return {
      context: { workspaceId },
      actorId: await activeAthenaActor(userId, workspaceId),
    };
  }

  const resolved =
    input.source.type === 'calendar_item'
      ? await calendarSourceWorkspace(userId, input.source.id, input.workspaceId)
      : input.source.type === 'stream_event'
        ? await streamSourceWorkspace(userId, input.source.id)
        : await workSourceWorkspace(userId, input.source.type, input.source.id);
  if (input.workspaceId && input.workspaceId !== resolved.workspaceId) {
    throw new NotFoundError('Source not found');
  }
  return {
    context: { workspaceId: resolved.workspaceId, source: input.source },
    actorId: resolved.actorId,
  };
}

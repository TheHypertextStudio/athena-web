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
  organization,
  program,
  project,
  task,
} from '@docket/db';
import type {
  AthenaInvocationContext,
  AthenaInvocationContextOut,
  AthenaWorkspaceOut,
} from '@docket/types';
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

/** Owner-safe display metadata for one persisted personal-Athena invocation. */
export interface ResolvedAthenaDisplay {
  /** Persisted focus enriched with a canonical or safe generic source label. */
  readonly context: z.input<typeof AthenaInvocationContextOut> | null;
  /** Canonical workspace metadata only while the owner retains current access. */
  readonly workspace: z.input<typeof AthenaWorkspaceOut> | null;
}

const SOURCE_KIND_LABELS = {
  task: 'Task',
  project: 'Project',
  initiative: 'Initiative',
  program: 'Program',
  calendar_item: 'Calendar item',
  stream_event: 'Stream event',
} as const;

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

/** Load a canonical label after the invocation resolver has rechecked owner access. */
async function sourceDisplayLabel(
  userId: string,
  source: z.input<typeof AthenaInvocationContext>['source'] & {},
): Promise<string | null> {
  const rows =
    source.type === 'task'
      ? await db
          .select({ label: task.title })
          .from(task)
          .where(and(eq(task.id, source.id), isNull(task.archivedAt)))
          .limit(1)
      : source.type === 'project'
        ? await db
            .select({ label: project.name })
            .from(project)
            .where(and(eq(project.id, source.id), isNull(project.archivedAt)))
            .limit(1)
        : source.type === 'initiative'
          ? await db
              .select({ label: initiative.name })
              .from(initiative)
              .where(and(eq(initiative.id, source.id), isNull(initiative.archivedAt)))
              .limit(1)
          : source.type === 'program'
            ? await db
                .select({ label: program.name })
                .from(program)
                .where(and(eq(program.id, source.id), isNull(program.archivedAt)))
                .limit(1)
            : source.type === 'calendar_item'
              ? await db
                  .select({ label: calendarItem.title })
                  .from(calendarItem)
                  .where(and(eq(calendarItem.id, source.id), eq(calendarItem.userId, userId)))
                  .limit(1)
              : await db
                  .select({ label: event.title })
                  .from(event)
                  .where(and(eq(event.id, source.id), isNull(event.archivedAt)))
                  .limit(1);
  return rows[0]?.label ?? null;
}

/**
 * Resolve current canonical display metadata without making old personal work disappear.
 *
 * @remarks
 * The existing invocation resolver remains the authority for checking current membership and
 * source visibility. If that check now fails, reads retain only previously persisted ids plus a
 * generic source-kind label; canonical workspace/source names are never loaded or disclosed.
 */
export async function resolveAthenaDisplay(
  userId: string,
  input: z.input<typeof AthenaInvocationContext> | null,
): Promise<ResolvedAthenaDisplay> {
  if (!input) return { context: null, workspace: null };
  try {
    const resolved = await resolveAthenaInvocation(userId, input);
    const context = resolved.context;
    if (!context) return { context: null, workspace: null };
    const workspaceRows = context.workspaceId
      ? await db
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(and(eq(organization.id, context.workspaceId), isNull(organization.archivedAt)))
          .limit(1)
      : [];
    const source = context.source;
    const label = source ? await sourceDisplayLabel(userId, source) : null;
    // Authorization may be revoked while canonical names are being loaded. Re-resolve at the
    // disclosure boundary so a stale successful check can never release those names.
    const finalAuthorization = await resolveAthenaInvocation(userId, input);
    if (
      finalAuthorization.context?.workspaceId !== context.workspaceId ||
      finalAuthorization.context?.source?.type !== context.source?.type ||
      finalAuthorization.context?.source?.id !== context.source?.id
    ) {
      throw new NotFoundError('Source not found');
    }
    return {
      context: {
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
        ...(source
          ? {
              source: {
                ...source,
                label: label ?? SOURCE_KIND_LABELS[source.type],
              },
            }
          : {}),
      },
      workspace: workspaceRows[0] ?? null,
    };
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    return {
      context: {
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.source
          ? {
              source: {
                ...input.source,
                label: SOURCE_KIND_LABELS[input.source.type],
              },
            }
          : {}),
      },
      workspace: null,
    };
  }
}

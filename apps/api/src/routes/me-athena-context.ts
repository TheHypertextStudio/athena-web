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
  grant,
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
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
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

type InvocationContext = z.input<typeof AthenaInvocationContext>;
type WorkSourceType = Extract<ResourceKind, 'task' | 'project' | 'initiative' | 'program'>;

interface BatchedActor {
  readonly id: string;
  readonly roleId: string | null;
  readonly workspaceId: string;
  readonly workspaceName: string;
}

interface BatchedWorkSource {
  readonly id: string;
  readonly type: WorkSourceType;
  readonly workspaceId: string;
  readonly label: string;
  readonly ancestors: readonly { readonly kind: ResourceKind; readonly id: string }[];
}

interface BatchedDisplaySnapshot {
  readonly allowed: boolean;
  readonly display: ResolvedAthenaDisplay;
}

/** Stable key for deduplicating persisted invocation contexts in one overview read. */
function contextKey(input: InvocationContext | null): string {
  return JSON.stringify(input);
}

/** Return the generic historical projection used whenever current access cannot be proven. */
function historicalDisplay(input: InvocationContext): ResolvedAthenaDisplay {
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

/** Load work-source labels and containment ancestors in one query per represented source kind. */
async function batchedWorkSources(
  contexts: readonly InvocationContext[],
): Promise<ReadonlyMap<string, BatchedWorkSource>> {
  const idsFor = (type: NonNullable<InvocationContext['source']>['type']): string[] =>
    contexts.flatMap((context) => (context.source?.type === type ? [context.source.id] : []));
  const taskIds = idsFor('task');
  const projectIds = idsFor('project');
  const initiativeIds = idsFor('initiative');
  const programIds = idsFor('program');
  const [tasks, projects, initiatives, programs] = await Promise.all([
    taskIds.length > 0
      ? db
          .select({
            id: task.id,
            workspaceId: task.organizationId,
            label: task.title,
            teamId: task.teamId,
            projectId: task.projectId,
            programId: task.programId,
          })
          .from(task)
          .where(and(inArray(task.id, taskIds), isNull(task.archivedAt)))
      : [],
    projectIds.length > 0
      ? db
          .select({
            id: project.id,
            workspaceId: project.organizationId,
            label: project.name,
            teamId: project.teamId,
            programId: project.programId,
          })
          .from(project)
          .where(and(inArray(project.id, projectIds), isNull(project.archivedAt)))
      : [],
    initiativeIds.length > 0
      ? db
          .select({
            id: initiative.id,
            workspaceId: initiative.organizationId,
            label: initiative.name,
          })
          .from(initiative)
          .where(and(inArray(initiative.id, initiativeIds), isNull(initiative.archivedAt)))
      : [],
    programIds.length > 0
      ? db
          .select({ id: program.id, workspaceId: program.organizationId, label: program.name })
          .from(program)
          .where(and(inArray(program.id, programIds), isNull(program.archivedAt)))
      : [],
  ]);
  const sources = new Map<string, BatchedWorkSource>();
  for (const row of tasks) {
    sources.set(`task:${row.id}`, {
      id: row.id,
      type: 'task',
      workspaceId: row.workspaceId,
      label: row.label,
      ancestors: [
        { kind: 'task', id: row.id },
        { kind: 'team', id: row.teamId },
        ...(row.projectId ? [{ kind: 'project' as const, id: row.projectId }] : []),
        ...(row.programId ? [{ kind: 'program' as const, id: row.programId }] : []),
        { kind: 'organization', id: row.workspaceId },
      ],
    });
  }
  for (const row of projects) {
    sources.set(`project:${row.id}`, {
      id: row.id,
      type: 'project',
      workspaceId: row.workspaceId,
      label: row.label,
      ancestors: [
        { kind: 'project', id: row.id },
        ...(row.teamId ? [{ kind: 'team' as const, id: row.teamId }] : []),
        ...(row.programId ? [{ kind: 'program' as const, id: row.programId }] : []),
        { kind: 'organization', id: row.workspaceId },
      ],
    });
  }
  for (const row of initiatives) {
    sources.set(`initiative:${row.id}`, {
      ...row,
      type: 'initiative',
      ancestors: [
        { kind: 'initiative', id: row.id },
        { kind: 'organization', id: row.workspaceId },
      ],
    });
  }
  for (const row of programs) {
    sources.set(`program:${row.id}`, {
      ...row,
      type: 'program',
      ancestors: [
        { kind: 'program', id: row.id },
        { kind: 'organization', id: row.workspaceId },
      ],
    });
  }
  return sources;
}

/** Load a fixed-query authorization and label snapshot for a set of distinct contexts. */
async function batchedDisplaySnapshot(
  userId: string,
  contexts: readonly InvocationContext[],
): Promise<ReadonlyMap<string, BatchedDisplaySnapshot>> {
  const workspaceIds = [
    ...new Set(contexts.map((context) => context.workspaceId).filter((id): id is string => !!id)),
  ];
  const calendarIds = contexts.flatMap((context) =>
    context.source?.type === 'calendar_item' ? [context.source.id] : [],
  );
  const streamIds = contexts.flatMap((context) =>
    context.source?.type === 'stream_event' ? [context.source.id] : [],
  );
  const [
    actorRows,
    workSources,
    calendarItems,
    calendarLinks,
    calendarShares,
    streamEvents,
    recipients,
  ] = await Promise.all([
    workspaceIds.length > 0
      ? db
          .select({
            id: actor.id,
            roleId: actor.roleId,
            workspaceId: actor.organizationId,
            workspaceName: organization.name,
          })
          .from(actor)
          .innerJoin(organization, eq(organization.id, actor.organizationId))
          .where(
            and(
              eq(actor.userId, userId),
              eq(actor.kind, 'human'),
              eq(actor.status, 'active'),
              isNull(actor.archivedAt),
              isNull(organization.archivedAt),
              inArray(actor.organizationId, workspaceIds),
            ),
          )
      : [],
    batchedWorkSources(contexts),
    calendarIds.length > 0
      ? db
          .select({ id: calendarItem.id, layerId: calendarItem.layerId, label: calendarItem.title })
          .from(calendarItem)
          .where(
            and(
              inArray(calendarItem.id, calendarIds),
              eq(calendarItem.userId, userId),
              isNull(calendarItem.archivedAt),
            ),
          )
      : [],
    calendarIds.length > 0
      ? db
          .select({
            id: calendarItemTaskLink.calendarItemId,
            workspaceId: calendarItemTaskLink.organizationId,
          })
          .from(calendarItemTaskLink)
          .where(inArray(calendarItemTaskLink.calendarItemId, calendarIds))
      : [],
    calendarIds.length > 0
      ? db
          .select({ id: calendarItem.id, workspaceId: calendarLayerShare.organizationId })
          .from(calendarItem)
          .innerJoin(calendarLayerShare, eq(calendarLayerShare.layerId, calendarItem.layerId))
          .where(and(inArray(calendarItem.id, calendarIds), eq(calendarItem.userId, userId)))
      : [],
    streamIds.length > 0
      ? db
          .select({
            id: event.id,
            workspaceId: event.organizationId,
            userId: event.userId,
            label: event.title,
          })
          .from(event)
          .where(and(inArray(event.id, streamIds), isNull(event.archivedAt)))
      : [],
    streamIds.length > 0
      ? db
          .select({ id: eventRecipient.eventId })
          .from(eventRecipient)
          .where(and(inArray(eventRecipient.eventId, streamIds), eq(eventRecipient.userId, userId)))
      : [],
  ]);
  const actors = new Map(actorRows.map((row) => [row.workspaceId, row satisfies BatchedActor]));
  const workSourceValues = [...workSources.values()];
  const subjects = [
    ...new Set(actorRows.flatMap((row) => [row.id, ...(row.roleId ? [row.roleId] : [])])),
  ];
  const resourceIds = [
    ...new Set(workSourceValues.flatMap((source) => source.ancestors.map((row) => row.id))),
  ];
  const grants =
    subjects.length > 0 && resourceIds.length > 0
      ? await db
          .select()
          .from(grant)
          .where(and(inArray(grant.subjectId, subjects), inArray(grant.resourceId, resourceIds)))
      : [];
  const calendarById = new Map(calendarItems.map((row) => [row.id, row]));
  const streamById = new Map(streamEvents.map((row) => [row.id, row]));
  const recipientIds = new Set(recipients.map((row) => row.id));
  const snapshots = new Map<string, BatchedDisplaySnapshot>();
  const now = Date.now();
  for (const context of contexts) {
    const workspaceId = context.workspaceId;
    const currentActor = workspaceId ? actors.get(workspaceId) : undefined;
    let allowed = !!currentActor;
    let label: string | null = null;
    const source = context.source;
    if (allowed && source && workspaceId) {
      if (
        source.type === 'task' ||
        source.type === 'project' ||
        source.type === 'initiative' ||
        source.type === 'program'
      ) {
        const workSource = workSources.get(`${source.type}:${source.id}`);
        allowed = workSource?.workspaceId === workspaceId;
        label = workSource?.label ?? null;
        if (allowed && workSource && currentActor) {
          const subjectsForActor = new Set(
            [currentActor.id, currentActor.roleId].filter((id): id is string => !!id),
          );
          allowed = grants.some(
            (row) =>
              row.organizationId === workspaceId &&
              subjectsForActor.has(row.subjectId) &&
              row.effect === 'allow' &&
              (!row.expiresAt || row.expiresAt.getTime() >= now) &&
              row.capabilities.length > 0 &&
              workSource.ancestors.some(
                (ancestor) => ancestor.kind === row.resourceKind && ancestor.id === row.resourceId,
              ),
          );
        }
      } else if (source.type === 'calendar_item') {
        const item = calendarById.get(source.id);
        const candidateWorkspaces = new Set([
          ...calendarLinks.filter((row) => row.id === source.id).map((row) => row.workspaceId),
          ...calendarShares.filter((row) => row.id === source.id).map((row) => row.workspaceId),
        ]);
        allowed = !!item && candidateWorkspaces.has(workspaceId);
        label = item?.label ?? null;
      } else {
        const streamEvent = streamById.get(source.id);
        allowed =
          streamEvent?.workspaceId === workspaceId &&
          (streamEvent.userId === userId || recipientIds.has(source.id));
        label = streamEvent?.label ?? null;
      }
    }
    snapshots.set(contextKey(context), {
      allowed,
      display: allowed
        ? {
            context: {
              ...(workspaceId ? { workspaceId } : {}),
              ...(source
                ? { source: { ...source, label: label ?? SOURCE_KIND_LABELS[source.type] } }
                : {}),
            },
            workspace: currentActor
              ? { id: currentActor.workspaceId, name: currentActor.workspaceName }
              : null,
          }
        : historicalDisplay(context),
    });
  }
  return snapshots;
}

/** Resolve many overview contexts with fixed-query metadata and authorization batches. */
export async function resolveAthenaDisplays(
  userId: string,
  inputs: readonly (InvocationContext | null)[],
): Promise<readonly ResolvedAthenaDisplay[]> {
  const contexts = [
    ...new Map(
      inputs
        .filter((input): input is InvocationContext => !!input)
        .map((input) => [contextKey(input), input]),
    ).values(),
  ];
  const initial = await batchedDisplaySnapshot(userId, contexts);
  // Re-read every authorization input after canonical labels have loaded. This is the batched
  // disclosure-boundary check that closes the same revocation window as resolveAthenaDisplay.
  const finalAuthorization = await batchedDisplaySnapshot(userId, contexts);
  return inputs.map((input) => {
    if (!input) return { context: null, workspace: null };
    const key = contextKey(input);
    const first = initial.get(key);
    const final = finalAuthorization.get(key);
    return first?.allowed && final?.allowed ? first.display : historicalDisplay(input);
  });
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

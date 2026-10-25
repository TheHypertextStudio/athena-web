/** Resolve agent identity artwork from stored metadata, never from display-name guesses. */
import { actor, agent, agentSession, db, oauthClient, type ChangeOrigin } from '@docket/db';
import { and, eq, inArray, or } from 'drizzle-orm';
import { readOrigin } from '@docket/work/provenance-contract';
import { taskCreationEntryId } from '@docket/work/task-model';
import type { ActivityEntry, ActivitySources } from './task-activity-entries';

interface IconReference {
  readonly actorId: string | null;
  readonly clientId: string | null;
  readonly sessionId: string | null;
}

/** External work-session keys are opaque and must never be treated as native session ids. */
function nativeSessionId(origin: ChangeOrigin | null): string | null {
  if (origin?.agentSessionId) return origin.agentSessionId;
  return readOrigin(origin)?.channel === 'athena' ? (origin?.sessionId ?? null) : null;
}

/** Read only performer identity; an authorizing person's avatar is not an agent icon. */
function reference(origin: ChangeOrigin | null): IconReference {
  const value = readOrigin(origin);
  return {
    actorId: value?.performer.actorId ?? null,
    clientId: origin?.clientId ?? value?.client?.id ?? null,
    sessionId: nativeSessionId(origin),
  };
}

/**
 * Match stored identity references to the existing public activity ids.
 * @param sources - Authorized source records already selected for this task.
 * @param taskId - Task owning the creation activity.
 * @param createdOrigin - Creation's stored provenance.
 * @returns Performer, client and native-session references by activity id.
 */
export function taskActivityReferences(
  sources: ActivitySources,
  taskId: string,
  createdOrigin: ChangeOrigin | null,
): Map<string, IconReference> {
  const result = new Map<string, IconReference>([
    [taskCreationEntryId(taskId), reference(createdOrigin)],
  ]);
  const sets = [
    ['audit:', sources.directLedger],
    ['child:', sources.childLedger],
    ['dependency:', sources.blockerLedger],
    ['comment:', sources.comments],
  ] as const;
  for (const [prefix, rows] of sets) {
    for (const row of rows) result.set(`${prefix}${row.id}`, reference(row.origin));
  }
  for (const row of sources.taskSessions) {
    result.set(`session:${row.id}`, { actorId: null, clientId: null, sessionId: row.sessionId });
  }
  return result;
}

/** Batch-read registered native performers within this workspace context. */
async function nativeIcons(ids: string[], orgId: string): Promise<Map<string, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: agentSession.id, icon: actor.avatar })
    .from(agentSession)
    .innerJoin(agent, eq(agent.id, agentSession.agentId))
    .innerJoin(
      actor,
      and(eq(actor.id, agent.actorId), eq(actor.organizationId, orgId), eq(actor.kind, 'agent')),
    )
    .where(
      and(
        inArray(agentSession.id, ids),
        or(eq(agentSession.organizationId, orgId), eq(agentSession.contextOrganizationId, orgId)),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.icon]));
}

/**
 * Resolve a page's images in bounded batches after visibility, filtering and pagination.
 * @param entries - The authorized, filtered page; identity and ordering remain unchanged.
 * @param sources - Stored source records owning each entry's performer and client identity.
 * @param orgId - Workspace boundary for registered agent artwork.
 * @param created - Creation provenance, resolved by the task's existing source lookup.
 * @returns The same activity records with optional identity artwork from stored metadata.
 */
export async function withTaskActivityAgentIcons(
  entries: ActivityEntry[],
  sources: ActivitySources,
  orgId: string,
  created: { readonly taskId: string; readonly origin: ChangeOrigin | null },
): Promise<ActivityEntry[]> {
  const byEntry = taskActivityReferences(sources, created.taskId, created.origin);
  const eligible = entries.filter(
    (entry) =>
      entry.origin?.performerKind === 'agent' ||
      entry.origin?.performerKind === 'athena' ||
      (!entry.origin && Boolean(entry.actorId)),
  );
  const pageRefs = new Map(
    eligible.map((entry) => {
      const stored = byEntry.get(entry.id);
      const ref: IconReference = {
        actorId: stored?.actorId ?? (!entry.origin ? (entry.actorId ?? null) : null),
        clientId: stored?.clientId ?? null,
        sessionId: stored?.sessionId ?? null,
      };
      return [entry.id, ref] as const;
    }),
  );
  const refs = [...pageRefs.values()];
  const actorIds = [...new Set(refs.flatMap((ref) => (ref.actorId ? [ref.actorId] : [])))];
  const clientIds = [...new Set(refs.flatMap((ref) => (ref.clientId ? [ref.clientId] : [])))];
  const sessionIds = [...new Set(refs.flatMap((ref) => (ref.sessionId ? [ref.sessionId] : [])))];
  const [actors, clients, sessions] = await Promise.all([
    actorIds.length
      ? db
          .select({ id: actor.id, icon: actor.avatar })
          .from(actor)
          .where(
            and(
              inArray(actor.id, actorIds),
              eq(actor.organizationId, orgId),
              eq(actor.kind, 'agent'),
            ),
          )
      : [],
    clientIds.length
      ? db
          .select({ id: oauthClient.clientId, icon: oauthClient.icon })
          .from(oauthClient)
          .where(inArray(oauthClient.clientId, clientIds))
      : [],
    nativeIcons(sessionIds, orgId),
  ]);
  const actorIcons = new Map(actors.map((row) => [row.id, row.icon]));
  const clientIcons = new Map(clients.map((row) => [row.id, row.icon]));
  const result = new Map<string, string>();
  for (const entry of eligible) {
    const ref = pageRefs.get(entry.id);
    if (!ref) continue;
    const icon = [
      sessions.get(ref.sessionId ?? ''),
      actorIcons.get(ref.actorId ?? ''),
      clientIcons.get(ref.clientId ?? ''),
    ].find((candidate) => Boolean(candidate));
    if (icon) result.set(entry.id, icon);
  }
  return entries.map((entry) => {
    const knownAgent = !entry.origin && entry.actorId && actorIcons.has(entry.actorId);
    const icon = result.get(entry.id);
    return knownAgent || icon
      ? {
          ...entry,
          ...(knownAgent ? { actorKind: 'agent' as const } : {}),
          ...(icon ? { agentIconUrl: icon } : {}),
        }
      : entry;
  });
}

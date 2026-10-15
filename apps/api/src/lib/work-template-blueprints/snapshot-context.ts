import { actor, cycle, hub, organization, workStatus, workTypeVersion } from '@docket/db';
import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { CycleId } from '@docket/work/ids';
import {
  completionCivilDate,
  BlueprintError,
  type BlueprintCreationContext,
  type ExistingBlueprintNode,
} from '@docket/work/blueprints';
import { WorkingWeekdays } from '@docket/work/work-template-blueprint';
import { and, eq, inArray, or } from 'drizzle-orm';
import { NotFoundError } from '../../error';
import { DEFAULT_AGENT_NAME } from '../default-agent';
import type { TemplateTransaction } from '../templates/persistence';
import type { BlueprintSnapshotCaller } from './snapshot-access';
import type { BlueprintSnapshotRow } from './snapshot-types';

/** Load exact immutable source identity and live status categories in bounded batches. */
export async function snapshotMetadata(
  tx: TemplateTransaction,
  orgId: string,
  rows: readonly BlueprintSnapshotRow[],
) {
  const statusIds = rows.flatMap(({ work }) =>
    work.kind === 'milestone' ? [] : [work.row.statusId],
  );
  const versionIds = rows.flatMap(({ work }) =>
    work.row.blueprintSourceVersionId ? [work.row.blueprintSourceVersionId] : [],
  );
  const statuses = statusIds.length
    ? await tx
        .select()
        .from(workStatus)
        .where(and(eq(workStatus.organizationId, orgId), inArray(workStatus.id, statusIds)))
    : [];
  const versions = versionIds.length
    ? await tx
        .select()
        .from(workTypeVersion)
        .where(
          and(eq(workTypeVersion.organizationId, orgId), inArray(workTypeVersion.id, versionIds)),
        )
    : [];
  return {
    categories: new Map(statuses.map((row) => [row.id, row.category])),
    sourceTypes: new Map(versions.map((row) => [row.id, row.workTypeId])),
  };
}
function timezone(value: string | undefined): string {
  if (!value) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return value;
  } catch {
    return 'UTC';
  }
}
function existingSnapshotNode(
  nodes: readonly ExistingBlueprintNode[],
  index: number,
): ExistingBlueprintNode {
  const node = nodes[index];
  if (!node) throw new BlueprintError('blueprint_invalid', 'Missing completion snapshot.');
  return node;
}
function snapshotCompletions(
  rows: readonly BlueprintSnapshotRow[],
  nodes: readonly ExistingBlueprintNode[],
): BlueprintCreationContext['completions'] {
  return rows.flatMap(({ work }, index) =>
    work.kind === 'task'
      ? [
          {
            id: work.id,
            path: existingSnapshotNode(nodes, index).path,
            state: work.row.completedAt
              ? ('completed' as const)
              : work.row.canceledAt
                ? ('canceled' as const)
                : ('open' as const),
            completedAt: work.row.completedAt ? work.row.completedAt.toISOString() : null,
          },
        ]
      : [],
  );
}
async function snapshotActors(
  tx: TemplateTransaction,
  caller: BlueprintSnapshotCaller,
  nodes: readonly ExistingBlueprintNode[],
) {
  const actorIds = [
    ...new Set(
      [caller.actor?.actorId, ...nodes.map((node) => node.responsibleActorId)].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  return tx
    .select({ actor, preferences: hub.preferences })
    .from(actor)
    .leftJoin(hub, eq(hub.userId, actor.userId))
    .where(
      and(
        eq(actor.organizationId, caller.orgId),
        or(
          inArray(actor.id, actorIds),
          and(eq(actor.kind, 'agent'), eq(actor.displayName, DEFAULT_AGENT_NAME)),
        ),
      ),
    );
}
async function snapshotCycles(
  tx: TemplateTransaction,
  orgId: string,
  nodes: readonly ExistingBlueprintNode[],
): Promise<BlueprintCreationContext['cycles']> {
  const teamIds = [...new Set(nodes.flatMap((node) => (node.teamId ? [node.teamId] : [])))];
  if (!teamIds.length) return [];
  const cycles = await tx
    .select()
    .from(cycle)
    .where(and(eq(cycle.organizationId, orgId), inArray(cycle.teamId, teamIds)));
  return cycles.map((entry) => ({
    id: CycleId.parse(entry.id),
    organizationId: OrganizationId.parse(orgId),
    teamId: TeamId.parse(entry.teamId),
    startDate: entry.startsAt.toISOString().slice(0, 10),
    endDate: entry.endsAt.toISOString().slice(0, 10),
    archived: entry.archivedAt !== null,
    closed: entry.status === 'completed',
  }));
}
/** Current workspace calendar and actual completion instants in the generation's saved timezone. */
export async function snapshotContext(
  tx: TemplateTransaction,
  caller: BlueprintSnapshotCaller,
  rows: readonly BlueprintSnapshotRow[],
  nodes: readonly ExistingBlueprintNode[],
  now: Date,
): Promise<BlueprintCreationContext> {
  const [org] = await tx
    .select({ days: organization.workingWeekdays })
    .from(organization)
    .where(eq(organization.id, caller.orgId))
    .limit(1);
  if (!org) throw new NotFoundError('Workspace not found');
  const actors = await snapshotActors(tx, caller, nodes);
  const athena = actors.find(
    ({ actor: entry }) =>
      entry.kind === 'agent' &&
      entry.displayName === DEFAULT_AGENT_NAME &&
      entry.status === 'active' &&
      entry.archivedAt === null,
  );
  const savedTimezone = rows[0]?.work.row.blueprintState?.creationTimezone;
  const creator = actors.find(({ actor: entry }) => entry.id === caller.actor?.actorId);
  const zone = timezone(savedTimezone ?? creator?.preferences?.timezone);
  return {
    organizationId: OrganizationId.parse(caller.orgId),
    initiatingActorId: caller.actor ? ActorId.parse(caller.actor.actorId) : null,
    actors: actors.map(({ actor: entry }) => ({
      id: ActorId.parse(entry.id),
      active: entry.status === 'active' && entry.archivedAt === null,
    })),
    athenaActorId: athena ? ActorId.parse(athena.actor.id) : null,
    creationTeamId: nodes[0]?.teamId ?? null,
    creationDate: completionCivilDate(now.toISOString(), zone),
    timezone: zone,
    workingWeekdays: WorkingWeekdays.parse(org.days),
    ...(caller.retained ? { runDate: caller.retained.runDate } : {}),
    cycles: await snapshotCycles(tx, caller.orgId, nodes),
    completions: snapshotCompletions(rows, nodes),
  };
}

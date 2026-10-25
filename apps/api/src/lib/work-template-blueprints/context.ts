import {
  actor,
  agent,
  cycle,
  hub,
  initiative,
  milestone,
  organization,
  program,
  project,
  role,
  task,
  team,
} from '@docket/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { satisfies } from '@docket/authz';
import { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import { CycleId } from '@docket/work/ids';
import {
  BlueprintError,
  completionCivilDate,
  type BlueprintCreationContext,
  type ResolvedRootDraft,
} from '@docket/work/blueprints';
import { WorkingWeekdays } from '@docket/work/work-template-blueprint';
import { CapabilityError, NotFoundError } from '../../error';
import {
  resolveResourceAccessForActors,
  resourceAccessKey,
  type ResourceAccessRef,
} from '../../permissions/resource-access';
import { DEFAULT_AGENT_NAME } from '../default-agent';
import type { TemplateTransaction } from '../templates/persistence';
import { prospectiveWorkReference } from '../work-creation/ordinary-prospective';
import type {
  OrdinaryPreparationContext,
  ProspectiveWorkReference,
  OrdinaryWorkCommand,
} from '../work-creation/types';

/** Authorized calendar/rule snapshot plus the most restrictive concrete creation scope. */
export interface AuthorizedBlueprintCreationContext extends BlueprintCreationContext {
  readonly visibility: 'public' | 'private';
}
interface CreationActor {
  readonly id: string;
  readonly kind: string;
  readonly roleId: string | null;
  readonly roleKey: string | null;
  readonly roleVisibility: 'public' | 'private' | null;
  readonly timezone: string | undefined;
}
type ParentKind = 'initiative' | 'program' | 'project' | 'task' | 'milestone';
interface ParentRef {
  readonly kind: ParentKind;
  readonly id: string;
}
interface ParentSnapshot {
  readonly visibility: 'public' | 'private';
  readonly parents: readonly ParentRef[];
  readonly access: ParentRef | null;
}
function scheduleTeamIds(command: OrdinaryWorkCommand): TeamId[] {
  return (command.invocation.scheduleContext?.draft.stepOverrides ?? []).flatMap((entry) =>
    'teamId' in entry && entry.teamId ? [entry.teamId] : [],
  );
}
function scheduleActorIds(command: OrdinaryWorkCommand): string[] {
  return (command.invocation.scheduleContext?.draft.stepOverrides ?? []).flatMap((entry) =>
    'responsibleActorId' in entry && entry.responsibleActorId ? [entry.responsibleActorId] : [],
  );
}

/**
 * Freeze live tenant, authority, calendar and relative-rule facts on the caller's transaction.
 * @param now - One captured server instant; trusted callers may supply it for deterministic previews.
 * @throws {NotFoundError} For unavailable tenant references or inaccessible placement.
 * @throws {CapabilityError} For placement without contribute access.
 */
export async function loadBlueprintCreationContext(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  root: ResolvedRootDraft,
  now: Date = new Date(),
  prospective?: OrdinaryPreparationContext,
): Promise<AuthorizedBlueprintCreationContext> {
  const orgId = command.caller.orgId;
  prospectiveWorkReference(
    tx,
    command,
    prospective,
    command.kind,
    command.invocation.prospectiveWorkId,
  );
  const [org] = await tx
    .select({ weekdays: organization.workingWeekdays })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  if (!org) throw new NotFoundError('Workspace not found');
  const creator = await loadCreator(tx, orgId, command.caller.actorId);
  const athenaActorId = await loadAthena(tx, orgId);
  const creationTeamId =
    command.blueprint?.creationTeamId ?? command.body.blueprint?.creationTeamId ?? root.teamId;
  const teamIds = [
    ...new Set(
      [root.teamId, creationTeamId, ...scheduleTeamIds(command)].filter(
        (id): id is TeamId => id !== null,
      ),
    ),
  ];
  const teamRefs = await liveTeamRefs(tx, orgId, teamIds);
  const placement = await loadPlacement(tx, command, root, prospective);
  await assertContextAccess(tx, orgId, creator, placement.access, teamRefs);
  const timezone = validTimezone(creator?.timezone);
  const ids = [
    command.caller.actorId,
    root.responsibleActorId,
    athenaActorId,
    ...scheduleActorIds(command),
  ].filter((id): id is string => id !== null);
  return {
    organizationId: OrganizationId.parse(orgId),
    initiatingActorId:
      command.caller.actorId === null ? null : ActorId.parse(command.caller.actorId),
    actors: await loadActorSnapshots(tx, orgId, ids),
    athenaActorId,
    creationTeamId,
    creationDate: completionCivilDate(now.toISOString(), timezone),
    timezone,
    workingWeekdays: WorkingWeekdays.parse(org.weekdays),
    cycles: await loadCycleSnapshots(tx, orgId, teamIds),
    completions: [],
    visibility: creationVisibility(
      command,
      root,
      placement.private || prospective?.rootVisibility === 'private',
    ),
  };
}
function validTimezone(timezone: string | undefined): string {
  if (!timezone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0);
    return timezone;
  } catch {
    return 'UTC';
  }
}

/** Capture the live creator planning timezone using the ordinary work creation policy. */
export async function currentBlueprintPlanningTimezone(
  tx: TemplateTransaction,
  organizationId: string,
  actorId: string,
): Promise<string> {
  return validTimezone((await loadCreator(tx, organizationId, actorId))?.timezone);
}

/** Validate live team availability and caller visibility for newly created nodes, preserving existing rows separately. */
export async function validateBlueprintCreationTeams(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  ids: readonly TeamId[],
): Promise<void> {
  const teams = await liveTeamRefs(tx, command.caller.orgId, [...new Set(ids)]);
  const creator = await loadCreator(tx, command.caller.orgId, command.caller.actorId);
  await assertContextAccess(tx, command.caller.orgId, creator, [], teams);
}
async function loadCreator(
  tx: TemplateTransaction,
  orgId: string,
  id: string | null,
): Promise<CreationActor | null> {
  if (id === null) return null; // Existing recurrence authority is verified by the mutation owner.
  const [row] = await tx
    .select({
      id: actor.id,
      kind: actor.kind,
      roleId: actor.roleId,
      roleKey: role.key,
      roleVisibility: role.defaultVisibility,
      preferences: hub.preferences,
    })
    .from(actor)
    .leftJoin(role, and(eq(actor.roleId, role.id), eq(role.organizationId, orgId)))
    .leftJoin(hub, eq(actor.userId, hub.userId))
    .where(
      and(
        eq(actor.id, id),
        eq(actor.organizationId, orgId),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Workspace not found');
  return { ...row, timezone: row.preferences?.timezone };
}
async function loadAthena(tx: TemplateTransaction, orgId: string): Promise<ActorId | null> {
  const [row] = await tx
    .select({ id: actor.id })
    .from(agent)
    .innerJoin(actor, and(eq(agent.actorId, actor.id), eq(actor.organizationId, orgId)))
    .where(
      and(
        eq(agent.organizationId, orgId),
        eq(actor.kind, 'agent'),
        eq(actor.displayName, DEFAULT_AGENT_NAME),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
        isNull(agent.archivedAt),
      ),
    )
    .orderBy(asc(agent.createdAt), asc(agent.id))
    .limit(1);
  return row ? ActorId.parse(row.id) : null;
}
async function loadActorSnapshots(
  tx: TemplateTransaction,
  orgId: string,
  ids: readonly string[],
): Promise<BlueprintCreationContext['actors']> {
  if (!ids.length) return [];
  const rows = await tx
    .select({ id: actor.id, status: actor.status, archivedAt: actor.archivedAt })
    .from(actor)
    .where(and(eq(actor.organizationId, orgId), inArray(actor.id, [...new Set(ids)])))
    .orderBy(asc(actor.id));
  return rows.map((row) => ({
    id: ActorId.parse(row.id),
    active: row.status === 'active' && row.archivedAt === null,
  }));
}
async function liveTeamRefs(
  tx: TemplateTransaction,
  orgId: string,
  ids: readonly TeamId[],
): Promise<ResourceAccessRef[]> {
  if (!ids.length) return [];
  const rows = await tx
    .select({ id: team.id })
    .from(team)
    .where(
      and(eq(team.organizationId, orgId), inArray(team.id, [...ids]), isNull(team.archivedAt)),
    );
  if (rows.length !== ids.length) throw new NotFoundError('Team not found');
  return ids.map((id) => ({ organizationId: orgId, kind: 'team', id }));
}
async function loadCycleSnapshots(
  tx: TemplateTransaction,
  orgId: string,
  ids: readonly TeamId[],
): Promise<BlueprintCreationContext['cycles']> {
  if (!ids.length) return [];
  const rows = await tx
    .select({
      id: cycle.id,
      teamId: cycle.teamId,
      startsAt: cycle.startsAt,
      endsAt: cycle.endsAt,
      status: cycle.status,
      archivedAt: cycle.archivedAt,
    })
    .from(cycle)
    .where(and(eq(cycle.organizationId, orgId), inArray(cycle.teamId, [...ids])))
    .orderBy(asc(cycle.id));
  return rows.map((row) => ({
    id: CycleId.parse(row.id),
    organizationId: OrganizationId.parse(orgId),
    teamId: TeamId.parse(row.teamId),
    startDate: row.startsAt.toISOString().slice(0, 10),
    endDate: row.endsAt.toISOString().slice(0, 10),
    archived: row.archivedAt !== null,
    closed: row.status === 'completed',
  }));
}
function initialParents(root: ResolvedRootDraft): ParentRef[] {
  const placement = root.placement ?? {};
  const fields = [
    ['initiative', placement.initiativeId],
    ['program', placement.programId],
    ['project', placement.projectId],
    ['task', placement.parentTaskId],
    ['milestone', placement.milestoneId],
  ] as const;
  return fields.flatMap(([kind, id]) => (id ? [{ kind, id }] : []));
}
async function loadPlacement(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  root: ResolvedRootDraft,
  prospective: OrdinaryPreparationContext | undefined,
): Promise<{ private: boolean; access: ResourceAccessRef[] }> {
  const orgId = command.caller.orgId;
  const pending = initialParents(root);
  const direct = new Set(pending.map((ref) => `${ref.kind}:${ref.id}`));
  const seen = new Set<string>();
  const access: ResourceAccessRef[] = [];
  let privateScope = false;
  while (pending.length) {
    const ref = pending.pop();
    if (!ref) break;
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    if (seen.size >= 1000)
      throw new BlueprintError(
        'blueprint_limit',
        'Existing placement ancestry exceeds the review limit.',
      );
    seen.add(key);
    const row = await readParent(tx, command, ref, prospective);
    privateScope ||= row.visibility === 'private';
    if (direct.has(key) && row.access) access.push({ organizationId: orgId, ...row.access });
    pending.push(...row.parents);
  }
  return { private: privateScope, access };
}
async function readLiveParent(
  tx: TemplateTransaction,
  orgId: string,
  ref: ParentRef,
): Promise<ParentSnapshot> {
  switch (ref.kind) {
    case 'project':
      return readProjectParent(tx, orgId, ref);
    case 'task':
      return readTaskParent(tx, orgId, ref);
    case 'program': {
      const [row] = await tx
        .select({ visibility: program.visibility })
        .from(program)
        .where(
          and(
            eq(program.id, ref.id),
            eq(program.organizationId, orgId),
            isNull(program.archivedAt),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundError('Placement not found');
      return { ...row, parents: [], access: ref };
    }
    case 'initiative': {
      const [row] = await tx
        .select({ id: initiative.id })
        .from(initiative)
        .where(
          and(
            eq(initiative.id, ref.id),
            eq(initiative.organizationId, orgId),
            isNull(initiative.archivedAt),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundError('Placement not found');
      return { visibility: 'public', parents: [], access: ref };
    }
    case 'milestone': {
      const [row] = await tx
        .select({ projectId: milestone.projectId })
        .from(milestone)
        .where(
          and(
            eq(milestone.id, ref.id),
            eq(milestone.organizationId, orgId),
            isNull(milestone.archivedAt),
          ),
        )
        .limit(1);
      if (!row) throw new NotFoundError('Placement not found');
      const parent: ParentRef = { kind: 'project', id: row.projectId };
      return { visibility: 'public', parents: [parent], access: parent };
    }
  }
}
async function readProjectParent(
  tx: TemplateTransaction,
  orgId: string,
  ref: ParentRef,
): Promise<ParentSnapshot> {
  const [row] = await tx
    .select({ visibility: project.visibility, programId: project.programId })
    .from(project)
    .where(
      and(eq(project.id, ref.id), eq(project.organizationId, orgId), isNull(project.archivedAt)),
    )
    .limit(1);
  if (!row) throw new NotFoundError('Placement not found');
  return {
    visibility: row.visibility,
    parents: row.programId ? [{ kind: 'program', id: row.programId }] : [],
    access: ref,
  };
}
async function readTaskParent(
  tx: TemplateTransaction,
  orgId: string,
  ref: ParentRef,
): Promise<ParentSnapshot> {
  const [row] = await tx
    .select({
      visibility: task.visibility,
      programId: task.programId,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId,
    })
    .from(task)
    .where(and(eq(task.id, ref.id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
  if (!row) throw new NotFoundError('Placement not found');
  const fields = [
    ['program', row.programId],
    ['project', row.projectId],
    ['task', row.parentTaskId],
  ] as const;
  return {
    visibility: row.visibility,
    parents: fields.flatMap(([kind, id]) => (id ? [{ kind, id }] : [])),
    access: ref,
  };
}
async function assertContextAccess(
  tx: TemplateTransaction,
  orgId: string,
  creator: CreationActor | null,
  parents: readonly ResourceAccessRef[],
  teams: readonly ResourceAccessRef[],
): Promise<void> {
  if (!creator) return; // The mutation owner checked the retained recurrence binding on this tx.
  const refs = [
    ...new Map([...parents, ...teams].map((ref) => [resourceAccessKey(ref), ref])).values(),
  ];
  if (!refs.length) return;
  const accesses = await resolveResourceAccessForActors(
    [
      {
        organizationId: orgId,
        actorId: creator.id,
        roleId: creator.roleId,
        isGuest:
          creator.kind !== 'human' ||
          creator.roleKey === 'guest' ||
          creator.roleVisibility === 'private',
      },
    ],
    refs,
    tx,
  );
  const writable = new Set(parents.map(resourceAccessKey));
  for (const ref of refs) {
    const access = accesses.get(resourceAccessKey(ref));
    if (!access?.canView || access.effectiveCapability === null)
      throw new NotFoundError('Placement not found');
    if (
      writable.has(resourceAccessKey(ref)) &&
      !satisfies(access.effectiveCapability, 'contribute')
    )
      throw new CapabilityError();
  }
}

function creationVisibility(
  command: OrdinaryWorkCommand,
  root: ResolvedRootDraft,
  privatePlacement: boolean,
): 'public' | 'private' {
  return privatePlacement ||
    command.invocation.placement?.visibility === 'private' ||
    (root.kind === 'program' && root.fields.visibility === 'private')
    ? 'private'
    : 'public';
}

async function readParent(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  ref: ParentRef,
  context: OrdinaryPreparationContext | undefined,
): Promise<ParentSnapshot> {
  const prospective = prospectiveWorkReference(tx, command, context, ref.kind, ref.id);
  return prospective
    ? prospectiveParent(prospective)
    : readLiveParent(tx, command.caller.orgId, ref);
}
function prospectiveParent(row: ProspectiveWorkReference): ParentSnapshot {
  const parents: ParentRef[] = [];
  if (row.kind === 'milestone') parents.push({ kind: 'project', id: row.projectId });
  if ((row.kind === 'task' || row.kind === 'project') && row.programId)
    parents.push({ kind: 'program', id: row.programId });
  if (row.kind === 'task' && row.projectId) parents.push({ kind: 'project', id: row.projectId });
  if (row.kind === 'task' && row.parentTaskId) parents.push({ kind: 'task', id: row.parentTaskId });
  return { parents, visibility: 'visibility' in row ? row.visibility : 'public', access: null };
}

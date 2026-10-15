import { BlueprintError } from '@docket/work/blueprints';
import type { BlueprintPlacement, PlannedWorkNode } from '@docket/work/blueprints';
import { TaskCreate } from '@docket/work/task-model';
import { ProgramCreate } from '@docket/work/program-contract';
import { ProjectCreate } from '../../contracts/project';
import type { OrdinaryWorkCommand } from '../work-creation/types';

/** A selected node with server-allocated identity and its actual physical parent. */
export interface AllocatedBlueprintNode {
  readonly node: PlannedWorkNode;
  readonly id: string;
  readonly parent: AllocatedBlueprintNode | null;
  readonly placement: BlueprintPlacement;
  readonly visibility?: 'public' | 'private';
}

/** Restrict a generated branch whenever its root or an authored Program is private. */
export function blueprintNodeVisibility(
  row: AllocatedBlueprintNode,
  rootVisibility: 'public' | 'private',
): 'public' | 'private' {
  if (rootVisibility === 'private') return 'private';
  let current: AllocatedBlueprintNode | null = row;
  while (current) {
    if (current.visibility === 'private') return 'private';
    if (
      current.node.kind === 'program' &&
      'visibility' in current.node.fields &&
      current.node.fields.visibility === 'private'
    )
      return 'private';
    current = current.parent;
  }
  return 'public';
}

function childPlacement(parent: AllocatedBlueprintNode): BlueprintPlacement {
  const inherited = parent.placement;
  switch (parent.node.kind) {
    case 'initiative':
      return { ...inherited, initiativeId: parent.id };
    case 'program':
      return { ...inherited, programId: parent.id };
    case 'project':
      return { ...inherited, projectId: parent.id, milestoneId: null, parentTaskId: null };
    case 'milestone':
      return { ...inherited, milestoneId: parent.id, parentTaskId: null };
    case 'task':
      return { ...inherited, parentTaskId: parent.id };
  }
}

/** Bind parent-ordered logical nodes to allocated IDs; authored key paths never imply containment. */
export function allocateBlueprintPlacement(
  nodes: readonly PlannedWorkNode[],
  ids: ReadonlyMap<string, string>,
  existing?: ReadonlyMap<
    string,
    { readonly placement: BlueprintPlacement; readonly visibility: 'public' | 'private' }
  >,
): AllocatedBlueprintNode[] {
  const allocated = new Map<string, AllocatedBlueprintNode>();
  for (const node of nodes) {
    const key = JSON.stringify(node.path);
    const id = ids.get(key);
    const retained = existing?.get(key);
    const parent = node.parentPath === null ? null : allocated.get(JSON.stringify(node.parentPath));
    if (!id || parent === undefined)
      throw new BlueprintError('blueprint_invalid', 'A selected child has no allocated parent.');
    allocated.set(key, {
      node,
      id,
      parent,
      placement: retained?.placement ?? (parent ? childPlacement(parent) : node.placement),
      ...(retained ? { visibility: retained.visibility } : {}),
    });
  }
  return [...allocated.values()];
}

/** Translate a planned non-root child into its existing public create vocabulary and trusted placement. */
export function commandForBlueprintNode(
  source: OrdinaryWorkCommand,
  allocated: AllocatedBlueprintNode,
  visibility: 'public' | 'private',
): OrdinaryWorkCommand {
  const { node, id, placement } = allocated;
  const effectiveVisibility = blueprintNodeVisibility(allocated, visibility);
  const { retainedBinding: _rootBinding, ...sourceInvocation } = source.invocation;
  const invocation = {
    ...sourceInvocation,
    prospectiveWorkId: id,
    placement: {
      programId: placement.programId ?? null,
      initiativeId: placement.initiativeId ?? null,
      visibility: effectiveVisibility,
    },
    labelIds: [],
  };
  const body = {
    ...node.fields,
    ...Object.fromEntries(Object.entries(node.dates).filter(([, value]) => value !== null)),
    workTypeId: node.workTypeId,
    workTypeVersionId: node.workTypeVersionId,
  };
  switch (node.kind) {
    case 'task':
      return {
        ...source,
        kind: 'task',
        invocation,
        body: taskBody(node, placement, body),
      };
    case 'project':
      return {
        ...source,
        kind: 'project',
        invocation,
        body: projectBody(node, placement, body),
      };
    case 'program':
      return {
        ...source,
        kind: 'program',
        invocation,
        body: ProgramCreate.parse({
          ...body,
          ownerId: node.responsibleActorId ?? undefined,
          visibility: effectiveVisibility,
        }),
      };
    case 'initiative':
    case 'milestone':
      throw new BlueprintError(
        'blueprint_invalid',
        'This child uses its dedicated hierarchy writer.',
      );
  }
}

function taskBody(
  node: PlannedWorkNode,
  placement: BlueprintPlacement,
  body: Readonly<Record<string, unknown>>,
): TaskCreate {
  return TaskCreate.parse({
    ...body,
    teamId: node.teamId,
    assigneeId: node.responsibleActorId ?? undefined,
    cycleId: node.cycleId ?? undefined,
    projectId: placement.projectId ?? undefined,
    milestoneId: placement.milestoneId ?? undefined,
    parentTaskId: placement.parentTaskId ?? undefined,
    labels: 'labelIds' in node.fields ? node.fields.labelIds : undefined,
  });
}
function projectBody(
  node: PlannedWorkNode,
  placement: BlueprintPlacement,
  body: Readonly<Record<string, unknown>>,
): ProjectCreate {
  return ProjectCreate.parse({
    ...body,
    teamId: node.teamId ?? undefined,
    leadId: node.responsibleActorId ?? undefined,
    programId: placement.programId ?? undefined,
    initiativeIds: placement.initiativeId ? [placement.initiativeId] : [],
  });
}

/** Scalar metadata that can travel with a relationship endpoint. */
export type RelationScalar = string | number | boolean | null;

/** Every domain endpoint that can participate in a relationship gesture. */
export type RelationEndpointKind =
  | 'task'
  | 'project'
  | 'program'
  | 'initiative'
  | 'initiative_root'
  | 'team'
  | 'cycle'
  | 'milestone'
  | 'actor'
  | 'label'
  | 'calendar_item'
  | 'calendar_slot';

/** Stable identifiers for work relationships that application actions can implement. */
export type RelationId =
  | 'task.parent'
  | 'task.blocks'
  | 'task.project'
  | 'task.program'
  | 'task.team'
  | 'task.cycle'
  | 'task.milestone'
  | 'task.assignee'
  | 'task.label'
  | 'task.calendar-item'
  | 'task.calendar-slot'
  | 'project.program'
  | 'project.team'
  | 'project.initiative'
  | 'project.lead'
  | 'project.label'
  | 'project.blocks'
  | 'program.initiative'
  | 'program.owner'
  | 'program.label'
  | 'initiative.parent'
  | 'initiative.root'
  | 'initiative.lead-team'
  | 'initiative.owner'
  | 'initiative.label'
  | 'calendar-item.related'
  | 'calendar-item.contained'
  | 'calendar-item.follow-up';

/** A domain identity with only the data required to resolve a relationship. */
export interface RelationEndpoint {
  /** Domain kind of the endpoint. */
  readonly kind: RelationEndpointKind;
  /** Stable domain identifier. */
  readonly id: string;
  /** Owning workspace, or `null` for personal calendar data. */
  readonly organizationId: string | null;
  /** Optional domain facts used by pure local guards. */
  readonly meta?: Readonly<Record<string, RelationScalar>>;
}

/** The observable effect a relationship command has on its source. */
export type RelationEffect = 'move' | 'link' | 'copy';

/** The cardinality of a relationship from one source. */
export type RelationCardinality = 'one' | 'many';

/** One relationship supported by the domain. */
export interface RelationDefinition {
  /** Stable relationship identifier. */
  readonly id: RelationId;
  /** Kind accepted as the dragged subject. */
  readonly sourceKind: RelationEndpointKind;
  /** Kind accepted as the destination. */
  readonly targetKind: RelationEndpointKind;
  /** User-visible drop effect. */
  readonly effect: RelationEffect;
  /** Whether a source replaces one value or adds another edge. */
  readonly cardinality: RelationCardinality;
  /** Whether an unlabeled drop for this source-target pair chooses this relationship. */
  readonly isDefault: boolean;
  /** Optional pure validation for domain facts already carried by the endpoints. */
  readonly guard?: RelationGuard;
}

/** Pure validation that can reject an otherwise compatible relation without I/O. */
export type RelationGuard = (
  subjects: readonly RelationEndpoint[],
  target: RelationEndpoint,
) => RelationRejectionReason | null;

/** The complete relationship command passed from an application action to its injected port. */
export interface RelationIntent {
  /** Relationship to execute. */
  readonly relationId: RelationId;
  /** Ordered subjects, matching the order shown in the source surface. */
  readonly subjects: readonly RelationEndpoint[];
  /** Destination endpoint. */
  readonly target: RelationEndpoint;
  /** Effect declared by the relationship definition. */
  readonly effect: RelationEffect;
}

/** Stable reasons that let an application own rejection copy. */
export type RelationRejectionReason =
  | 'empty_subjects'
  | 'mixed_subject_kinds'
  | 'unsupported_pair'
  | 'cross_organization'
  | 'self_relation'
  | 'incompatible_parent'
  | 'hierarchy_cycle'
  | 'archived_target'
  | 'permission_denied';

/** Result of resolving a default relationship gesture. */
export type RelationResolution =
  | { readonly accepted: true; readonly intent: RelationIntent }
  | { readonly accepted: false; readonly reason: RelationRejectionReason };

/** Result returned by a typed relationship command adapter. */
export interface RelationCommandResult {
  /** `unchanged` represents an idempotent duplicate or an already-applied single value. */
  readonly status: 'applied' | 'unchanged';
}

/** Dependency-inversion boundary implemented by each relationship-owning application domain. */
export interface RelationCommandPort<TIntent extends RelationIntent = RelationIntent> {
  /** Execute one validated relationship command. */
  execute(intent: TIntent): Promise<RelationCommandResult>;
}

/** Reject a hierarchy edge that the current surface has already proved would make a cycle. */
function rejectHierarchyCycle(
  _subjects: readonly RelationEndpoint[],
  target: RelationEndpoint,
): RelationRejectionReason | null {
  return target.meta?.['wouldCreateCycle'] === true ? 'hierarchy_cycle' : null;
}

/** Keep a Task milestone inside the Task's current Project when both facts are available. */
function rejectForeignMilestone(
  subjects: readonly RelationEndpoint[],
  target: RelationEndpoint,
): RelationRejectionReason | null {
  const targetProjectId = target.meta?.['projectId'];
  const incompatible = subjects.some((subject) => {
    const subjectProjectId = subject.meta?.['projectId'];
    return (
      typeof subjectProjectId === 'string' &&
      typeof targetProjectId === 'string' &&
      subjectProjectId !== targetProjectId
    );
  });
  return incompatible ? 'incompatible_parent' : null;
}

/** The domain relationship catalog. It contains no presentation or transport details. */
export const RELATION_DEFINITIONS = [
  {
    id: 'task.parent',
    sourceKind: 'task',
    targetKind: 'task',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
    guard: rejectHierarchyCycle,
  },
  {
    id: 'task.blocks',
    sourceKind: 'task',
    targetKind: 'task',
    effect: 'link',
    cardinality: 'many',
    isDefault: false,
  },
  {
    id: 'task.project',
    sourceKind: 'task',
    targetKind: 'project',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'task.program',
    sourceKind: 'task',
    targetKind: 'program',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'task.team',
    sourceKind: 'task',
    targetKind: 'team',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'task.cycle',
    sourceKind: 'task',
    targetKind: 'cycle',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'task.milestone',
    sourceKind: 'task',
    targetKind: 'milestone',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
    guard: rejectForeignMilestone,
  },
  {
    id: 'task.assignee',
    sourceKind: 'task',
    targetKind: 'actor',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'task.label',
    sourceKind: 'task',
    targetKind: 'label',
    effect: 'link',
    cardinality: 'many',
    isDefault: true,
  },
  {
    id: 'task.calendar-item',
    sourceKind: 'task',
    targetKind: 'calendar_item',
    effect: 'link',
    cardinality: 'many',
    isDefault: true,
  },
  {
    id: 'task.calendar-slot',
    sourceKind: 'task',
    targetKind: 'calendar_slot',
    effect: 'copy',
    cardinality: 'many',
    isDefault: true,
  },
  {
    id: 'project.program',
    sourceKind: 'project',
    targetKind: 'program',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'project.team',
    sourceKind: 'project',
    targetKind: 'team',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'project.initiative',
    sourceKind: 'project',
    targetKind: 'initiative',
    effect: 'link',
    cardinality: 'many',
    isDefault: true,
  },
  {
    id: 'project.lead',
    sourceKind: 'project',
    targetKind: 'actor',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'project.label',
    sourceKind: 'project',
    targetKind: 'label',
    effect: 'link',
    cardinality: 'many',
    isDefault: true,
  },
  {
    id: 'project.blocks',
    sourceKind: 'project',
    targetKind: 'project',
    effect: 'link',
    cardinality: 'many',
    isDefault: true,
  },
  {
    id: 'program.initiative',
    sourceKind: 'program',
    targetKind: 'initiative',
    effect: 'link',
    cardinality: 'many',
    isDefault: true,
  },
  {
    id: 'program.owner',
    sourceKind: 'program',
    targetKind: 'actor',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'program.label',
    sourceKind: 'program',
    targetKind: 'label',
    effect: 'link',
    cardinality: 'many',
    isDefault: true,
  },
  {
    id: 'initiative.parent',
    sourceKind: 'initiative',
    targetKind: 'initiative',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
    guard: rejectHierarchyCycle,
  },
  {
    id: 'initiative.root',
    sourceKind: 'initiative',
    targetKind: 'initiative_root',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'initiative.lead-team',
    sourceKind: 'initiative',
    targetKind: 'team',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'initiative.owner',
    sourceKind: 'initiative',
    targetKind: 'actor',
    effect: 'move',
    cardinality: 'one',
    isDefault: true,
  },
  {
    id: 'initiative.label',
    sourceKind: 'initiative',
    targetKind: 'label',
    effect: 'link',
    cardinality: 'many',
    isDefault: true,
  },
  {
    id: 'calendar-item.related',
    sourceKind: 'calendar_item',
    targetKind: 'calendar_item',
    effect: 'link',
    cardinality: 'many',
    isDefault: true,
  },
  {
    id: 'calendar-item.contained',
    sourceKind: 'calendar_item',
    targetKind: 'calendar_item',
    effect: 'link',
    cardinality: 'many',
    isDefault: false,
  },
  {
    id: 'calendar-item.follow-up',
    sourceKind: 'calendar_item',
    targetKind: 'calendar_item',
    effect: 'link',
    cardinality: 'many',
    isDefault: false,
  },
] as const satisfies readonly RelationDefinition[];

/** Input to the fixed-default relationship resolver. */
export interface ResolveDefaultRelationInput {
  /** Ordered dragged endpoints. */
  readonly subjects: readonly RelationEndpoint[];
  /** Endpoint currently under the pointer. */
  readonly target: RelationEndpoint;
}

/** Resolve the one fixed default relationship for a dragged source and target. */
export function resolveDefaultRelation(input: ResolveDefaultRelationInput): RelationResolution {
  const { subjects, target } = input;
  const first = subjects[0];
  if (!first) return { accepted: false, reason: 'empty_subjects' };
  if (subjects.some((subject) => subject.kind !== first.kind)) {
    return { accepted: false, reason: 'mixed_subject_kinds' };
  }

  const definition = RELATION_DEFINITIONS.find(
    (candidate) =>
      candidate.isDefault &&
      candidate.sourceKind === first.kind &&
      candidate.targetKind === target.kind,
  );
  if (!definition) return { accepted: false, reason: 'unsupported_pair' };

  const crossesOrganization = subjects.some(
    (subject) =>
      subject.organizationId !== null &&
      target.organizationId !== null &&
      subject.organizationId !== target.organizationId,
  );
  if (crossesOrganization) return { accepted: false, reason: 'cross_organization' };

  if (subjects.some((subject) => subject.kind === target.kind && subject.id === target.id)) {
    return { accepted: false, reason: 'self_relation' };
  }

  if (target.meta?.['archived'] === true) return { accepted: false, reason: 'archived_target' };
  if (target.meta?.['canRelate'] === false) return { accepted: false, reason: 'permission_denied' };

  const guardedRejection = 'guard' in definition ? definition.guard(subjects, target) : null;
  if (guardedRejection !== null) return { accepted: false, reason: guardedRejection };

  return {
    accepted: true,
    intent: {
      relationId: definition.id,
      subjects,
      target,
      effect: definition.effect,
    },
  };
}

/** Pure planner snapshots. API adapters supply authorized immutable facts, never callbacks. */
import type { ActorId, OrganizationId, TeamId } from '@docket/identity-access/ids';
import type { BlueprintStepId, CycleId, WorkTypeId, WorkTypeVersionId } from '../ids';
import type { WorkTemplateDefinition } from '../contracts/work-template';
import type {
  BlueprintDateBindings,
  BlueprintDateRule,
  BlueprintStep,
  OptionalChoice,
  ResolvedVersionAtPath,
  StepKey,
  WorkTemplateOrigin,
  BlueprintWarningCode,
} from '../contracts/work-template-blueprint';

/** The four ordinary root work kinds. */
export type WorkKind = WorkTemplateDefinition['payload']['targetType'];
/** Concrete blueprint work kinds, including Project checkpoints. */
export type BlueprintWorkKind = WorkKind | 'milestone';
/** Qualified logical path; the root is the empty path. */
export type BlueprintPath = readonly StepKey[];
/** Supported date field. */
export type BlueprintDateField = 'startDate' | 'dueDate' | 'targetDate';
/** Strict reusable starting values plus kind-specific optional overrides. */
type WithoutTarget<T> = T extends { targetType: unknown } ? Omit<T, 'targetType'> : never;
/** Ordinary reusable starting fields correlated with their concrete work kind. */
export type BlueprintFieldsByKind = {
  readonly [K in WorkKind]: WithoutTarget<
    Extract<WorkTemplateDefinition['payload'], { targetType: K }>
  >;
} & { readonly milestone: { readonly name: string; readonly description?: string | undefined } };
/** Distributive reusable-field union; no literal placement or actor references. */
export type BlueprintFields = BlueprintFieldsByKind[BlueprintWorkKind];
/** Concrete ordinary fields preserve nullable summary/health clears absent from reusable payloads. */
export type ResolvedBlueprintFieldsByKind = {
  readonly [K in BlueprintWorkKind]: {
    readonly [P in keyof BlueprintFieldsByKind[K]]: P extends 'summary' | 'health'
      ? BlueprintFieldsByKind[K][P] | null
      : BlueprintFieldsByKind[K][P];
  };
};
/** Concrete resolved/planned field union; reusable definition validators remain unchanged. */
export type ResolvedBlueprintFields = ResolvedBlueprintFieldsByKind[BlueprintWorkKind];
/** Authorized exact publication and immutable step projections. */
export interface PublishedBlueprintSnapshot {
  readonly organizationId: OrganizationId;
  readonly kind: WorkKind;
  readonly workTypeId: WorkTypeId;
  readonly versionId: WorkTypeVersionId;
  readonly definition: WorkTemplateDefinition;
  readonly stepIds: Readonly<Record<string, BlueprintStepId>>;
}
/** Frozen closure resolved by the API in its caller's transaction. */
export interface ResolvedBlueprintGraph {
  readonly root: PublishedBlueprintSnapshot;
  readonly publications: readonly PublishedBlueprintSnapshot[];
  readonly resolutions: readonly ResolvedVersionAtPath[];
  readonly fingerprint: string;
}
/** Flattened authored step, before assignment and dates. */
export interface ExpandedBlueprintNode {
  readonly path: BlueprintPath;
  readonly parentPath: BlueprintPath | null;
  readonly scopePath: BlueprintPath;
  readonly kind: BlueprintWorkKind;
  readonly step: BlueprintStep | null;
  readonly definition: WorkTemplateDefinition | null;
  readonly workTypeId: WorkTypeId | null;
  readonly workTypeVersionId: WorkTypeVersionId | null;
  readonly sourceStepId: BlueprintStepId | null;
  readonly sourceWorkTypeId: WorkTypeId | null;
  readonly sourceVersionId: WorkTypeVersionId | null;
  readonly selected: boolean;
  readonly prerequisitePaths: readonly BlueprintPath[];
}
/** Qualified edge between generated root Tasks. */
export interface BlueprintPathDependency {
  readonly blockerPath: BlueprintPath;
  readonly blockedPath: BlueprintPath;
}
/** Fully expanded bounded graph, retaining deselected preview nodes. */
export interface ExpandedBlueprint {
  readonly nodes: readonly ExpandedBlueprintNode[];
  readonly dependencies: readonly BlueprintPathDependency[];
  readonly manifest: readonly ResolvedVersionAtPath[];
}
/** Authorized responsible actor availability. */
export interface BlueprintActorSnapshot {
  readonly id: ActorId;
  readonly active: boolean;
}
/** Authorized cycle fact, including ownership and lifecycle. */
export interface BlueprintCycleSnapshot {
  readonly id: CycleId;
  readonly organizationId: OrganizationId;
  readonly teamId: TeamId;
  readonly startDate: string;
  readonly endDate: string;
  readonly archived: boolean;
  readonly closed: boolean;
}
/** Concrete existing destination fields inherited by a root or generated child. */
export interface BlueprintPlacement {
  readonly initiativeId?: string | null;
  readonly programId?: string | null;
  readonly projectId?: string | null;
  readonly milestoneId?: string | null;
  readonly parentTaskId?: string | null;
}
interface ResolvedRootContext {
  readonly teamId: TeamId | null;
  readonly responsibleActorId: ActorId | null;
  readonly cycleId: CycleId | null;
  readonly dates: Readonly<Partial<Record<BlueprintDateField, string | null>>>;
  readonly placement?: BlueprintPlacement;
  readonly terminal?: boolean;
  readonly documentPrepared?: boolean;
}
/** Already resolved kind-correlated root fields and ordinary destination references. */
export type ResolvedRootDraft = {
  readonly [K in WorkKind]: ResolvedRootContext & {
    readonly kind: K;
    readonly fields: ResolvedBlueprintFieldsByKind[K];
  };
}[WorkKind];
/** Actual completed/canceled/open state at a qualified path. */
export interface BlueprintCompletionFact {
  readonly id?: string;
  readonly path: BlueprintPath;
  readonly state: 'open' | 'completed' | 'canceled';
  readonly completedAt: string | null;
}
/** Trusted location-specific override; never serialized into reusable definitions. */
export interface BlueprintNodeOverride {
  readonly path: BlueprintPath;
  readonly fields?: ResolvedBlueprintFields;
  readonly teamId?: TeamId | null;
  readonly responsibleActorId?: ActorId | null;
  readonly cycleId?: CycleId | null;
  readonly dates?: Readonly<Partial<Record<BlueprintDateField, string | null>>>;
  readonly documentPrepared?: boolean;
}
/** Frozen creation authority, calendar, destination and relative-rule facts. */
export interface BlueprintCreationContext {
  /** Exact authorized retained rows preserve current fields/assignments without new-row validation. */
  readonly existingNodes?: readonly ExistingBlueprintNode[];
  readonly organizationId: OrganizationId;
  readonly initiatingActorId: ActorId | null;
  readonly actors: readonly BlueprintActorSnapshot[];
  readonly athenaActorId: ActorId | null;
  readonly creationTeamId: TeamId | null;
  readonly creationDate: string;
  readonly timezone: string;
  readonly workingWeekdays: readonly number[];
  readonly runDate?: string;
  readonly cycles: readonly BlueprintCycleSnapshot[];
  readonly completions: readonly BlueprintCompletionFact[];
  readonly overrides?: readonly BlueprintNodeOverride[];
}
/** Input to the pure bounded work planner. */
export interface ResolvedBlueprintInput {
  readonly graph: ResolvedBlueprintGraph;
  readonly root: ResolvedRootDraft;
  readonly context: BlueprintCreationContext;
  readonly choices: readonly OptionalChoice[];
}
/** Bounded preview warning, aggregated by code and affected path. */
export interface BlueprintWarning {
  readonly code: BlueprintWarningCode;
  readonly paths: readonly BlueprintPath[];
  readonly count: number;
}
/** One concrete planned work row; IDs and side effects remain API-owned. */
export interface PlannedWorkNode extends ExpandedBlueprintNode {
  readonly fields: ResolvedBlueprintFields;
  readonly teamId: TeamId | null;
  readonly responsibleActorId: ActorId | null;
  readonly cycleId: CycleId | null;
  readonly dates: Readonly<Partial<Record<BlueprintDateField, string | null>>>;
  readonly dateBindings: BlueprintDateBindings;
  readonly unresolvedReasons: Readonly<
    Partial<Record<BlueprintDateField, 'missing_anchor' | 'waiting_completion'>>
  >;
  readonly placement: BlueprintPlacement;
}
/** Parent-ordered selected rows, exact manifest and qualified dependency edges. */
export interface PlannedWorkTree {
  readonly nodes: readonly PlannedWorkNode[];
  readonly dependencies: readonly BlueprintPathDependency[];
  readonly manifest: readonly ResolvedVersionAtPath[];
  readonly warnings: readonly BlueprintWarning[];
  readonly fingerprint: string;
}
/** Authorized concrete prerequisites for one independently adopted date rule. */
export interface BlueprintDateReferences {
  readonly parentId: string | null;
  readonly milestoneIds: Readonly<Record<StepKey, string>>;
  readonly completionIds: Readonly<Record<StepKey, string>>;
}
/** Existing authorized row and current independently accepted date bindings. */
export interface ExistingBlueprintNode {
  readonly id: string;
  /** Actual hierarchy reference; preferred when retained origin paths overlap. */
  readonly parentId?: string | null;
  readonly kind: BlueprintWorkKind;
  readonly path: BlueprintPath;
  readonly parentPath: BlueprintPath | null;
  readonly sourceWorkTypeId: WorkTypeId | null;
  readonly sourceStepId: BlueprintStepId | null;
  readonly workTypeId: WorkTypeId | null;
  readonly workTypeVersionId: WorkTypeVersionId | null;
  readonly fields: ResolvedBlueprintFields;
  readonly dates: Readonly<Partial<Record<BlueprintDateField, string | null>>>;
  readonly dateBindings: BlueprintDateBindings;
  readonly dateReferences?: Readonly<Partial<Record<BlueprintDateField, BlueprintDateReferences>>>;
  readonly teamId: TeamId | null;
  readonly responsibleActorId: ActorId | null;
  readonly cycleId: CycleId | null;
  readonly state: 'unstarted' | 'started' | 'completed' | 'canceled';
  readonly everStarted: boolean;
  readonly cancellable: boolean;
}
/** Existing date graph plus proposed anchor/completion facts. */
export interface BlueprintReflowInput {
  readonly nodes: readonly ExistingBlueprintNode[];
  /** Managed descendants to recompute; other nodes are read-only prerequisites. Omit for the full graph. */
  readonly affectedNodeIds?: ReadonlySet<string>;
  readonly context: BlueprintCreationContext;
  readonly anchorChanges: readonly {
    readonly id?: string;
    readonly path: BlueprintPath;
    readonly field: BlueprintDateField;
    readonly value: string | null;
  }[];
}
/** Atomic derived write to one nonmanual, nonterminal date field. */
export interface PlannedDateChange {
  readonly id: string;
  readonly path: BlueprintPath;
  readonly field: BlueprintDateField;
  readonly value: string | null;
  readonly binding: NonNullable<BlueprintDateBindings[BlueprintDateField]>;
  readonly unresolvedReason: 'missing_anchor' | 'waiting_completion' | null;
}
/** Selective child-update preview input; current rows are authorized snapshots. */
export interface BlueprintDiffInput {
  readonly mode: 'change' | 'update';
  readonly current: readonly ExistingBlueprintNode[];
  readonly currentDependencies: readonly (BlueprintPathDependency & {
    readonly serviceOwned: boolean;
  })[];
  readonly selected: ResolvedBlueprintInput;
}
/** Explicit independently selectable child change. */
export type BlueprintDifference =
  | {
      readonly changeId: string;
      readonly kind: 'add_child';
      readonly path: BlueprintPath;
      readonly nodes: readonly PlannedWorkNode[];
      readonly count: number;
      readonly selectedByDefault: boolean;
    }
  | {
      readonly changeId: string;
      readonly kind: 'set_derived_date';
      readonly path: BlueprintPath;
      readonly id: string;
      readonly field: BlueprintDateField;
      readonly previous: string | null;
      readonly value: string | null;
      readonly rule: BlueprintDateRule;
      readonly binding: NonNullable<BlueprintDateBindings[BlueprintDateField]>;
      readonly selectedByDefault: false;
    }
  | {
      readonly changeId: string;
      readonly kind: 'add_dependency' | 'remove_dependency';
      readonly blockerPath: BlueprintPath;
      readonly blockedPath: BlueprintPath;
      readonly selectedByDefault: false;
    }
  | {
      readonly changeId: string;
      readonly kind: 'cancel_removed_child';
      readonly path: BlueprintPath;
      readonly id: string;
      readonly selectedByDefault: false;
    };
/** Authorized current tree for an independent inline Save-as snapshot. */
export interface CapturableWorkTree {
  readonly name: string;
  readonly root: ExistingBlueprintNode;
  readonly nodes: readonly ExistingBlueprintNode[];
  readonly dependencies: readonly (
    BlueprintPathDependency | { readonly blockerId: string; readonly blockedId: string }
  )[];
  readonly context: BlueprintCreationContext;
  readonly complete: boolean;
}
/** Independent reusable definition and review warnings, with no source work IDs. */
export interface CapturedTemplateDraft {
  readonly definition: WorkTemplateDefinition;
  readonly origin: WorkTemplateOrigin | null;
  readonly warnings: readonly BlueprintWarning[];
}

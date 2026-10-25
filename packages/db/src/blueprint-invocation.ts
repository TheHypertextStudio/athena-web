import type { ResolvedVersionAtPath } from '@docket/work/work-template-blueprint';
import type { CanonicalPrivateWorkDefinition } from '@docket/work/work-private-definition';
import type { WorkScheduleForest } from '@docket/work/work-schedule-forest';
/** Restricted legacy/schedule context; never a reusable template definition. */
export interface BlueprintInvocationRoot {
  readonly sourceStepId: string;
  readonly sourceKey: string;
  readonly key: string;
  readonly kind: 'project' | 'task';
  readonly workTypeId: string | null;
  readonly workTypeVersionId: string | null;
}

/** Retained source mapping for canonical origin and legacy output-key compatibility. */
export interface BlueprintInvocationStep {
  readonly sourceStepId: string;
  readonly sourceKey: string;
  readonly rootKey: string;
  readonly path: readonly string[];
  readonly blueprintStepId: string | null;
  readonly sourceVersionId: string | null;
}

/** Immutable forest selection; unpublished retained drafts have no executable publication. */
export interface BlueprintInvocationManifest {
  readonly kind: 'published' | 'pending_draft';
  readonly legacyProcessRevisionId: string;
  readonly roots: readonly BlueprintInvocationRoot[];
  readonly steps: readonly BlueprintInvocationStep[];
  readonly dependencies: readonly {
    readonly blockerStepId: string;
    readonly blockedStepId: string;
  }[];
}
/** Stored private document discriminators; original retained envelopes remain unchanged and separately narrowed. */
export type StoredBlueprintInvocationManifest =
  BlueprintInvocationManifest | WorkScheduleForest | CanonicalPrivateWorkDefinition;

/** Location-specific source fields, preserved privately without publishing literal references. */
export interface BlueprintInvocationOverride {
  readonly sourceStepId: string;
  readonly kind: 'project' | 'milestone' | 'task';
  readonly fields: Readonly<Record<string, string | number | null | readonly string[]>>;
  readonly timing: {
    readonly kind: 'on_trigger' | 'relative_to_trigger' | 'after_step_completion';
    readonly offsetDays: number | null;
    readonly afterStepId: string | null;
  };
}

/** Exact initially accepted work identity at a publication-qualified blueprint path. */
export interface BlueprintOccurrenceSelectedWork {
  readonly path: readonly string[];
  readonly kind: 'program' | 'project' | 'task' | 'milestone';
  readonly id: string;
}

/** Original forest root identity on a retained occurrence. */
export interface BlueprintOccurrenceRoot {
  /** Original accepted publication closure, independently immutable from editable public work state. */
  readonly resolvedManifest?: readonly ResolvedVersionAtPath[];
  /** Original selected rows; later same-path replacements never acquire retained authority. */
  readonly selectedWork?: readonly BlueprintOccurrenceSelectedWork[];
  readonly key: string;
  readonly kind: 'project' | 'task';
  readonly id: string;
}

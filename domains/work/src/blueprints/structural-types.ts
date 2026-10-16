import type { WorkTemplateDefinition } from '../contracts/work-template';
import type { BlueprintStep } from '../contracts/work-template-blueprint';
import type { BlueprintPath, BlueprintPathDependency, BlueprintWorkKind, WorkKind } from './types';

/** Logical definition facts used only to validate structure; they confer no publication authority. */
export interface StructuralBlueprintSnapshot {
  readonly sourceKey: string;
  readonly definitionKey: string;
  readonly scopeKey: string;
  readonly kind: WorkKind;
  readonly definition: WorkTemplateDefinition;
}
/** Flattened logical work without immutable publication IDs or physical step projections. */
export interface StructuralBlueprintNode {
  readonly path: BlueprintPath;
  readonly parentPath: BlueprintPath | null;
  readonly scopePath: BlueprintPath;
  readonly kind: BlueprintWorkKind;
  readonly step: BlueprintStep | null;
  readonly definition: WorkTemplateDefinition | null;
  readonly ownerSourceKey: string | null;
  readonly selectedSourceKey: string | null;
  readonly sourceStepKey: string | null;
  readonly selected: boolean;
  readonly prerequisitePaths: readonly BlueprintPath[];
}
/** Structural expansion is validation output, never an executable work-creation graph. */
export interface StructuralBlueprintGraph {
  readonly nodes: readonly StructuralBlueprintNode[];
  readonly dependencies: readonly BlueprintPathDependency[];
}
/** Internal pure adapter over already-authorized source facts; no IO or authorizing callbacks. */
export interface StructuralBlueprintInput {
  readonly root: StructuralBlueprintSnapshot;
  readonly resolve: (
    owner: StructuralBlueprintSnapshot,
    step: BlueprintStep,
    path: BlueprintPath,
  ) => StructuralBlueprintSnapshot | null;
}

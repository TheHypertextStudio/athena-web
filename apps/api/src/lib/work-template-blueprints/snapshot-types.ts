import type {
  BlueprintCreationContext,
  BlueprintWorkKind,
  ExistingBlueprintNode,
} from '@docket/work/blueprints';
import type { ActorCtx } from '../../context';
import type { InsertedWork } from '../work-creation/writers';
import type { RetainedOccurrenceAuthority } from '../work-creation/retained-authority';

/** Exact physical identity; a logical template path never grants access to it. */
export interface BlueprintWorkRef {
  readonly kind: BlueprintWorkKind;
  readonly id: string;
}
/** Existing kind-correlated database work, reusing the ordinary writer's row union. */
export type BlueprintStoredWork = InsertedWork;
/** Foreground actor or an exact transaction-registered retained occurrence capability. */
export type BlueprintSnapshotAuthority = ActorCtx | RetainedOccurrenceAuthority;
/** Bounded complete tree capture; write callers request sorted row locks and live edit access. */
export interface BlueprintSnapshotOptions {
  readonly scope: 'tree' | 'retained' | 'affected' | 'reference';
  readonly seeds?: readonly BlueprintWorkRef[];
  readonly dateAnchors?: readonly string[];
  readonly ancestorIds?: readonly string[];
  readonly access?: 'view' | 'edit';
  readonly forUpdate?: boolean;
  readonly now?: Date;
}
/** Concrete authorized facts shared by capture, reflow, assignment and retained execution. */
export interface AuthorizedBlueprintSnapshot {
  readonly root: ExistingBlueprintNode;
  readonly nodes: readonly ExistingBlueprintNode[];
  readonly rowsByRef: ReadonlyMap<string, BlueprintStoredWork>;
  readonly context: BlueprintCreationContext;
  readonly dependencies: readonly { readonly blockerId: string; readonly blockedId: string }[];
  readonly fingerprint: string;
}
/** One row's actual current parent, separate from immutable generation provenance. */
export interface BlueprintSnapshotRow {
  readonly work: BlueprintStoredWork;
  readonly parent: BlueprintWorkRef | null;
}

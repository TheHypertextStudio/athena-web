import type { ActorCtx } from '../../context';
import type { CallerOrgAccess } from '../../permissions/resource-access';
import type { OrdinaryWorkMutation, ProspectiveWorkReference } from '../work-creation/types';
import type { PreparedBlueprintCreation } from '../work-template-blueprints/preflight';
import type { PreparedMilestoneRow } from '../milestone-writes';
import type { InsertedWork } from '../work-creation/writers';
import type { Kind, PlaceInput, Placed, Placement } from './place';

/** Real existing work or an authorized prospective insertion available for name reconciliation. */
export interface ForestMatch {
  readonly id: string;
  readonly kind: Kind;
  readonly title: string;
  readonly placement: Placement;
  readonly visibility: 'public' | 'private';
  readonly existing: boolean;
}
/** A staged parent-first insertion or matched attachment; preparation never applies these operations. */
export type ForestOperation =
  | { readonly kind: 'tree'; readonly input: PlaceInput; readonly tree: PreparedBlueprintCreation }
  | { readonly kind: 'checkpoint'; readonly input: PlaceInput; readonly row: PreparedMilestoneRow }
  | { readonly kind: 'matched'; readonly input: PlaceInput; readonly match: ForestMatch };

/** Server-owned transaction planning state for one complete organize or accepted-plan action. */
export interface PreparedPlacementForest {
  readonly caller: ActorCtx;
  readonly access: CallerOrgAccess;
  readonly operations: ForestOperation[];
  readonly trees: PreparedBlueprintCreation[];
  readonly placed: Placed[];
  readonly byRef: Map<string, Placed>;
  readonly matches: Map<string, ForestMatch>;
  readonly prospective: Map<string, ProspectiveWorkReference>;
  readonly normalizedNames: Map<string, string>;
  readonly checkpointSorts: Map<string, number>;
  rowCount: number;
}
/** Fully applied work and attachments for the caller's one receipt and deferred effect drain. */
export interface AppliedPlacementForest extends Omit<OrdinaryWorkMutation, 'root'> {
  readonly root: InsertedWork | undefined;
  readonly placed: readonly Placed[];
}

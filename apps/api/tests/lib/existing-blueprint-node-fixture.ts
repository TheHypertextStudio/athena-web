import { BlueprintDateRule } from '@docket/work/work-template-blueprint';
import { BlueprintStepId, WorkTypeVersionId } from '@docket/work/ids';
import type { BlueprintDateField, ExistingBlueprintNode } from '@docket/work/blueprints';
import { ulid } from './work-schedule-fixture';

/** One accepted date binding on an existing blueprint row. */
export type ExistingDateBinding = NonNullable<
  ExistingBlueprintNode['dateBindings'][BlueprintDateField]
>;

/** Accepted binding for a relative rule, optionally pinned by a manual write. */
export function dateBinding(rule: unknown, manual = false): ExistingDateBinding {
  return {
    sourceStepId: BlueprintStepId.parse(ulid(900)),
    sourceVersionId: WorkTypeVersionId.parse(ulid(901)),
    rule: BlueprintDateRule.parse(rule),
    manual,
    lastDerivedDate: null,
  };
}

/** Fields a test sets on an existing row; everything else takes a neutral default. */
export interface ExistingNodeSeed {
  readonly id: string;
  readonly kind: ExistingBlueprintNode['kind'];
  readonly path: readonly string[];
  readonly parentId?: string | null;
  readonly state?: ExistingBlueprintNode['state'];
  readonly dateBindings?: ExistingBlueprintNode['dateBindings'];
  readonly dateReferences?: ExistingBlueprintNode['dateReferences'];
  readonly dates?: ExistingBlueprintNode['dates'];
}

/** Authorized existing row with no assignment, placement, or source template facts. */
export function existingNode(seed: ExistingNodeSeed): ExistingBlueprintNode {
  return {
    id: seed.id,
    parentId: seed.parentId ?? null,
    kind: seed.kind,
    path: seed.path,
    parentPath: seed.path.length ? seed.path.slice(0, -1) : null,
    sourceWorkTypeId: null,
    sourceStepId: null,
    workTypeId: null,
    workTypeVersionId: null,
    fields: { name: seed.id },
    dates: seed.dates ?? {},
    dateBindings: seed.dateBindings ?? {},
    ...(seed.dateReferences ? { dateReferences: seed.dateReferences } : {}),
    teamId: null,
    responsibleActorId: null,
    cycleId: null,
    state: seed.state ?? 'unstarted',
    everStarted: false,
    cancellable: seed.kind === 'task',
  };
}

/** Calendar-day offset applied to every relative rule in these fixtures. */
export const NO_OFFSET = { days: 0, unit: 'calendar' } as const;

import {
  InitiativeViewDefinition,
  INITIATIVE_VIEW_CONTRACT,
  type PersonalWorkViewState,
  ProgramViewDefinition,
  PROGRAM_VIEW_CONTRACT,
  ProjectViewDefinition,
  PROJECT_VIEW_CONTRACT,
  resolveWorkViewDefinition,
  TaskViewDefinition,
  TASK_VIEW_CONTRACT,
  type WorkViewFacetResponse,
  type ViewInstanceKey,
} from '@docket/types';
import {
  canonicalizeFilter,
  createFilterNodeSchema,
  FILTER_OPERATORS_BY_KIND,
  type DisplayableFieldKey,
  type FilterDraft,
  type FilterableFieldKey,
  type FilterNodeFor,
  type GroupableFieldKey,
  type LayoutFor,
  type SortableFieldKey,
  type SortTermFor,
  type ViewContract,
  type ViewDefinitionFor,
  type ViewFieldDefinition,
  type ViewFieldKind,
  type ViewTarget,
} from '@docket/work/view-contract';

/** Literal contract lookup that preserves a generic target's field relationships. */
export interface WorkViewContractByTarget {
  readonly task: typeof TASK_VIEW_CONTRACT;
  readonly project: typeof PROJECT_VIEW_CONTRACT;
  readonly program: typeof PROGRAM_VIEW_CONTRACT;
  readonly initiative: typeof INITIATIVE_VIEW_CONTRACT;
}

/** Contract selected by one target discriminator. */
export type WorkViewContractFor<TTarget extends ViewTarget> = WorkViewContractByTarget[TTarget];

/** Any closed work-view contract used by the shared web controller. */
export type AnyWorkViewContract = WorkViewContractByTarget[ViewTarget];

/** Target-bound validated v2 definition used by shared controls. */
export type WorkViewDefinitionFor<TTarget extends ViewTarget> = ViewDefinitionFor<
  WorkViewContractFor<TTarget>
>;

/** Structurally readable recursive filter shape retained alongside field-specific predicates. */
export type WorkViewFilterShape<TTarget extends ViewTarget> =
  | {
      readonly kind: 'predicate';
      readonly field: WorkViewFilterFieldKey<TTarget>;
      readonly operator: string;
      readonly operand?: unknown;
    }
  | {
      readonly kind: 'all' | 'any';
      readonly children: readonly WorkViewFilterShape<TTarget>[];
    }
  | { readonly kind: 'not'; readonly child: WorkViewFilterShape<TTarget> };

/** Target-bound executable filter formula. */
export type WorkViewFilterFor<TTarget extends ViewTarget> = FilterNodeFor<
  WorkViewContractFor<TTarget>
> &
  WorkViewFilterShape<TTarget>;

/** Target-bound ordered sort term. */
export type WorkViewSortTermFor<TTarget extends ViewTarget> = SortTermFor<
  WorkViewContractFor<TTarget>
>;

/** Target-bound filterable field key. */
export type WorkViewFilterFieldKey<TTarget extends ViewTarget> = FilterableFieldKey<
  WorkViewContractFor<TTarget>
>;

/** Target-bound sortable field key. */
export type WorkViewSortFieldKey<TTarget extends ViewTarget> = SortableFieldKey<
  WorkViewContractFor<TTarget>
>;

/** Target-bound groupable field key. */
export type WorkViewGroupFieldKey<TTarget extends ViewTarget> = GroupableFieldKey<
  WorkViewContractFor<TTarget>
>;

/** Target-bound displayable field key. */
export type WorkViewDisplayFieldKey<TTarget extends ViewTarget> = DisplayableFieldKey<
  WorkViewContractFor<TTarget>
>;

/** Target-bound layout accepted by one entity contract. */
export type WorkViewLayoutFor<TTarget extends ViewTarget> = LayoutFor<WorkViewContractFor<TTarget>>;

interface WorkViewFacetResponseByTarget {
  readonly task: Extract<WorkViewFacetResponse, { readonly target: 'task' }>;
  readonly project: Extract<WorkViewFacetResponse, { readonly target: 'project' }>;
  readonly program: Extract<WorkViewFacetResponse, { readonly target: 'program' }>;
  readonly initiative: Extract<WorkViewFacetResponse, { readonly target: 'initiative' }>;
}

/** Target-bound facet response used by the filter editor. */
export type WorkViewFacetResponseForTarget<TTarget extends ViewTarget> =
  WorkViewFacetResponseByTarget[TTarget];

/** Any validated v2 definition accepted by the shared work-view UI. */
export type AnyWorkViewDefinition =
  TaskViewDefinition | ProjectViewDefinition | ProgramViewDefinition | InitiativeViewDefinition;

/** Any executable filter node accepted by one of the four target contracts. */
export type AnyWorkViewFilter =
  | FilterNodeFor<typeof TASK_VIEW_CONTRACT>
  | FilterNodeFor<typeof PROJECT_VIEW_CONTRACT>
  | FilterNodeFor<typeof PROGRAM_VIEW_CONTRACT>
  | FilterNodeFor<typeof INITIATIVE_VIEW_CONTRACT>;

/** Target-specific incomplete editor state that cannot be executed without runtime parsing. */
export type WorkViewFilterDraftFor<TTarget extends ViewTarget> = FilterDraft<
  WorkViewContractFor<TTarget>
>;

interface RuntimeSchema<T> {
  parse(input: unknown): T;
  safeParse(
    input: unknown,
  ):
    | { readonly success: true; readonly data: T }
    | { readonly success: false; readonly error: unknown };
}

const CONTRACT_BY_TARGET = {
  task: TASK_VIEW_CONTRACT,
  project: PROJECT_VIEW_CONTRACT,
  program: PROGRAM_VIEW_CONTRACT,
  initiative: INITIATIVE_VIEW_CONTRACT,
} as const satisfies Record<ViewTarget, AnyWorkViewContract>;

const DEFINITION_BY_TARGET: {
  readonly [TTarget in ViewTarget]: RuntimeSchema<WorkViewDefinitionFor<TTarget>>;
} = {
  task: TaskViewDefinition,
  project: ProjectViewDefinition,
  program: ProgramViewDefinition,
  initiative: InitiativeViewDefinition,
} as const;

const FILTER_SCHEMA_BY_TARGET: {
  readonly [TTarget in ViewTarget]: RuntimeSchema<WorkViewFilterFor<TTarget>>;
} = {
  task: createFilterNodeSchema(TASK_VIEW_CONTRACT),
  project: createFilterNodeSchema(PROJECT_VIEW_CONTRACT),
  program: createFilterNodeSchema(PROGRAM_VIEW_CONTRACT),
  initiative: createFilterNodeSchema(INITIATIVE_VIEW_CONTRACT),
} as const;

const FIELD_LABELS = {
  task: {
    status: 'Status',
    priority: 'Priority',
    assignee: 'Assignee',
    delegate: 'Delegate',
    team: 'Team',
    project: 'Project',
    program: 'Program',
    cycle: 'Cycle',
    milestone: 'Milestone',
    parent: 'Parent',
    labels: 'Labels',
    title: 'Title',
    creator: 'Creator',
    startDate: 'Start date',
    dueDate: 'Due date',
    createdAt: 'Created',
    updatedAt: 'Updated',
    estimate: 'Estimate',
    estimateMinutes: 'Estimate time',
    blocked: 'Blocked',
    blocking: 'Blocking',
    unfiled: 'Unfiled',
    archived: 'Archived',
  } satisfies Record<keyof typeof TASK_VIEW_CONTRACT.fields, string>,
  project: {
    status: 'Status',
    priority: 'Priority',
    health: 'Health',
    lead: 'Lead',
    members: 'Members',
    teams: 'Teams',
    program: 'Program',
    initiatives: 'Initiatives',
    labels: 'Labels',
    startDate: 'Start date',
    targetDate: 'Target date',
    targetTimeframe: 'Target timeframe',
    creator: 'Creator',
    createdAt: 'Created',
    updatedAt: 'Updated',
    progress: 'Progress',
    taskCount: 'Task count',
    dependencyCount: 'Dependencies',
    name: 'Name',
  } satisfies Record<keyof typeof PROJECT_VIEW_CONTRACT.fields, string>,
  program: {
    status: 'Status',
    health: 'Health',
    owner: 'Owner',
    initiatives: 'Initiatives',
    labels: 'Labels',
    visibility: 'Visibility',
    creator: 'Creator',
    updatedAt: 'Updated',
    projectCount: 'Project count',
    taskCount: 'Task count',
    name: 'Name',
  } satisfies Record<keyof typeof PROGRAM_VIEW_CONTRACT.fields, string>,
  initiative: {
    status: 'Status',
    priority: 'Priority',
    health: 'Health',
    owner: 'Owner',
    leadTeam: 'Lead team',
    labels: 'Labels',
    targetDate: 'Target date',
    updateCadence: 'Update cadence',
    latestUpdate: 'Latest update',
    parent: 'Parent',
    organization: 'Organization',
    name: 'Name',
  } satisfies Record<keyof typeof INITIATIVE_VIEW_CONTRACT.fields, string>,
} as const;

/** Runtime metadata for one field that a shared builder may expose. */
export interface WorkViewFieldMetadata<TTarget extends ViewTarget = ViewTarget> {
  readonly target: TTarget;
  readonly key: string;
  readonly label: string;
  readonly kind: ViewFieldKind;
  readonly operators: readonly string[];
  readonly filterable: boolean;
  readonly sortable: boolean;
  readonly groupable: boolean;
  readonly displayable: boolean;
  readonly mutableGroup: boolean;
  readonly acceptsCurrentActor: boolean;
}

/** Return the literal target contract behind a shared work-view control. */
export function workViewContract<TTarget extends ViewTarget>(
  target: TTarget,
): WorkViewContractFor<TTarget> {
  return CONTRACT_BY_TARGET[target];
}

/**
 * The catalog for each target, built once.
 *
 * @remarks
 * The catalog is a pure function of the target, and building one runs a schema parse per field.
 * Three lenses call this on their render path — `work-list`, `work-cards`, `work-board` — so
 * without this it is rebuilt for every roster render.
 */
const CATALOG_BY_TARGET = new Map<ViewTarget, readonly WorkViewFieldMetadata[]>();

/** Return the target's exhaustive, human-labelled field catalog. */
export function workViewFieldCatalog<TTarget extends ViewTarget>(
  target: TTarget,
): readonly WorkViewFieldMetadata<TTarget>[] {
  const cached = CATALOG_BY_TARGET.get(target);
  if (cached) return cached as readonly WorkViewFieldMetadata<TTarget>[];
  const built = buildWorkViewFieldCatalog(target);
  CATALOG_BY_TARGET.set(target, built);
  return built;
}

function buildWorkViewFieldCatalog<TTarget extends ViewTarget>(
  target: TTarget,
): readonly WorkViewFieldMetadata<TTarget>[] {
  const contract = CONTRACT_BY_TARGET[target];
  const labels: Readonly<Record<string, string>> = FIELD_LABELS[target];
  const fields: Readonly<Record<string, ViewFieldDefinition>> = contract.fields;
  return Object.entries(fields).map(([key, field]) => {
    return {
      target,
      key,
      label: labels[key] ?? key,
      kind: field.kind,
      operators: FILTER_OPERATORS_BY_KIND[field.kind],
      filterable: field.capabilities.filter === true,
      sortable: field.capabilities.sort === true,
      groupable: field.capabilities.group === true,
      displayable: field.capabilities.display === true,
      mutableGroup: field.capabilities.mutateGroup === true,
      acceptsCurrentActor: (field.operandSchema ?? field.schema).safeParse({
        kind: 'current-actor',
      }).success,
    };
  });
}

/** Target-bound metadata for a filterable field. */
export type WorkViewFilterFieldMetadata<TTarget extends ViewTarget> =
  WorkViewFieldMetadata<TTarget> & { readonly key: WorkViewFilterFieldKey<TTarget> };

/** Target-bound metadata for a sortable field. */
export type WorkViewSortFieldMetadata<TTarget extends ViewTarget> =
  WorkViewFieldMetadata<TTarget> & {
    readonly key: WorkViewSortFieldKey<TTarget>;
  };

/** Target-bound metadata for a groupable field. */
export type WorkViewGroupFieldMetadata<TTarget extends ViewTarget> =
  WorkViewFieldMetadata<TTarget> & { readonly key: WorkViewGroupFieldKey<TTarget> };

/** Target-bound metadata for a displayable field. */
export type WorkViewDisplayFieldMetadata<TTarget extends ViewTarget> =
  WorkViewFieldMetadata<TTarget> & { readonly key: WorkViewDisplayFieldKey<TTarget> };

/** Return only fields that the target contract permits in predicates. */
export function workViewFilterFieldCatalog<TTarget extends ViewTarget>(
  target: TTarget,
): readonly WorkViewFilterFieldMetadata<TTarget>[] {
  return workViewFieldCatalog(target).filter(
    (field): field is WorkViewFilterFieldMetadata<TTarget> => field.filterable,
  );
}

/** Return only fields that the target contract permits in ordered sorts. */
export function workViewSortFieldCatalog<TTarget extends ViewTarget>(
  target: TTarget,
): readonly WorkViewSortFieldMetadata<TTarget>[] {
  return workViewFieldCatalog(target).filter(
    (field): field is WorkViewSortFieldMetadata<TTarget> => field.sortable,
  );
}

/** Return only fields that the target contract permits in grouping. */
export function workViewGroupFieldCatalog<TTarget extends ViewTarget>(
  target: TTarget,
): readonly WorkViewGroupFieldMetadata<TTarget>[] {
  return workViewFieldCatalog(target).filter(
    (field): field is WorkViewGroupFieldMetadata<TTarget> => field.groupable,
  );
}

/** Return only fields that the target contract permits in row or card properties. */
export function workViewDisplayFieldCatalog<TTarget extends ViewTarget>(
  target: TTarget,
): readonly WorkViewDisplayFieldMetadata<TTarget>[] {
  return workViewFieldCatalog(target).filter(
    (field): field is WorkViewDisplayFieldMetadata<TTarget> => field.displayable,
  );
}

/** Parse a complete definition through the runtime schema selected by its target. */
export function parseWorkViewDefinition<TTarget extends ViewTarget>(
  target: TTarget,
  definition: unknown,
): WorkViewDefinitionFor<TTarget> {
  return DEFINITION_BY_TARGET[target].parse(definition);
}

/** Inputs to the web controller's precedence resolver. */
export interface ResolveControllerViewStateInput<TContract extends ViewContract> {
  readonly fallback: ViewDefinitionFor<TContract>;
  readonly savedOrDefault?: ViewDefinitionFor<TContract> | null;
  readonly personal?: Parameters<typeof resolveWorkViewDefinition<TContract>>[0]['personal'];
  readonly temporaryFilter?: FilterNodeFor<TContract> | null;
}

/** Durable/personal state and its URL-refined executable projection. */
export interface ResolvedControllerViewState<TContract extends ViewContract> {
  readonly definition: ViewDefinitionFor<TContract>;
  readonly temporaryFilter: FilterNodeFor<TContract> | null;
  readonly effectiveDefinition: ViewDefinitionFor<TContract>;
}

/** Resolve each precedence layer while retaining the URL filter as a separate request value. */
export function resolveControllerViewState<const TContract extends ViewContract>(
  input: ResolveControllerViewStateInput<TContract>,
): ResolvedControllerViewState<TContract> {
  const definition = resolveWorkViewDefinition({
    fallback: input.fallback,
    ...(input.savedOrDefault !== undefined ? { savedOrDefault: input.savedOrDefault } : {}),
    ...(input.personal !== undefined ? { personal: input.personal } : {}),
    temporaryFilter: null,
  });
  return {
    definition,
    temporaryFilter: input.temporaryFilter ?? null,
    effectiveDefinition: resolveWorkViewDefinition({
      fallback: definition,
      temporaryFilter: input.temporaryFilter ?? null,
    }),
  };
}

/** Result of converting incomplete editor state into a validated executable filter. */
export type FilterDraftParseResult<TTarget extends ViewTarget> =
  | { readonly success: true; readonly data: WorkViewFilterFor<TTarget> }
  | { readonly success: false; readonly error: string };

interface EditablePredicateDraft {
  readonly kind: 'predicate';
  readonly field: string | null;
  readonly operator: string | null;
  readonly operand?: unknown;
}

interface EditableGroupDraft {
  readonly kind: 'group';
  readonly join: 'all' | 'any';
  readonly children: readonly EditableDraft[];
}

type EditableDraft = EditablePredicateDraft | EditableGroupDraft;

function isChosenField<TField extends string>(field: TField | null): field is TField {
  return field !== null;
}

function executableDraft(
  draft: EditableDraft,
  path: readonly number[],
  negatedPaths: ReadonlySet<string>,
): unknown {
  let node: unknown;
  if (draft.kind === 'group') {
    node = {
      kind: draft.join,
      children: draft.children.map((child, index) =>
        executableDraft(child, [...path, index], negatedPaths),
      ),
    };
  } else if (draft.field === null || draft.operator === null) {
    node = null;
  } else if (draft.operator === 'isEmpty' || draft.operator === 'isNotEmpty') {
    node = { kind: 'predicate', field: draft.field, operator: draft.operator };
  } else {
    node = {
      kind: 'predicate',
      field: draft.field,
      operator: draft.operator,
      operand: draft.operand,
    };
  }
  const key = path.length === 0 ? 'root' : path.join('.');
  return negatedPaths.has(key) ? { kind: 'not', child: node } : node;
}

function incompleteDraftMessage<TTarget extends ViewTarget>(
  target: TTarget,
  draft: WorkViewFilterDraftFor<TTarget>,
): string | null {
  if (draft.kind === 'group') {
    if (draft.children.length === 0) return 'Add at least one condition.';
    for (const child of draft.children) {
      const message = incompleteDraftMessage(target, child);
      if (message) return message;
    }
    return null;
  }
  const fieldKey = draft.field;
  if (!isChosenField(fieldKey)) return 'Choose a filter property.';
  const field = workViewFilterFieldCatalog(target).find((candidate) => candidate.key === fieldKey);
  if (!field) return 'Choose a valid filter property.';
  const operator = draft.operator;
  if (operator === null) return `Choose a ${field.label} operator.`;
  if (!field.operators.includes(operator)) {
    return `Choose a valid ${field.label} operator.`;
  }
  if (operator === 'isEmpty' || operator === 'isNotEmpty') return null;
  if (operator === 'between') {
    if (
      !Array.isArray(draft.operand) ||
      draft.operand.length !== 2 ||
      draft.operand.some((operand) => operand === undefined)
    ) {
      return `Enter both ${field.label} endpoints.`;
    }
    return null;
  }
  if (Array.isArray(draft.operand) && draft.operand.length === 0) {
    return `Select at least one ${field.label} value.`;
  }
  if (draft.operand === undefined || draft.operand === '') {
    return `Enter a ${field.label} value.`;
  }
  return null;
}

/** Validate an incomplete filter draft before execution or persistence. */
export function parseFilterDraft<TTarget extends ViewTarget>(
  target: TTarget,
  draft: WorkViewFilterDraftFor<TTarget>,
  negatedPaths: readonly string[] = [],
): FilterDraftParseResult<TTarget> {
  const incomplete = incompleteDraftMessage(target, draft);
  if (incomplete) return { success: false, error: incomplete };
  const result = FILTER_SCHEMA_BY_TARGET[target].safeParse(
    executableDraft(draft, [], new Set(negatedPaths)),
  );
  if (!result.success) {
    const invalidField = draft.kind === 'predicate' ? draft.field : null;
    const label = isChosenField(invalidField)
      ? workViewFilterFieldCatalog(target).find((candidate) => candidate.key === invalidField)
          ?.label
      : undefined;
    return {
      success: false,
      error: label ? `Enter a valid ${label} value.` : 'Complete every filter condition.',
    };
  }
  return {
    success: true,
    data: canonicalizeFilter(result.data),
  };
}

/** Combine zero or more executable nodes through the target's runtime filter schema. */
export function combineWorkViewFilters<TTarget extends ViewTarget>(
  target: TTarget,
  filters: readonly WorkViewFilterShape<TTarget>[],
): WorkViewFilterFor<TTarget> | null {
  if (filters.length === 0) return null;
  if (filters.length === 1) return FILTER_SCHEMA_BY_TARGET[target].parse(filters[0]);
  return FILTER_SCHEMA_BY_TARGET[target].parse({ kind: 'all', children: filters });
}

/** Delete one personal override so reset reveals the current durable default. */
export function removePersonalViewState(
  states: readonly PersonalWorkViewState[],
  instanceKey: ViewInstanceKey,
): readonly PersonalWorkViewState[] {
  return states.filter((state) => state.instanceKey !== instanceKey);
}

/** Move one sort term while preserving every term's value and relative order. */
export function moveSortTerm<T extends { readonly field: string; readonly direction: string }>(
  terms: readonly T[],
  fromIndex: number,
  toIndex: number,
): readonly T[] {
  if (fromIndex < 0 || fromIndex >= terms.length || toIndex < 0 || toIndex >= terms.length) {
    return terms;
  }
  const next = [...terms];
  const [term] = next.splice(fromIndex, 1);
  if (!term) return terms;
  next.splice(toIndex, 0, term);
  return next;
}

/** Add or remove one property without disturbing the order of the remaining selection. */
export function toggleDisplayedProperty<T extends string>(
  properties: readonly T[],
  property: T,
  selected: boolean,
): readonly T[] {
  if (selected) return properties.includes(property) ? properties : [...properties, property];
  return properties.filter((current) => current !== property);
}

/** Append one sort field unless it is already present in the ordered terms. */
export function appendSortTerm<T extends { readonly field: string; readonly direction: string }>(
  terms: readonly T[],
  term: T,
): readonly T[] {
  return terms.some((current) => current.field === term.field) ? terms : [...terms, term];
}

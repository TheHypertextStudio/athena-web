import { z } from 'zod';

/** The work records that can back a durable view. */
export const VIEW_TARGETS = ['task', 'project', 'program', 'initiative'] as const;

/** A work record family that can back a durable view. */
export type ViewTarget = (typeof VIEW_TARGETS)[number];

/** A renderer family supported by at least one work record target. */
export type ViewLayout = 'list' | 'board' | 'timeline';

/** The storage and editor behavior of one view field. */
export type ViewFieldKind =
  | 'enum'
  | 'relation-one'
  | 'relation-many'
  | 'text'
  | 'date'
  | 'datetime'
  | 'number'
  | 'boolean';

/** Operations that a field may participate in. */
export interface ViewFieldCapabilities {
  /** The filter builder may create predicates over this field. */
  filter?: boolean;
  /** An arrangement may order rows by this field. */
  sort?: boolean;
  /** An arrangement may group rows by this field. */
  group?: boolean;
  /** A renderer may show this field as a row or card property. */
  display?: boolean;
  /** Dropping a row into another group may update this field. */
  mutateGroup?: boolean;
}

/** One field declaration inside a work-view contract. */
export interface ViewFieldDefinition<
  TKind extends ViewFieldKind = ViewFieldKind,
  TSchema extends z.ZodType = z.ZodType,
  TOperandSchema extends z.ZodType | undefined = z.ZodType | undefined,
  TCapabilities extends ViewFieldCapabilities = ViewFieldCapabilities,
> {
  /** The field's editor and operator family. */
  kind: TKind;
  /** Runtime schema of the value projected on a result row. */
  schema: TSchema;
  /** Runtime schema of a predicate operand when it differs from the projected value. */
  operandSchema?: TOperandSchema;
  /** Closed capabilities from which legal field-key unions are derived. */
  capabilities: TCapabilities;
}

/** A view contract whose literal field keys drive every downstream registry. */
export interface ViewContract<
  TTarget extends ViewTarget = ViewTarget,
  TFields extends Record<string, ViewFieldDefinition> = Record<string, ViewFieldDefinition>,
  TLayouts extends NonEmptyReadonlyArray<ViewLayout> = NonEmptyReadonlyArray<ViewLayout>,
> {
  /** The work record family this contract queries. */
  target: TTarget;
  /** The renderer families valid for this target. */
  layouts: TLayouts;
  /** The closed field registry for this work record family. */
  fields: TFields;
}

/** Preserve a work-view declaration's literal target, field keys, and capability flags. */
export function defineViewContract<
  const TTarget extends ViewTarget,
  const TFields extends Record<string, ViewFieldDefinition>,
  const TLayouts extends NonEmptyReadonlyArray<ViewLayout>,
>(contract: ViewContract<TTarget, TFields, TLayouts>): ViewContract<TTarget, TFields, TLayouts> {
  for (const [field, definition] of Object.entries(contract.fields)) {
    if (definition.capabilities.mutateGroup === true && definition.capabilities.group !== true) {
      throw new TypeError(`View field "${field}" can mutate a group only when it is groupable.`);
    }
  }
  return contract;
}

type FieldsOf<TContract extends ViewContract> = TContract['fields'];
type StringKey<T> = Extract<keyof T, string>;

type KeysWithCapability<
  TContract extends ViewContract,
  TCapability extends keyof ViewFieldCapabilities,
> = {
  [TKey in StringKey<FieldsOf<TContract>>]: FieldsOf<TContract>[TKey] extends {
    capabilities: infer TCapabilities;
  }
    ? TCapability extends keyof TCapabilities
      ? TCapabilities[TCapability] extends true
        ? TKey
        : never
      : never
    : never;
}[StringKey<FieldsOf<TContract>>];

/** Field keys that may appear in a predicate for this contract. */
export type FilterableFieldKey<TContract extends ViewContract> = KeysWithCapability<
  TContract,
  'filter'
>;

/** Field keys that may appear in an ordered sort for this contract. */
export type SortableFieldKey<TContract extends ViewContract> = KeysWithCapability<
  TContract,
  'sort'
>;

/** Field keys that may define a group or subgroup for this contract. */
export type GroupableFieldKey<TContract extends ViewContract> = KeysWithCapability<
  TContract,
  'group'
>;

/** Field keys that a row or card renderer may expose. */
export type DisplayableFieldKey<TContract extends ViewContract> = KeysWithCapability<
  TContract,
  'display'
>;

/** Groupable field keys whose value a cross-group drop may update. */
export type MutableGroupKey<TContract extends ViewContract> = KeysWithCapability<
  TContract,
  'mutateGroup'
>;

/** Renderer families accepted by this contract. */
export type LayoutFor<TContract extends ViewContract> = TContract['layouts'][number];

/** A readonly array whose first item is guaranteed to exist. */
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

/** Operators with no operand by construction. */
export type UnaryFilterOperator = 'isEmpty' | 'isNotEmpty';

/** Operators available to fixed enums and single relations. */
export type ScalarChoiceFilterOperator =
  | 'is'
  | 'isNot'
  | 'isAnyOf'
  | 'isNoneOf'
  | UnaryFilterOperator;

/** Operators available to multi-valued relations. */
export type RelationSetFilterOperator =
  | 'includesAny'
  | 'includesAll'
  | 'includesNone'
  | UnaryFilterOperator;

/** Operators available to text fields. */
export type TextFilterOperator = 'is' | 'isNot' | 'contains' | 'notContains' | UnaryFilterOperator;

/** Operators available to dates and timestamps. */
export type TemporalFilterOperator =
  | 'on'
  | 'before'
  | 'after'
  | 'onOrBefore'
  | 'onOrAfter'
  | 'between'
  | UnaryFilterOperator;

/** Operators available to numeric fields. */
export type NumberFilterOperator =
  | 'is'
  | 'isNot'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'between'
  | UnaryFilterOperator;

/** Operators available to boolean fields. */
export type BooleanFilterOperator = 'is';

/** The operator union selected by a field kind. */
export type FilterOperatorForKind<TKind extends ViewFieldKind> = TKind extends
  | 'enum'
  | 'relation-one'
  ? ScalarChoiceFilterOperator
  : TKind extends 'relation-many'
    ? RelationSetFilterOperator
    : TKind extends 'text'
      ? TextFilterOperator
      : TKind extends 'date' | 'datetime'
        ? TemporalFilterOperator
        : TKind extends 'number'
          ? NumberFilterOperator
          : TKind extends 'boolean'
            ? BooleanFilterOperator
            : never;

type OperandOf<TField extends ViewFieldDefinition> = TField extends {
  operandSchema: infer TSchema extends z.ZodType;
}
  ? z.infer<TSchema>
  : z.infer<TField['schema']>;

/** Projected runtime value for one declared field. */
export type FieldValueFor<
  TContract extends ViewContract,
  TField extends StringKey<FieldsOf<TContract>>,
> = z.infer<FieldsOf<TContract>[TField]['schema']>;

/** Predicate and mutable-group operand for one declared field. */
export type FieldOperandFor<
  TContract extends ViewContract,
  TField extends StringKey<FieldsOf<TContract>>,
> = OperandOf<FieldsOf<TContract>[TField]>;

type SetFilterOperator = 'isAnyOf' | 'isNoneOf' | 'includesAny' | 'includesAll' | 'includesNone';

type PredicateForOperator<
  TFieldKey extends string,
  TField extends ViewFieldDefinition,
  TOperator extends FilterOperatorForKind<TField['kind']>,
> = TOperator extends UnaryFilterOperator
  ? {
      readonly kind: 'predicate';
      readonly field: TFieldKey;
      readonly operator: TOperator;
    }
  : TOperator extends SetFilterOperator
    ? {
        readonly kind: 'predicate';
        readonly field: TFieldKey;
        readonly operator: TOperator;
        readonly operand: NonEmptyReadonlyArray<OperandOf<TField>>;
      }
    : TOperator extends 'between'
      ? {
          readonly kind: 'predicate';
          readonly field: TFieldKey;
          readonly operator: TOperator;
          readonly operand: readonly [OperandOf<TField>, OperandOf<TField>];
        }
      : {
          readonly kind: 'predicate';
          readonly field: TFieldKey;
          readonly operator: TOperator;
          readonly operand: OperandOf<TField>;
        };

type PredicateForField<TFieldKey extends string, TField extends ViewFieldDefinition> =
  FilterOperatorForKind<TField['kind']> extends infer TOperator
    ? TOperator extends FilterOperatorForKind<TField['kind']>
      ? PredicateForOperator<TFieldKey, TField, TOperator>
      : never
    : never;

/** The field-specific predicate union derived from one contract. */
export type FilterPredicateFor<TContract extends ViewContract> = {
  [TKey in FilterableFieldKey<TContract>]: PredicateForField<TKey, FieldsOf<TContract>[TKey]>;
}[FilterableFieldKey<TContract>];

/** A recursive boolean expression over an already-derived predicate union. */
export type FilterNode<TPredicate extends { readonly kind: 'predicate' }> =
  | TPredicate
  | {
      readonly kind: 'all' | 'any';
      readonly children: NonEmptyReadonlyArray<FilterNode<TPredicate>>;
    }
  | { readonly kind: 'not'; readonly child: FilterNode<TPredicate> };

/** A recursive filter expression derived from one view contract. */
export type FilterNodeFor<TContract extends ViewContract> = FilterNode<
  FilterPredicateFor<TContract>
>;

/** One ordered sort term whose field is sortable for this contract. */
export interface SortTermFor<TContract extends ViewContract> {
  /** Field whose semantic value determines this sort position. */
  readonly field: SortableFieldKey<TContract>;
  /** Direction applied after semantic ranking and null placement. */
  readonly direction: 'asc' | 'desc';
}

/** Grouping and ordered sorting for one executable view. */
export interface ViewArrangementFor<TContract extends ViewContract> {
  /** Primary group field, or no grouping. */
  readonly groupBy: GroupableFieldKey<TContract> | null;
  /** Nested group field, or no subgrouping. */
  readonly subGroupBy: GroupableFieldKey<TContract> | null;
  /** Sort terms applied in their declared order. */
  readonly orderBy: readonly SortTermFor<TContract>[];
}

/** Renderer configuration for one executable view. */
export interface ViewPresentationFor<TContract extends ViewContract> {
  /** Renderer family selected for this target. */
  readonly layout: LayoutFor<TContract>;
  /** Row or card fields selected for display. */
  readonly properties: readonly DisplayableFieldKey<TContract>[];
  /** Shared spacing preference for rows and cards. */
  readonly density: 'comfortable' | 'compact';
  /** Whether grouping renderers keep groups with no current matches. */
  readonly showEmptyGroups: boolean;
}

/** A complete versioned view definition derived from one literal contract. */
export interface ViewDefinitionFor<TContract extends ViewContract> {
  /** Durable schema version. */
  readonly version: 2;
  /** Target discriminator that must match the contract. */
  readonly target: TContract['target'];
  /** Executable filter formula, or no saved filter. */
  readonly filter: FilterNodeFor<TContract> | null;
  /** Grouping and ordered sorting. */
  readonly arrangement: ViewArrangementFor<TContract>;
  /** Renderer and property selection. */
  readonly presentation: ViewPresentationFor<TContract>;
}

/** Incomplete filter-editor state that cannot be executed or persisted. */
export type FilterDraft<TContract extends ViewContract> =
  | {
      readonly kind: 'predicate';
      readonly field: FilterableFieldKey<TContract> | null;
      readonly operator: string | null;
      readonly operand?: unknown;
    }
  | {
      readonly kind: 'group';
      readonly join: 'all' | 'any';
      readonly children: readonly FilterDraft<TContract>[];
    };

const OPERATORS_BY_KIND = {
  enum: ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'],
  'relation-one': ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'],
  'relation-many': ['includesAny', 'includesAll', 'includesNone', 'isEmpty', 'isNotEmpty'],
  text: ['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  date: ['on', 'before', 'after', 'onOrBefore', 'onOrAfter', 'between', 'isEmpty', 'isNotEmpty'],
  datetime: [
    'on',
    'before',
    'after',
    'onOrBefore',
    'onOrAfter',
    'between',
    'isEmpty',
    'isNotEmpty',
  ],
  number: [
    'is',
    'isNot',
    'greaterThan',
    'greaterThanOrEqual',
    'lessThan',
    'lessThanOrEqual',
    'between',
    'isEmpty',
    'isNotEmpty',
  ],
  boolean: ['is'],
} as const satisfies Record<ViewFieldKind, readonly string[]>;

function predicateVariant(field: string, operator: string, operandSchema: z.ZodType): z.ZodType {
  const base = {
    kind: z.literal('predicate'),
    field: z.literal(field),
    operator: z.literal(operator),
  };
  if (operator === 'isEmpty' || operator === 'isNotEmpty') return z.object(base).strict();
  if (
    operator === 'isAnyOf' ||
    operator === 'isNoneOf' ||
    operator === 'includesAny' ||
    operator === 'includesAll' ||
    operator === 'includesNone'
  ) {
    return z.object({ ...base, operand: z.array(operandSchema).min(1) }).strict();
  }
  if (operator === 'between') {
    return z.object({ ...base, operand: z.tuple([operandSchema, operandSchema]) }).strict();
  }
  return z.object({ ...base, operand: operandSchema }).strict();
}

interface FilterMeasure {
  readonly depth: number;
  readonly predicates: number;
}

function measureFilter(node: unknown, depth = 0): FilterMeasure {
  if (typeof node !== 'object' || node === null) return { depth, predicates: 0 };
  const record = node as Record<string, unknown>;
  if (record['kind'] === 'predicate') return { depth, predicates: 1 };
  if (record['kind'] === 'not') {
    const child = measureFilter(record['child'], depth + 1);
    return { depth: Math.max(depth + 1, child.depth), predicates: child.predicates };
  }
  if (record['kind'] === 'all' || record['kind'] === 'any') {
    const children = Array.isArray(record['children']) ? record['children'] : [];
    return children.reduce<FilterMeasure>(
      (result, child) => {
        const measured = measureFilter(child, depth + 1);
        return {
          depth: Math.max(result.depth, measured.depth),
          predicates: result.predicates + measured.predicates,
        };
      },
      { depth: depth + 1, predicates: 0 },
    );
  }
  return { depth, predicates: 0 };
}

/** Build the recursive runtime filter schema derived from a literal field contract. */
export function createFilterNodeSchema<const TContract extends ViewContract>(
  contract: TContract,
): z.ZodType<FilterNodeFor<TContract>> {
  const variants: z.ZodType[] = [];
  for (const [field, definition] of Object.entries(contract.fields)) {
    if (definition.capabilities.filter !== true) continue;
    const operandSchema = definition.operandSchema ?? definition.schema;
    for (const operator of OPERATORS_BY_KIND[definition.kind]) {
      variants.push(predicateVariant(field, operator, operandSchema));
    }
  }
  if (variants.length === 0) {
    throw new TypeError(`The ${contract.target} view contract has no filterable fields.`);
  }

  const predicateSchema = z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  const recursive: z.ZodType = z.lazy(() =>
    z.union([
      predicateSchema,
      z
        .object({
          kind: z.enum(['all', 'any']),
          children: z.array(recursive).min(1),
        })
        .strict(),
      z.object({ kind: z.literal('not'), child: recursive }).strict(),
    ]),
  );

  return recursive
    .superRefine((node, context) => {
      const measured = measureFilter(node);
      if (measured.depth > 5) {
        context.addIssue({
          code: 'custom',
          message: 'A view filter may contain at most five nested groups.',
        });
      }
      if (measured.predicates > 100) {
        context.addIssue({
          code: 'custom',
          message: 'A view filter may contain at most 100 predicates.',
        });
      }
    })
    .transform((node) => node as FilterNodeFor<TContract>);
}

declare const canonicalFilter: unique symbol;

/** A filter expression that passed limits and deterministic normalization. */
export type CanonicalFilter<TPredicate extends { readonly kind: 'predicate' }> =
  FilterNode<TPredicate> & {
    readonly [canonicalFilter]: true;
  };

function stableJson(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol')
    return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function canonicalNode<TPredicate extends { readonly kind: 'predicate' }>(
  node: FilterNode<TPredicate>,
): FilterNode<TPredicate> {
  if (node.kind === 'predicate') {
    return { ...node };
  }
  if (node.kind === 'not') {
    const child = canonicalNode(node.child);
    if (child.kind === 'not') return canonicalNode(child.child);
    return { kind: 'not', child };
  }

  const flattened: FilterNode<TPredicate>[] = [];
  for (const child of node.children) {
    const canonicalChild = canonicalNode(child);
    if (canonicalChild.kind === node.kind) {
      flattened.push(...canonicalChild.children);
    } else {
      flattened.push(canonicalChild);
    }
  }
  const unique = new Map(flattened.map((child) => [stableJson(child), child]));
  const children = [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, child]) => child) as [FilterNode<TPredicate>, ...FilterNode<TPredicate>[]];
  return { kind: node.kind, children };
}

/** Normalize a filter without changing its meaning or mutating the caller's expression. */
export function canonicalizeFilter<TPredicate extends { readonly kind: 'predicate' }>(
  filter: FilterNode<TPredicate>,
): CanonicalFilter<TPredicate> {
  const measured = measureFilter(filter);
  if (measured.depth > 5)
    throw new RangeError('A view filter may contain at most five nested groups.');
  if (measured.predicates > 100) {
    throw new RangeError('A view filter may contain at most 100 predicates.');
  }
  return canonicalNode(filter) as CanonicalFilter<TPredicate>;
}

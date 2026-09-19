import {
  and,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  not,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { ViewFieldKind } from '@docket/work/view-contract';

import { resolveTemporalRange, type TemporalRange } from './temporal-sql';

/** A scalar field that compiles directly against one SQL value expression. */
export interface ScalarFilterCompiler {
  /** Operator family declared by the shared target contract. */
  readonly kind: Exclude<ViewFieldKind, 'relation-many'>;
  /** SQL value expression for the field. */
  readonly value: SQL;
}

/** A multi-relation field compiled with correlated `EXISTS` predicates. */
export interface RelationFilterCompiler {
  /** The relation-many operator family. */
  readonly kind: 'relation-many';
  /** Build a correlated `EXISTS` expression for one operand. */
  readonly exists: (operand: unknown) => SQL;
  /** Test whether the correlated relation has no rows. */
  readonly isEmpty: SQL;
}

/** One filterable field's SQL compiler. */
export type FilterFieldCompiler = ScalarFilterCompiler | RelationFilterCompiler;

/** An exhaustive SQL compiler registry for a derived target field-key union. */
export type FilterCompilerMap<TKey extends string> = Readonly<Record<TKey, FilterFieldCompiler>>;

/** The runtime filter shape consumed after target-specific Zod validation. */
export type ExecutableFilterNode<TKey extends string = string> =
  | {
      readonly kind: 'predicate';
      readonly field: TKey;
      readonly operator: string;
      readonly operand?: unknown;
    }
  | {
      readonly kind: 'all' | 'any';
      readonly children: readonly ExecutableFilterNode<TKey>[];
    }
  | { readonly kind: 'not'; readonly child: ExecutableFilterNode<TKey> };

/** Request-scoped symbolic values resolved while compiling a filter. */
export interface FilterSqlContext {
  /** Authenticated actor substituted for `current-actor` operands. */
  readonly currentActorId?: string;
  /** Frozen instant used for rolling and calendar operands. */
  readonly now?: Date;
  /** IANA timezone used to resolve calendar boundaries. */
  readonly timeZone?: string;
}

function operandValue(operand: unknown, context: FilterSqlContext): unknown {
  if (operand !== null && typeof operand === 'object' && 'kind' in operand) {
    const symbolic = operand as {
      readonly kind: string;
      readonly value?: unknown;
      readonly actorId?: unknown;
    };
    if (symbolic.kind === 'absolute') return symbolic.value;
    if (symbolic.kind === 'actor') return symbolic.actorId;
    if (symbolic.kind === 'current-actor') {
      if (!context.currentActorId) {
        throw new TypeError('A current-actor filter requires an authenticated actor.');
      }
      return context.currentActorId;
    }
  }
  return operand;
}

function list(operand: unknown, context: FilterSqlContext): readonly unknown[] {
  if (!Array.isArray(operand) || operand.length === 0) {
    throw new TypeError('A set predicate requires at least one operand.');
  }
  return operand.map((value) => operandValue(value, context));
}

function compileRelation(
  operator: string,
  operand: unknown,
  field: RelationFilterCompiler,
  context: FilterSqlContext,
): SQL {
  switch (operator) {
    case 'includesAny': {
      const conditions = list(operand, context).map(field.exists);
      return or(...conditions) ?? field.isEmpty;
    }
    case 'includesAll':
      return and(...list(operand, context).map(field.exists)) ?? field.isEmpty;
    case 'includesNone':
      return not(or(...list(operand, context).map(field.exists)) ?? field.isEmpty);
    case 'isEmpty':
      return field.isEmpty;
    case 'isNotEmpty':
      return not(field.isEmpty);
    default:
      throw new TypeError(`Unsupported relation filter operator: ${operator}`);
  }
}

/** One scalar predicate, with the operand already resolved against the actor and clock. */
interface ScalarPredicate {
  readonly operator: string;
  readonly operand: unknown;
  readonly field: ScalarFilterCompiler;
  readonly context: FilterSqlContext;
  /** The operand as a plain value, after any symbolic operand resolved. */
  readonly value: unknown;
  /** The half-open day window a symbolic date operand names, when the operand is one. */
  readonly range: TemporalRange | null;
}

function compileScalar(
  operator: string,
  operand: unknown,
  field: ScalarFilterCompiler,
  context: FilterSqlContext,
): SQL {
  const predicate: ScalarPredicate = {
    operator,
    operand,
    field,
    context,
    value: operandValue(operand, context),
    range: resolveTemporalRange(operand, field, context),
  };
  return (
    compileScalarEquality(predicate) ??
    compileScalarOrdering(predicate) ??
    compileScalarPresence(predicate) ??
    unsupportedOperator(field.kind, operator)
  );
}

/** Equality, set membership, and substring operators. */
function compileScalarEquality(predicate: ScalarPredicate): SQL | null {
  const { operand, field, context, value, range } = predicate;
  switch (predicate.operator) {
    case 'is':
    case 'on':
      return range
        ? requiredCondition(and(gte(field.value, range.start), lt(field.value, range.end)))
        : eq(field.value, value);
    case 'isNot':
      return sqlDistinct(field.value, value);
    case 'isAnyOf':
      return inArray(field.value, [...list(operand, context)]);
    case 'isNoneOf':
      return notInArray(field.value, [...list(operand, context)]);
    case 'contains':
      return sql`${field.value} ilike ${`%${likeLiteral(value)}%`} escape '\\'`;
    case 'notContains':
      return not(sql`${field.value} ilike ${`%${likeLiteral(value)}%`} escape '\\'`);
    default:
      return null;
  }
}

/**
 * Ordering and range operators.
 *
 * @remarks
 * A symbolic date operand names a half-open day window rather than an instant, so "after today"
 * compares against the window's exclusive end and "on or before today" against the same edge.
 */
function compileScalarOrdering(predicate: ScalarPredicate): SQL | null {
  return compileDayOrdering(predicate) ?? compareValueOrdering(predicate);
}

/**
 * The day-shaped ordering operators, which read a symbolic operand as a window.
 *
 * @param predicate - The scalar predicate.
 * @returns The condition, or `null` when the operator belongs to another family.
 */
function compileDayOrdering({ operator, field, value, range }: ScalarPredicate): SQL | null {
  switch (operator) {
    case 'before':
      return lt(field.value, range?.start ?? value);
    case 'after':
      return range === null ? gt(field.value, value) : gte(field.value, range.end);
    case 'onOrBefore':
      return range === null ? lte(field.value, value) : lt(field.value, range.end);
    case 'onOrAfter':
      return gte(field.value, range?.start ?? value);
    default:
      return null;
  }
}

/**
 * The plain value-ordering operators, which compare against the operand as given.
 *
 * @param predicate - The scalar predicate.
 * @returns The condition, or `null` when the operator belongs to another family.
 */
function compareValueOrdering(predicate: ScalarPredicate): SQL | null {
  const { field, value } = predicate;
  switch (predicate.operator) {
    case 'lessThan':
      return lt(field.value, value);
    case 'greaterThan':
      return gt(field.value, value);
    case 'lessThanOrEqual':
      return lte(field.value, value);
    case 'greaterThanOrEqual':
      return gte(field.value, value);
    case 'between':
      return compileBetween(predicate);
    default:
      return null;
  }
}

/** Null-presence operators. */
function compileScalarPresence(predicate: ScalarPredicate): SQL | null {
  switch (predicate.operator) {
    case 'isEmpty':
      return isNull(predicate.field.value);
    case 'isNotEmpty':
      return isNotNull(predicate.field.value);
    default:
      return null;
  }
}

/** The two-operand range operator, whose upper bound is exclusive for a symbolic day window. */
function compileBetween({ operand, field, context }: ScalarPredicate): SQL {
  if (!Array.isArray(operand) || operand.length !== 2) {
    throw new TypeError('A between predicate requires exactly two operands.');
  }
  const lowerRange = resolveTemporalRange(operand[0], field, context);
  const upperRange = resolveTemporalRange(operand[1], field, context);
  const lower = lowerRange?.start ?? operandValue(operand[0], context);
  const upper = upperRange?.end ?? operandValue(operand[1], context);
  return requiredCondition(
    and(gte(field.value, lower), upperRange ? lt(field.value, upper) : lte(field.value, upper)),
  );
}

/** Refuse an operator no scalar family compiles. */
function unsupportedOperator(kind: string, operator: string): never {
  throw new TypeError(`Unsupported ${kind} filter operator: ${operator}`);
}

function requiredCondition(condition: SQL | undefined): SQL {
  if (!condition) throw new TypeError('A SQL condition unexpectedly compiled empty.');
  return condition;
}

function sqlDistinct(value: SQL, operand: unknown): SQL {
  return sql`${value} is distinct from ${operand}`;
}

function likeLiteral(value: unknown): string {
  return String(value).replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

/**
 * Compile a validated recursive work-view filter into one SQL condition.
 *
 * @param node - Target-validated nested filter expression.
 * @param fields - Exhaustive compiler registry for that target.
 * @param context - Actor, clock, and timezone used for symbolic operands.
 * @returns One SQL condition that preserves `all`, `any`, and `not` nesting.
 */
export function compileFilterSql<TKey extends string>(
  node: ExecutableFilterNode<TKey>,
  fields: FilterCompilerMap<TKey>,
  context: FilterSqlContext = {},
): SQL {
  switch (node.kind) {
    case 'all':
      return (
        and(...node.children.map((child) => compileFilterSql(child, fields, context))) ?? sql`true`
      );
    case 'any':
      return (
        or(...node.children.map((child) => compileFilterSql(child, fields, context))) ?? sql`false`
      );
    case 'not':
      return not(compileFilterSql(node.child, fields, context));
    case 'predicate': {
      const field = fields[node.field];
      return field.kind === 'relation-many'
        ? compileRelation(node.operator, node.operand, field, context)
        : compileScalar(node.operator, node.operand, field, context);
    }
  }
}

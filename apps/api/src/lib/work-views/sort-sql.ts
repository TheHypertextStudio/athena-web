import { and, gt, lt, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import type { WorkViewCursorScalar } from './cursor';

/** One sortable field's raw value and optional semantic rank. */
export interface SortFieldCompiler {
  /** Stored value used for ordering and cursor continuation. */
  readonly value: SQL;
  /** Runtime schema for the value serialized into a cursor. */
  readonly cursor: z.ZodType<WorkViewCursorScalar>;
  /** Product-defined rank used before the stored value. */
  readonly semanticRanks?: readonly SQL[];
  /** Runtime schemas paired with semantic rank expressions. */
  readonly semanticCursorSchemas?: readonly z.ZodType<WorkViewCursorScalar>[];
  /** Optional direction for each semantic expression instead of the requested term direction. */
  readonly semanticDirections?: readonly ('term' | 'asc' | 'desc')[];
  /** Optional direction for the stored value instead of the requested term direction. */
  readonly valueDirection?: 'term' | 'asc' | 'desc';
}

/** An exhaustive SQL sort registry for a derived target field-key union. */
export type SortCompilerMap<TKey extends string> = Readonly<Record<TKey, SortFieldCompiler>>;

/** One ordered target-specific sort term. */
export interface ExecutableSortTerm<TKey extends string> {
  /** Sortable target field. */
  readonly field: TKey;
  /** Direction applied to semantic rank and stored value. */
  readonly direction: 'asc' | 'desc';
}

function ordered(expression: SQL, direction: 'asc' | 'desc'): SQL {
  return direction === 'asc'
    ? sql`${expression} asc nulls last`
    : sql`${expression} desc nulls last`;
}

function resolvedDirection(
  requested: 'asc' | 'desc',
  override: 'term' | 'asc' | 'desc' | undefined,
): 'asc' | 'desc' {
  return override === undefined || override === 'term' ? requested : override;
}

/**
 * Compile ordered multi-sort terms and append the stable entity-id tiebreaker.
 *
 * @param terms - Sort terms in user-declared priority order.
 * @param fields - Exhaustive compiler registry for the target.
 * @param entityId - Stable entity-id SQL expression.
 * @returns SQL order expressions suitable for `ORDER BY`.
 */
export function compileSortSql<TKey extends string>(
  terms: readonly ExecutableSortTerm<TKey>[],
  fields: SortCompilerMap<TKey>,
  entityId: SQL,
  fallback?: SortFieldCompiler,
): SQL[] {
  const result: SQL[] = [];
  if (terms.length === 0 && fallback) result.push(ordered(fallback.value, 'asc'));
  for (const term of terms) {
    const field = fields[term.field];
    for (const [index, semanticRank] of (field.semanticRanks ?? []).entries()) {
      result.push(
        ordered(semanticRank, resolvedDirection(term.direction, field.semanticDirections?.[index])),
      );
    }
    result.push(ordered(field.value, resolvedDirection(term.direction, field.valueDirection)));
  }
  result.push(sql`${entityId} asc`);
  return result;
}

/** Return the semantic and raw expressions captured in a cursor, in comparison order. */
export function sortValueExpressions<TKey extends string>(
  terms: readonly ExecutableSortTerm<TKey>[],
  fields: SortCompilerMap<TKey>,
  fallback?: SortFieldCompiler,
): SQL[] {
  if (terms.length === 0) return fallback ? [fallback.value] : [];
  return terms.flatMap((term) => {
    const field = fields[term.field];
    return [...(field.semanticRanks ?? []), field.value];
  });
}

/**
 * Compile strict lexicographic continuation after a complete sort tuple.
 *
 * @param terms - Sort terms used by the query.
 * @param fields - Target sort compiler registry.
 * @param tuple - Cursor values for every semantic and raw expression.
 * @param entityId - Stable entity-id SQL expression.
 * @param cursorEntityId - Last entity id from the cursor.
 * @returns A keyset condition that follows the same nulls-last order as `ORDER BY`.
 */
export function compileKeysetSql<TKey extends string>(
  terms: readonly ExecutableSortTerm<TKey>[],
  fields: SortCompilerMap<TKey>,
  tuple: readonly WorkViewCursorScalar[],
  entityId: SQL,
  cursorEntityId: string,
  fallback?: SortFieldCompiler,
): SQL {
  const positions = terms.flatMap((term) => {
    const field = fields[term.field];
    return [
      ...(field.semanticRanks ?? []).map((expression, index) => ({
        expression,
        direction: resolvedDirection(term.direction, field.semanticDirections?.[index]),
      })),
      {
        expression: field.value,
        direction: resolvedDirection(term.direction, field.valueDirection),
      },
    ];
  });
  if (terms.length === 0 && fallback) {
    positions.push({ expression: fallback.value, direction: 'asc' });
  }
  if (positions.length !== tuple.length) {
    throw new TypeError('The page cursor does not match this view sort.');
  }
  const prior: SQL[] = [];
  const branches: SQL[] = [];
  for (const [index, position] of positions.entries()) {
    const value = tuple[index];
    const after =
      value === null
        ? sql`false`
        : requiredCondition(
            or(
              sql`${position.expression} is null`,
              position.direction === 'asc'
                ? gt(position.expression, value)
                : lt(position.expression, value),
            ),
          );
    branches.push(requiredCondition(and(...prior, after)));
    prior.push(sql`${position.expression} is not distinct from ${value}`);
  }
  branches.push(requiredCondition(and(...prior, gt(entityId, cursorEntityId))));
  return requiredCondition(or(...branches));
}

/**
 * Validate a decoded cursor tuple against the selected sort expressions.
 *
 * @param terms - Sort terms selected by the request.
 * @param fields - Runtime sort compiler registry.
 * @param tuple - Decoded scalar tuple.
 * @param fallback - Manual-rank sort used when no explicit terms exist.
 * @throws {TypeError} When tuple arity or a scalar type does not match.
 */
export function validateSortTuple<TKey extends string>(
  terms: readonly ExecutableSortTerm<TKey>[],
  fields: SortCompilerMap<TKey>,
  tuple: readonly WorkViewCursorScalar[],
  fallback?: SortFieldCompiler,
): void {
  const schemas =
    terms.length === 0 && fallback
      ? [fallback.cursor]
      : terms.flatMap((term) => {
          const field = fields[term.field];
          return [...(field.semanticCursorSchemas ?? []), field.cursor];
        });
  if (schemas.length !== tuple.length) throw new TypeError('Cursor tuple arity does not match.');
  schemas.forEach((schema, index) => schema.parse(tuple[index]));
}

function requiredCondition(condition: SQL | undefined): SQL {
  if (!condition) throw new TypeError('A SQL ordering condition unexpectedly compiled empty.');
  return condition;
}

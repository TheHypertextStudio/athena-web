'use client';

import type { FieldCatalog, ViewFilterTerm } from './field-catalog';
import { findField, labelForValue } from './field-catalog';

/** Coerce an accessor result to a string for scalar comparison. */
function asScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Coerce a stored filter `value` to a set of strings for `in` / `nin`. */
function asScalarSet(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    const out = new Set<string>();
    for (const entry of value) {
      const scalar = asScalar(entry);
      if (scalar !== null) out.add(scalar);
    }
    return out;
  }
  const single = asScalar(value);
  return single === null ? new Set() : new Set([single]);
}

/** Operator labels for {@link describeFilterTerm}. */
const OPERATOR_LABEL: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  in: 'is any of',
  nin: 'is none of',
  gt: 'is after',
  lt: 'is before',
  contains: 'contains',
};

/**
 * Render one filter predicate as a short, human-readable summary ("Status is Active").
 *
 * @typeParam T - The row type.
 * @param filter - The predicate.
 * @param catalog - The page's field catalog (resolves the field label + value labels).
 * @returns the plain-language description for the filter chip.
 */
export function describeFilterTerm<T>(filter: ViewFilterTerm, catalog: FieldCatalog<T>): string {
  const field = findField(catalog, filter.field);
  const fieldLabel = field?.label ?? filter.field;
  const op = OPERATOR_LABEL[filter.op] ?? filter.op;
  const toLabel = (value: string): string => (field ? labelForValue(field, value) : value);
  if (filter.op === 'in' || filter.op === 'nin') {
    const values = [...asScalarSet(filter.value)].map(toLabel);
    return `${fieldLabel} ${op} ${values.join(', ') || '—'}`;
  }
  const scalar = asScalar(filter.value);
  return `${fieldLabel} ${op} ${scalar === null ? '—' : toLabel(scalar)}`;
}

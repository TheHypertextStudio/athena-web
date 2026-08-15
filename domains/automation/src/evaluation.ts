import type { AutomationEventMatch, Predicate, PredicateValue } from './contracts';

/** Resolve a dotted path into an event without throwing on an absent or scalar intermediate. */
function getPath(event: unknown, path: string): unknown {
  let current: unknown = event;

  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/** Apply one predicate leaf comparison to a resolved event value. */
function compareLeaf(
  op: 'eq' | 'neq' | 'contains' | 'gte' | 'lte',
  actual: unknown,
  value: PredicateValue,
): boolean {
  switch (op) {
    case 'eq':
      return actual === value;
    case 'neq':
      return actual !== value;
    case 'contains':
      if (Array.isArray(actual)) return actual.includes(value);
      if (typeof actual === 'string') return actual.includes(String(value));
      return false;
    case 'gte':
      return typeof actual === 'number' && typeof value === 'number' && actual >= value;
    case 'lte':
      return typeof actual === 'number' && typeof value === 'number' && actual <= value;
  }
}

/**
 * Evaluate a declarative predicate against an event object.
 *
 * @remarks
 * `and` is vacuously true on an empty node list, while `or` is false. Missing paths resolve to
 * `undefined`; evaluating a rule against incomplete event data therefore never throws.
 *
 * @param predicate - The declarative condition tree.
 * @param event - The event object to inspect.
 * @returns Whether the event satisfies the predicate.
 */
export function evaluatePredicate(predicate: Predicate, event: unknown): boolean {
  switch (predicate.op) {
    case 'and':
      return predicate.nodes.every((node) => evaluatePredicate(node, event));
    case 'or':
      return predicate.nodes.some((node) => evaluatePredicate(node, event));
    case 'not':
      return !evaluatePredicate(predicate.node, event);
    default:
      return compareLeaf(predicate.op, getPath(event, predicate.path), predicate.value);
  }
}

/**
 * Determine whether an event satisfies an Automation Rule's `on` clause.
 *
 * @remarks
 * Each present match field must equal the event's corresponding property. An absent field is a
 * wildcard, so an empty match accepts every event.
 *
 * @param on - The declarative event match.
 * @param event - The event object to inspect.
 * @returns Whether the event matches every specified field.
 */
export function matchesAutomationEvent(on: AutomationEventMatch, event: unknown): boolean {
  const record = (event ?? {}) as Record<string, unknown>;

  if (on.kind !== undefined && record['kind'] !== on.kind) return false;
  if (on.subjectType !== undefined && record['subjectType'] !== on.subjectType) return false;
  if (on.source !== undefined && record['source'] !== on.source) return false;
  if (on.entityKind !== undefined && record['entityKind'] !== on.entityKind) return false;

  return true;
}

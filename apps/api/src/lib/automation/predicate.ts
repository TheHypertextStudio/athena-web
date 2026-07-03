/**
 * `@docket/api` — the automation predicate Interpreter.
 *
 * @remarks
 * The pure, side-effect-free core of the automation engine (the Interpreter pattern over a
 * Composite {@link Predicate} grammar). It evaluates a declarative condition — *data*, loaded
 * from the `automation_rule` table — against an event object (an observation projected to a
 * plain record). It performs no I/O and never throws on missing data: a path that does not
 * resolve simply compares as `undefined`. See `docs/engineering/specs/automations.md`.
 */
import type { Predicate, PredicateValue } from '@docket/types';

/**
 * Resolve a dotted path (`payload.category`) into a value, or `undefined` if any segment is
 * absent. Pure; tolerates non-object intermediates without throwing.
 */
function getPath(event: unknown, path: string): unknown {
  let current: unknown = event;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Apply one leaf comparison operator to a resolved value. */
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
 * Evaluate a predicate against an event object.
 *
 * @remarks
 * `and` is vacuously true on an empty node list; `or` is false on an empty list — the
 * standard boolean identities, so a rule with no positive condition never fires by accident.
 *
 * @param predicate - The declarative condition tree.
 * @param event - The event object (an observation projected to a plain record).
 * @returns whether the event satisfies the predicate.
 */
export function evaluate(predicate: Predicate, event: unknown): boolean {
  switch (predicate.op) {
    case 'and':
      return predicate.nodes.every((node) => evaluate(node, event));
    case 'or':
      return predicate.nodes.some((node) => evaluate(node, event));
    case 'not':
      return !evaluate(predicate.node, event);
    default:
      return compareLeaf(predicate.op, getPath(event, predicate.path), predicate.value);
  }
}

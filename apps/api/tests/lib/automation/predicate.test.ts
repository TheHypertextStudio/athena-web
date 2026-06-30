import { describe, expect, it } from 'vitest';

import type { Predicate } from '@docket/types';

import { evaluate } from '../../../src/lib/automation/predicate';

/** A representative observation-shaped event the engine evaluates predicates against. */
const event = {
  kind: 'task.completed',
  subjectType: 'task',
  payload: { category: 'promotions', labels: ['inbox', 'work'], confidence: 80 },
};

describe('evaluate (predicate interpreter)', () => {
  it('eq matches a top-level path and fails on mismatch', () => {
    expect(evaluate({ op: 'eq', path: 'kind', value: 'task.completed' }, event)).toBe(true);
    expect(evaluate({ op: 'eq', path: 'kind', value: 'task.created' }, event)).toBe(false);
  });

  it('eq resolves a nested dotted path', () => {
    expect(evaluate({ op: 'eq', path: 'payload.category', value: 'promotions' }, event)).toBe(true);
  });

  it('eq on a missing path is false (never throws)', () => {
    expect(evaluate({ op: 'eq', path: 'payload.nope.deep', value: 'x' }, event)).toBe(false);
  });

  it('neq is the negation of eq', () => {
    expect(evaluate({ op: 'neq', path: 'payload.category', value: 'social' }, event)).toBe(true);
    expect(evaluate({ op: 'neq', path: 'payload.category', value: 'promotions' }, event)).toBe(
      false,
    );
  });

  it('contains matches an array member and a substring', () => {
    expect(evaluate({ op: 'contains', path: 'payload.labels', value: 'work' }, event)).toBe(true);
    expect(evaluate({ op: 'contains', path: 'payload.labels', value: 'spam' }, event)).toBe(false);
    expect(evaluate({ op: 'contains', path: 'kind', value: 'completed' }, event)).toBe(true);
  });

  it('gte / lte compare numerically', () => {
    expect(evaluate({ op: 'gte', path: 'payload.confidence', value: 70 }, event)).toBe(true);
    expect(evaluate({ op: 'gte', path: 'payload.confidence', value: 90 }, event)).toBe(false);
    expect(evaluate({ op: 'lte', path: 'payload.confidence', value: 80 }, event)).toBe(true);
  });

  it('and requires every child; or requires any; not negates', () => {
    const and: Predicate = {
      op: 'and',
      nodes: [
        { op: 'eq', path: 'subjectType', value: 'task' },
        { op: 'gte', path: 'payload.confidence', value: 50 },
      ],
    };
    expect(evaluate(and, event)).toBe(true);

    const or: Predicate = {
      op: 'or',
      nodes: [
        { op: 'eq', path: 'kind', value: 'task.created' },
        { op: 'eq', path: 'payload.category', value: 'promotions' },
      ],
    };
    expect(evaluate(or, event)).toBe(true);

    expect(
      evaluate({ op: 'not', node: { op: 'eq', path: 'kind', value: 'task.created' } }, event),
    ).toBe(true);
  });

  it('an empty `and` is vacuously true; an empty `or` is false', () => {
    expect(evaluate({ op: 'and', nodes: [] }, event)).toBe(true);
    expect(evaluate({ op: 'or', nodes: [] }, event)).toBe(false);
  });
});

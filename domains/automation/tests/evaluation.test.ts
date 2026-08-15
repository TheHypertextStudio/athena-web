import { describe, expect, it } from 'vitest';

import {
  evaluatePredicate as publicEvaluatePredicate,
  matchesAutomationEvent as publicMatchesAutomationEvent,
} from '@docket/automation/evaluation';

import type { Predicate } from '../src/contracts';
import { evaluatePredicate, matchesAutomationEvent } from '../src/evaluation';

const event = {
  kind: 'task.completed',
  subjectType: 'task',
  payload: { category: 'promotions', labels: ['inbox', 'work'], confidence: 80 },
};

describe('evaluatePredicate', () => {
  it('exposes pure evaluators through the public evaluation entrypoint', () => {
    expect(publicEvaluatePredicate).toBe(evaluatePredicate);
    expect(publicMatchesAutomationEvent).toBe(matchesAutomationEvent);
  });

  it('resolves dotted paths and applies every leaf operator', () => {
    expect(evaluatePredicate({ op: 'eq', path: 'kind', value: 'task.completed' }, event)).toBe(
      true,
    );
    expect(evaluatePredicate({ op: 'neq', path: 'payload.category', value: 'social' }, event)).toBe(
      true,
    );
    expect(
      evaluatePredicate({ op: 'contains', path: 'payload.labels', value: 'work' }, event),
    ).toBe(true);
    expect(evaluatePredicate({ op: 'contains', path: 'kind', value: 'completed' }, event)).toBe(
      true,
    );
    expect(evaluatePredicate({ op: 'gte', path: 'payload.confidence', value: 70 }, event)).toBe(
      true,
    );
    expect(evaluatePredicate({ op: 'lte', path: 'payload.confidence', value: 80 }, event)).toBe(
      true,
    );
  });

  it('does not throw when a path is missing and refuses incompatible leaf comparisons', () => {
    expect(() =>
      evaluatePredicate({ op: 'eq', path: 'payload.nope.deep', value: 'x' }, event),
    ).not.toThrow();
    expect(evaluatePredicate({ op: 'eq', path: 'payload.nope.deep', value: 'x' }, event)).toBe(
      false,
    );
    expect(evaluatePredicate({ op: 'gte', path: 'kind', value: 1 }, event)).toBe(false);
    expect(
      evaluatePredicate({ op: 'contains', path: 'payload.confidence', value: 80 }, event),
    ).toBe(false);
  });

  it('preserves boolean composition and empty-node identities', () => {
    const predicate: Predicate = {
      op: 'and',
      nodes: [
        { op: 'eq', path: 'subjectType', value: 'task' },
        {
          op: 'or',
          nodes: [
            { op: 'eq', path: 'kind', value: 'task.created' },
            { op: 'not', node: { op: 'eq', path: 'payload.category', value: 'social' } },
          ],
        },
      ],
    };

    expect(evaluatePredicate(predicate, event)).toBe(true);
    expect(evaluatePredicate({ op: 'and', nodes: [] }, event)).toBe(true);
    expect(evaluatePredicate({ op: 'or', nodes: [] }, event)).toBe(false);
  });
});

describe('matchesAutomationEvent', () => {
  it('treats absent match fields as wildcards for internal events', () => {
    expect(matchesAutomationEvent({ kind: 'task.completed' }, event)).toBe(true);
    expect(matchesAutomationEvent({ subjectType: 'task' }, event)).toBe(true);
    expect(matchesAutomationEvent({}, event)).toBe(true);
    expect(matchesAutomationEvent({ kind: 'task.created' }, event)).toBe(false);
    expect(matchesAutomationEvent({ subjectType: 'project' }, event)).toBe(false);
  });

  it('matches source and entity kind for external events without assuming absent fields', () => {
    const external = { kind: 'completed', source: 'linear', entityKind: 'work_item' };

    expect(matchesAutomationEvent({ source: 'linear' }, external)).toBe(true);
    expect(matchesAutomationEvent({ entityKind: 'work_item' }, external)).toBe(true);
    expect(
      matchesAutomationEvent(
        { kind: 'completed', source: 'linear', entityKind: 'work_item' },
        external,
      ),
    ).toBe(true);
    expect(matchesAutomationEvent({ source: 'github' }, external)).toBe(false);
    expect(matchesAutomationEvent({ entityKind: 'work_item' }, { source: 'docket' })).toBe(false);
  });
});

/**
 * Unit tests for the automation rule grammar: `on` / `when` / `then`.
 *
 * @remarks
 * `Predicate` is a recursive Composite grammar (`and`/`or`/`not`/leaf), built with `z.lazy` so it
 * can nest arbitrarily. These tests parse a genuinely nested tree, not just a single leaf, so the
 * recursion itself is exercised.
 */
import { describe, expect, it } from 'vitest';

import {
  ActionSpec,
  AutomationEventMatch,
  AutomationRule,
  AutomationRuleCreate,
  Predicate,
} from '../../src/automation';

describe('Predicate', () => {
  it('parses a single leaf comparison', () => {
    const leaf: Predicate = { op: 'eq', path: 'payload.category', value: 'bug' };
    expect(Predicate.parse(leaf)).toEqual(leaf);
  });

  it('parses a nested and/or/not tree over leaf comparisons', () => {
    const tree: Predicate = {
      op: 'and',
      nodes: [
        { op: 'eq', path: 'payload.category', value: 'bug' },
        {
          op: 'or',
          nodes: [
            { op: 'gte', path: 'payload.priority', value: 2 },
            { op: 'not', node: { op: 'contains', path: 'payload.labels', value: 'wontfix' } },
          ],
        },
      ],
    };
    expect(Predicate.parse(tree)).toEqual(tree);
  });

  it('rejects a node with an unknown operator', () => {
    expect(Predicate.safeParse({ op: 'xor', nodes: [] }).success).toBe(false);
  });

  it('rejects a leaf with an empty path', () => {
    expect(Predicate.safeParse({ op: 'eq', path: '', value: 'bug' }).success).toBe(false);
  });
});

describe('ActionSpec', () => {
  it('defaults params to an empty object', () => {
    expect(ActionSpec.parse({ type: 'mail.archive' })).toEqual({
      type: 'mail.archive',
      params: {},
    });
  });

  it('rejects an empty action type', () => {
    expect(ActionSpec.safeParse({ type: '' }).success).toBe(false);
  });
});

describe('AutomationEventMatch', () => {
  it('matches anything when every field is absent', () => {
    expect(AutomationEventMatch.parse({})).toEqual({});
  });

  it('accepts a fully specified internal or external event match', () => {
    expect(
      AutomationEventMatch.parse({
        kind: 'completed',
        subjectType: 'task',
        source: 'linear',
        entityKind: 'work_item',
      }),
    ).toMatchObject({ kind: 'completed', subjectType: 'task' });
  });
});

describe('AutomationRuleCreate', () => {
  it('parses a full rule: an event match, a nested predicate, and an action list', () => {
    const rule = AutomationRuleCreate.parse({
      name: 'Archive resolved bugs',
      on: { kind: 'completed', subjectType: 'task' },
      when: {
        op: 'and',
        nodes: [{ op: 'eq', path: 'payload.category', value: 'bug' }],
      },
      then: [{ type: 'mail.archive', params: {} }],
    });
    expect(rule.enabled).toBe(true);
    expect(rule.then).toHaveLength(1);
  });
});

describe('AutomationRule', () => {
  it('parses a rule as the engine evaluates it (no name/enabled envelope)', () => {
    const rule: AutomationRule = {
      on: { kind: 'status_change' },
      when: { op: 'eq', path: 'payload.status', value: 'done' },
      then: [{ type: 'task.route', params: { to: 'triage' } }],
    };
    expect(AutomationRule.parse(rule)).toEqual(rule);
  });
});

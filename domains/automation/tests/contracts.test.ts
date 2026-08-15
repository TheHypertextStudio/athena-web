import { describe, expect, it } from 'vitest';

import {
  ActionSpec as PublicActionSpec,
  AutomationRule as PublicAutomationRule,
} from '@docket/automation/contracts';

import { ActionSpec, AutomationEventMatch, AutomationRule, Predicate } from '../src/contracts';

describe('Automation Rules contracts', () => {
  it('exposes the grammar through the public contracts entrypoint', () => {
    expect(PublicActionSpec).toBe(ActionSpec);
    expect(PublicAutomationRule).toBe(AutomationRule);
  });

  it('parses a recursive predicate tree over every supported branch shape', () => {
    const predicate = {
      op: 'and' as const,
      nodes: [
        { op: 'eq' as const, path: 'payload.category', value: 'bug' },
        {
          op: 'or' as const,
          nodes: [
            { op: 'gte' as const, path: 'payload.priority', value: 2 },
            {
              op: 'not' as const,
              node: { op: 'contains' as const, path: 'payload.labels', value: 'wontfix' },
            },
          ],
        },
      ],
    };

    expect(Predicate.parse(predicate)).toEqual(predicate);
    expect(Predicate.safeParse({ op: 'xor', nodes: [] }).success).toBe(false);
    expect(Predicate.safeParse({ op: 'eq', path: '', value: 'bug' }).success).toBe(false);
  });

  it('defaults an action command params object and keeps its contract metadata', () => {
    expect(ActionSpec.parse({ type: 'mail.archive' })).toEqual({
      type: 'mail.archive',
      params: {},
    });
    expect(ActionSpec.safeParse({ type: '' }).success).toBe(false);
    expect(ActionSpec.meta()).toMatchObject({ id: 'ActionSpec' });
  });

  it('supports internal, external, and wildcard event matches', () => {
    expect(AutomationEventMatch.parse({})).toEqual({});
    expect(
      AutomationEventMatch.parse({
        kind: 'completed',
        subjectType: 'task',
        source: 'linear',
        entityKind: 'work_item',
      }),
    ).toMatchObject({ kind: 'completed', subjectType: 'task', source: 'linear' });
    expect(AutomationEventMatch.meta()).toMatchObject({ id: 'AutomationEventMatch' });
  });

  it('parses a complete rule and keeps its contract metadata', () => {
    const rule = {
      on: { kind: 'status_change' },
      when: { op: 'eq' as const, path: 'payload.status', value: 'done' },
      then: [{ type: 'task.route', params: { to: 'triage' } }],
    };

    expect(AutomationRule.parse(rule)).toEqual(rule);
    expect(AutomationRule.meta()).toMatchObject({ id: 'AutomationRule' });
  });
});

import { describe, expect, it } from 'vitest';

import type { ActionSpec } from '@docket/types';

import { type EngineRule, matches, runAutomations } from '../../../src/lib/automation/engine';
import { type ActionHandler, createRegistry } from '../../../src/lib/automation/registry';

const event = {
  kind: 'task.completed',
  subjectType: 'task',
  payload: { category: 'promotions', confidence: 80 },
};

/** A recording handler so tests assert what the engine dispatched. */
function recorder(type: string, log: { type: string; params: unknown }[]): ActionHandler {
  return { type, run: (_ctx, params) => void log.push({ type, params }) };
}

function rule(over: Partial<EngineRule>): EngineRule {
  return {
    enabled: true,
    on: { kind: 'task.completed' },
    when: { op: 'eq', path: 'subjectType', value: 'task' },
    then: [{ type: 'mail.archive', params: {} } satisfies ActionSpec],
    ...over,
  };
}

describe('matches (event-match)', () => {
  it('matches on kind and subjectType, and treats an absent field as a wildcard', () => {
    expect(matches({ kind: 'task.completed' }, event)).toBe(true);
    expect(matches({ kind: 'task.created' }, event)).toBe(false);
    expect(matches({ subjectType: 'task' }, event)).toBe(true);
    expect(matches({}, event)).toBe(true); // empty match = any event
    expect(matches({ kind: 'task.completed', subjectType: 'project' }, event)).toBe(false);
  });
});

describe('runAutomations (registry + interpreter wiring)', () => {
  it('dispatches the actions of a matching, enabled, satisfied rule', async () => {
    const log: { type: string; params: unknown }[] = [];
    const reg = createRegistry();
    reg.register(recorder('mail.archive', log));

    const out = await runAutomations(
      event,
      [rule({ then: [{ type: 'mail.archive', params: { foo: 1 } }] })],
      reg,
    );
    expect(log).toEqual([{ type: 'mail.archive', params: { foo: 1 } }]);
    expect(out).toEqual([{ type: 'mail.archive', ran: true }]);
  });

  it('skips a rule whose `on` does not match', async () => {
    const log: { type: string; params: unknown }[] = [];
    const reg = createRegistry();
    reg.register(recorder('mail.archive', log));
    await runAutomations(event, [rule({ on: { kind: 'task.created' } })], reg);
    expect(log).toHaveLength(0);
  });

  it('skips a rule whose `when` predicate is false', async () => {
    const log: { type: string; params: unknown }[] = [];
    const reg = createRegistry();
    reg.register(recorder('mail.archive', log));
    await runAutomations(
      event,
      [rule({ when: { op: 'eq', path: 'subjectType', value: 'project' } })],
      reg,
    );
    expect(log).toHaveLength(0);
  });

  it('skips a disabled rule', async () => {
    const log: { type: string; params: unknown }[] = [];
    const reg = createRegistry();
    reg.register(recorder('mail.archive', log));
    await runAutomations(event, [rule({ enabled: false })], reg);
    expect(log).toHaveLength(0);
  });

  it('reports ran=false for an action with no registered handler (no throw)', async () => {
    const reg = createRegistry(); // nothing registered
    const out = await runAutomations(
      event,
      [rule({ then: [{ type: 'unknown.action', params: {} }] })],
      reg,
    );
    expect(out).toEqual([{ type: 'unknown.action', ran: false }]);
  });
});

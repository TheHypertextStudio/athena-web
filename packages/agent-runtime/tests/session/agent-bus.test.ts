import { describe, expect, it, vi } from 'vitest';

import {
  agentIntervalsOverlap,
  InMemoryAgentBus,
  projectAgentStates,
  type AgentUpdate,
  type AgentUpdateInput,
} from '../../src/index';

/** Build one publishable update with only the fields a case cares about. */
function update(overrides: Partial<AgentUpdateInput> & { sessionId: string }): AgentUpdateInput {
  return {
    parentSessionId: null,
    ownerUserId: 'user_1',
    agentName: 'Summarize the cycle',
    taskId: 'task_1',
    kind: 'agent_progress',
    milestone: 'working',
    ...overrides,
  };
}

describe('InMemoryAgentBus', () => {
  it('merges concurrent agents into one ordered stream carrying agent and task identity', () => {
    const bus = new InMemoryAgentBus();
    bus.publish(
      update({ sessionId: 's_a', taskId: 't_a', kind: 'agent_started', milestone: 'A start' }),
    );
    bus.publish(
      update({ sessionId: 's_b', taskId: 't_b', kind: 'agent_started', milestone: 'B start' }),
    );
    bus.publish(update({ sessionId: 's_a', taskId: 't_a', milestone: 'A step 2' }));
    bus.publish(
      update({ sessionId: 's_c', taskId: 't_c', kind: 'agent_started', milestone: 'C start' }),
    );

    const seen: AgentUpdate[] = [];
    bus.subscribe({ ownerUserId: 'user_1' }, (event) => seen.push(event));

    expect(seen.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(seen.map((event) => `${event.sessionId}:${event.taskId}`)).toEqual([
      's_a:t_a',
      's_b:t_b',
      's_a:t_a',
      's_c:t_c',
    ]);
  });

  it('replays updates published before the subscriber attached, then keeps delivering live ones', () => {
    const bus = new InMemoryAgentBus();
    bus.publish(update({ sessionId: 's_a', milestone: 'before attach' }));

    const seen: string[] = [];
    bus.subscribe({ ownerUserId: 'user_1' }, (event) => seen.push(event.milestone));
    expect(seen).toEqual(['before attach']);

    bus.publish(update({ sessionId: 's_a', milestone: 'after attach' }));
    expect(seen).toEqual(['before attach', 'after attach']);
  });

  it('leaves a failed agent’s prior updates intact and keeps the other agents running', () => {
    const bus = new InMemoryAgentBus();
    bus.publish(update({ sessionId: 's_a', kind: 'agent_started', milestone: 'A start' }));
    bus.publish(update({ sessionId: 's_b', kind: 'agent_started', milestone: 'B start' }));
    bus.publish(
      update({
        sessionId: 's_a',
        kind: 'agent_failed',
        milestone: 'A gave up',
        reasonCode: 'tool_unavailable',
      }),
    );
    bus.publish(update({ sessionId: 's_b', kind: 'agent_completed', milestone: 'B done' }));

    const history = bus.history({ sessionIds: ['s_a'] });
    expect(history.map((event) => event.milestone)).toEqual(['A start', 'A gave up']);
    expect(history.at(-1)?.reasonCode).toBe('tool_unavailable');

    const states = projectAgentStates(bus.history());
    expect(states.map((event) => [event.sessionId, event.kind])).toEqual([
      ['s_a', 'agent_failed'],
      ['s_b', 'agent_completed'],
    ]);
  });

  it('resumes a subscriber strictly after a sequence without truncating the live tail', () => {
    const bus = new InMemoryAgentBus();
    bus.publish(update({ sessionId: 's_a', milestone: 'one' }));
    bus.publish(update({ sessionId: 's_a', milestone: 'two' }));

    const seen: string[] = [];
    bus.subscribe({ since: 1 }, (event) => seen.push(event.milestone));
    expect(seen).toEqual(['two']);

    bus.publish(update({ sessionId: 's_a', milestone: 'three' }));
    expect(seen).toEqual(['two', 'three']);
  });

  it('scopes a subscription to one owner and detaches cleanly', () => {
    const bus = new InMemoryAgentBus();
    const mine: string[] = [];
    const detach = bus.subscribe({ ownerUserId: 'user_1' }, (event) => mine.push(event.milestone));

    bus.publish(update({ sessionId: 's_a', ownerUserId: 'user_2', milestone: 'not mine' }));
    bus.publish(update({ sessionId: 's_b', ownerUserId: 'user_1', milestone: 'mine' }));
    expect(mine).toEqual(['mine']);

    detach();
    bus.publish(update({ sessionId: 's_b', ownerUserId: 'user_1', milestone: 'after detach' }));
    expect(mine).toEqual(['mine']);
  });

  it('scopes a live subscription to specific session ids', () => {
    const bus = new InMemoryAgentBus();
    const seen: string[] = [];
    bus.subscribe({ sessionIds: ['s_a'] }, (event) => seen.push(event.milestone));

    bus.publish(update({ sessionId: 's_b', milestone: 'other session' }));
    bus.publish(update({ sessionId: 's_a', milestone: 'tracked session' }));
    expect(seen).toEqual(['tracked session']);
  });

  it('keeps fanning out when one listener throws, so one consumer cannot stall the others', () => {
    const bus = new InMemoryAgentBus();
    const healthy = vi.fn();
    bus.subscribe({}, () => {
      throw new Error('listener exploded');
    });
    bus.subscribe({}, healthy);

    expect(() => bus.publish(update({ sessionId: 's_a' }))).toThrow('listener exploded');
    // The throwing listener was registered first; the bus assigned the sequence before fan-out,
    // so history is complete even though delivery to the second listener was interrupted.
    expect(bus.history()).toHaveLength(1);
    expect(bus.cursor()).toBe(1);
  });

  it('drops the oldest retained updates past the retention bound', () => {
    const bus = new InMemoryAgentBus({ retain: 2 });
    bus.publish(update({ sessionId: 's_a', milestone: 'one' }));
    bus.publish(update({ sessionId: 's_a', milestone: 'two' }));
    bus.publish(update({ sessionId: 's_a', milestone: 'three' }));
    expect(bus.history().map((event) => event.milestone)).toEqual(['two', 'three']);
  });

  it('clamps a self-reported progress into 0–100 and drops a non-numeric one', () => {
    const bus = new InMemoryAgentBus();
    expect(bus.publish(update({ sessionId: 's_a', progress: 140 })).progress).toBe(100);
    expect(bus.publish(update({ sessionId: 's_a', progress: -5 })).progress).toBe(0);
    expect(bus.publish(update({ sessionId: 's_a', progress: Number.NaN })).progress).toBeNull();
    expect(bus.publish(update({ sessionId: 's_a' })).progress).toBeNull();
  });

  it('reports overlapping active intervals for genuinely concurrent agents', () => {
    const bus = new InMemoryAgentBus();
    const base = Date.parse('2026-08-02T10:00:00.000Z');
    bus.publish(update({ sessionId: 's_a', kind: 'agent_started', at: new Date(base) }));
    bus.publish(update({ sessionId: 's_b', kind: 'agent_started', at: new Date(base + 10) }));
    bus.publish(update({ sessionId: 's_a', kind: 'agent_completed', at: new Date(base + 50) }));
    bus.publish(update({ sessionId: 's_b', kind: 'agent_completed', at: new Date(base + 90) }));
    bus.publish(update({ sessionId: 's_c', kind: 'agent_started', at: new Date(base + 200) }));
    bus.publish(update({ sessionId: 's_c', kind: 'agent_completed', at: new Date(base + 240) }));

    expect(agentIntervalsOverlap(bus.history(), 's_a', 's_b')).toBe(true);
    expect(agentIntervalsOverlap(bus.history(), 's_a', 's_c')).toBe(false);
    expect(agentIntervalsOverlap(bus.history(), 's_a', 's_missing')).toBe(false);
  });

  it('resets to an empty bus', () => {
    const bus = new InMemoryAgentBus();
    bus.publish(update({ sessionId: 's_a' }));
    bus.reset();
    expect(bus.history()).toEqual([]);
    expect(bus.cursor()).toBe(0);
  });
});

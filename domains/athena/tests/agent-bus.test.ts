import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryAgentBus,
  agentIntervalsOverlap,
  projectAgentStates,
  type AgentUpdateInput,
} from '../src/agent-bus';

function update(overrides: Partial<AgentUpdateInput> = {}): AgentUpdateInput {
  return {
    sessionId: 'session_a',
    parentSessionId: null,
    ownerUserId: 'user_1',
    agentName: 'Athena',
    taskId: 'task_1',
    kind: 'agent_progress',
    milestone: 'Working',
    ...overrides,
  };
}

describe('Athena agent bus', () => {
  it('replays retained matching history then delivers the live tail in sequence order', () => {
    const bus = new InMemoryAgentBus();
    bus.publish(update({ milestone: 'Started', kind: 'agent_started' }));
    const listener = vi.fn();
    bus.subscribe({ ownerUserId: 'user_1' }, listener);
    bus.publish(update({ milestone: 'Working' }));

    expect(listener.mock.calls.map(([entry]) => entry.milestone)).toEqual(['Started', 'Working']);
    expect(listener.mock.calls.map(([entry]) => entry.sequence)).toEqual([1, 2]);
  });

  it('retains immutable history, clamps progress, and respects bounded replay retention', () => {
    const bus = new InMemoryAgentBus({ retain: 2 });
    bus.publish(update({ milestone: 'One', progress: -1 }));
    bus.publish(update({ milestone: 'Two', progress: 150 }));
    bus.publish(update({ milestone: 'Three', progress: Number.NaN }));

    expect(bus.history().map((entry) => [entry.milestone, entry.progress])).toEqual([
      ['Two', 100],
      ['Three', null],
    ]);
    expect(bus.cursor()).toBe(3);
  });

  it('projects each agent to its most recent state and detects overlapping lifetimes', () => {
    const bus = new InMemoryAgentBus();
    const start = Date.parse('2026-08-13T00:00:00.000Z');
    bus.publish(update({ kind: 'agent_started', at: new Date(start) }));
    bus.publish(update({ sessionId: 'session_b', kind: 'agent_started', at: new Date(start + 5) }));
    bus.publish(update({ kind: 'agent_completed', at: new Date(start + 10) }));
    bus.publish(
      update({ sessionId: 'session_b', kind: 'agent_completed', at: new Date(start + 20) }),
    );

    expect(projectAgentStates(bus.history()).map((entry) => entry.kind)).toEqual([
      'agent_completed',
      'agent_completed',
    ]);
    expect(agentIntervalsOverlap(bus.history(), 'session_a', 'session_b')).toBe(true);
  });
});

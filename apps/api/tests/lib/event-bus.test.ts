import { describe, expect, it, vi } from 'vitest';

import { listenerCount, publish, subscribe, type StreamEvent } from '../../src/lib/event-bus';

function mkEvent(id: string): StreamEvent {
  return {
    id,
    organizationId: 'org_1',
    source: { provider: 'docket', integrationId: null, origin: 'docket' },
    kind: 'status_change',
    occurredAt: '2026-06-29T12:00:00.000Z',
    title: 'Event',
    summary: null,
    permalink: null,
    actor: null,
    subject: null,
    participants: [],
    payload: {},
    relevance: 'owned',
    rendering: { icon: 'status_change', category: 'progress' },
    createdAt: '2026-06-29T12:00:00.000Z',
  };
}

describe('event-bus', () => {
  it('delivers events only to the target user’s subscribers', () => {
    const ada = vi.fn();
    const bob = vi.fn();
    const offAda = subscribe('user_ada', ada);
    const offBob = subscribe('user_bob', bob);

    const ev = mkEvent('o1');
    publish('user_ada', ev);

    expect(ada).toHaveBeenCalledWith(ev);
    expect(bob).not.toHaveBeenCalled();
    offAda();
    offBob();
  });

  it('fans out to every subscriber of one user', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribe('user_x', a);
    const offB = subscribe('user_x', b);
    expect(listenerCount('user_x')).toBe(2);

    publish('user_x', mkEvent('o2'));
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    offA();
    offB();
  });

  it('stops delivering after unsubscribe and prunes the empty set', () => {
    const fn = vi.fn();
    const off = subscribe('user_y', fn);
    off();
    expect(listenerCount('user_y')).toBe(0);
    publish('user_y', mkEvent('o3'));
    expect(fn).not.toHaveBeenCalled();
  });

  it('is a no-op when nobody is subscribed', () => {
    expect(() => {
      publish('user_nobody', mkEvent('o4'));
    }).not.toThrow();
  });
});

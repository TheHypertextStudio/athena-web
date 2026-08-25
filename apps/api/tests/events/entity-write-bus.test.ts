import { describe, expect, it, vi } from 'vitest';

import { EntityWriteBus, type EntityWriteEvent } from '../../src/events/entity-write-bus';

const event: EntityWriteEvent = {
  organizationId: 'org_1',
  sourceTable: 'project',
  entityId: 'proj_1',
  operation: 'upsert',
};

/** A subscriber that records what it saw. */
function recorder(name: string, seen: string[], behavior?: () => Promise<void>) {
  return {
    name,
    handle: async (received: EntityWriteEvent) => {
      seen.push(`${name}:${received.entityId}`);
      await behavior?.();
    },
  };
}

describe('EntityWriteBus', () => {
  it('delivers one event to every subscriber', async () => {
    const seen: string[] = [];
    const bus = new EntityWriteBus().subscribe(recorder('a', seen)).subscribe(recorder('b', seen));

    await bus.publish(event);

    expect([...seen].sort()).toEqual(['a:proj_1', 'b:proj_1']);
  });

  it('keeps running the others when one subscriber throws', async () => {
    const seen: string[] = [];
    const report = vi.fn();
    const bus = new EntityWriteBus(report)
      .subscribe(recorder('exploding', seen, () => Promise.reject(new Error('boom'))))
      .subscribe(recorder('healthy', seen));

    // The publish itself must resolve: a failing notification is a display bug, while rejecting
    // here would fail the caller's write and lose an edit.
    await expect(bus.publish(event)).resolves.toBeUndefined();

    expect(seen).toContain('healthy:proj_1');
    expect(report).toHaveBeenCalledWith('exploding', event, expect.any(Error));
  });

  it('names the failing subscriber, so a broken listener is identifiable', async () => {
    const report = vi.fn();
    const bus = new EntityWriteBus(report).subscribe({
      name: 'mention-reconcile',
      handle: () => Promise.reject(new Error('db down')),
    });

    await bus.publish(event);

    expect(report.mock.calls[0]?.[0]).toBe('mention-reconcile');
  });

  it('runs subscribers concurrently, so one slow listener does not serialize the rest', async () => {
    const order: string[] = [];
    const bus = new EntityWriteBus()
      .subscribe({
        name: 'slow',
        handle: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          order.push('slow');
        },
      })
      .subscribe({
        name: 'fast',
        handle: () => {
          order.push('fast');
          return Promise.resolve();
        },
      });

    await bus.publish(event);

    expect(order).toEqual(['fast', 'slow']);
  });

  it('waits for every subscriber before resolving', async () => {
    let finished = false;
    const bus = new EntityWriteBus().subscribe({
      name: 'slow',
      handle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        finished = true;
      },
    });

    await bus.publish(event);

    // The caller needs derived state current by the time its request returns: someone who saves a
    // description and switches tabs must not race the reconcile.
    expect(finished).toBe(true);
  });

  it('delivers to nobody without complaint when nothing is listening', async () => {
    await expect(new EntityWriteBus().publish(event)).resolves.toBeUndefined();
  });

  it('reports its wiring, so what production listens to can be asserted', () => {
    const bus = new EntityWriteBus().subscribe(recorder('a', [])).subscribe(recorder('b', []));
    expect(bus.subscriberNames).toEqual(['a', 'b']);
  });
});

describe('the application wiring', () => {
  it('registers every listener a write is supposed to have', async () => {
    const { buildEntityWriteBus } = await import('../../src/events/entity-write-registry');
    const noopStorage = {
      mentions: {
        listForSubject: () => Promise.resolve([]),
        replaceForSubject: () => Promise.resolve(),
        deleteForSubject: () => Promise.resolve(),
      },
      resources: {
        findOrCreate: () => Promise.resolve(undefined),
        findByIds: () => Promise.resolve([]),
        findByKeys: () => Promise.resolve([]),
      },
      subjects: {
        read: () => Promise.resolve(undefined),
        entityExists: () => Promise.resolve(false),
      },
    };

    const bus = buildEntityWriteBus(noopStorage);

    expect(bus.subscriberNames).toEqual([
      'search-index',
      'mention-reconcile',
      'mcp-notify',
      'notion-mirror-wake',
    ]);
  });

  it('wakes Notion only for entity kinds that the mirror projects', async () => {
    const { notionMirrorWakeSubscriber } =
      await import('../../src/events/entity-write-subscribers');
    const wake = vi.fn().mockResolvedValue(1);
    const requestSweep = vi.fn();
    const subscriber = notionMirrorWakeSubscriber(wake, requestSweep);

    await subscriber.handle(event);
    await subscriber.handle({ ...event, sourceTable: 'comment' });

    expect(wake).toHaveBeenCalledOnce();
    expect(wake).toHaveBeenCalledWith('org_1');
    expect(requestSweep).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_COMPLETED_RECEIPTS,
  MAX_LIVE_RECEIPTS,
  createInteractionReceiptStore,
  type InteractionInvocation,
  type InteractionOutcome,
} from '@/lib/interactions';

const ROOT_INVOCATION: InteractionInvocation = {
  interactionId: 'app.mutation',
  category: 'mutation',
  routeTemplateId: '/tasks/[taskId]',
  invocationId: 'ephemeral-root-invocation',
};

function invocation(invocationId: string, parentInvocationId?: string): InteractionInvocation {
  return {
    ...ROOT_INVOCATION,
    invocationId,
    ...(parentInvocationId ? { parentInvocationId } : {}),
  };
}

describe('interaction receipt store', () => {
  it('records activation, acknowledgement, progress, and settlement with lifecycle timestamps', () => {
    let now = 10;
    const store = createInteractionReceiptStore({ now: () => now });

    expect(store.activate(ROOT_INVOCATION)).toMatchObject({
      interactionId: 'app.mutation',
      category: 'mutation',
      routeTemplateId: '/tasks/[taskId]',
      phase: 'activated',
      startedAt: 10,
    });

    now = 20;
    expect(store.acknowledge(ROOT_INVOCATION.invocationId)).toMatchObject({
      phase: 'acknowledged',
      acknowledgedAt: 20,
    });

    now = 30;
    expect(store.progress(ROOT_INVOCATION.invocationId)).toMatchObject({
      phase: 'progressing',
      progressAt: 30,
    });

    now = 40;
    expect(store.settle(ROOT_INVOCATION.invocationId, 'succeeded')).toEqual({
      interactionId: 'app.mutation',
      category: 'mutation',
      routeTemplateId: '/tasks/[taskId]',
      phase: 'settled',
      startedAt: 10,
      acknowledgedAt: 20,
      progressAt: 30,
      settledAt: 40,
      outcome: 'succeeded',
    });
  });

  it('retains the allowlisted recovery code for an attention outcome', () => {
    const store = createInteractionReceiptStore();
    store.activate(ROOT_INVOCATION);
    store.acknowledge(ROOT_INVOCATION.invocationId);

    expect(store.settle(ROOT_INVOCATION.invocationId, 'needs_attention', 'retry')).toMatchObject({
      phase: 'settled',
      outcome: 'needs_attention',
      recovery: 'retry',
    });
  });

  it('abandons an activated receipt without treating it as an acknowledgement', () => {
    const store = createInteractionReceiptStore();
    store.activate(ROOT_INVOCATION);

    const abandoned = store.abandon(ROOT_INVOCATION.invocationId);
    expect(abandoned).toMatchObject({
      phase: 'settled',
      outcome: 'abandoned',
    });
    expect(abandoned).not.toHaveProperty('acknowledgedAt');
  });

  it('links a child invocation to its root only in the ephemeral local trace', () => {
    const store = createInteractionReceiptStore();
    const child = invocation('ephemeral-child-invocation', ROOT_INVOCATION.invocationId);
    store.activate(ROOT_INVOCATION);
    store.activate(child);

    expect(store.invocationFor(child.invocationId)).toEqual(child);
    expect(JSON.stringify(store.snapshot())).not.toContain(ROOT_INVOCATION.invocationId);
    expect(JSON.stringify(store.snapshot())).not.toContain(child.invocationId);
  });

  it('rejects nonexistent and out-of-order lifecycle transitions', () => {
    const store = createInteractionReceiptStore();

    expect(() => store.acknowledge('missing-invocation')).toThrow(
      'Invalid interaction receipt transition.',
    );

    store.activate(ROOT_INVOCATION);
    expect(() => store.progress(ROOT_INVOCATION.invocationId)).toThrow(
      'Invalid interaction receipt transition.',
    );
    expect(() => store.settle(ROOT_INVOCATION.invocationId, 'succeeded')).toThrow(
      'Invalid interaction receipt transition.',
    );

    store.acknowledge(ROOT_INVOCATION.invocationId);
    store.settle(ROOT_INVOCATION.invocationId, 'succeeded');
    expect(() => store.acknowledge(ROOT_INVOCATION.invocationId)).toThrow(
      'Invalid interaction receipt transition.',
    );
  });

  it('rejects untyped outcome and recovery values before they can enter a receipt', () => {
    const store = createInteractionReceiptStore();
    store.activate(ROOT_INVOCATION);
    store.acknowledge(ROOT_INVOCATION.invocationId);

    expect(() =>
      store.settle(
        ROOT_INVOCATION.invocationId,
        'private outcome' as unknown as InteractionOutcome,
      ),
    ).toThrow('Invalid interaction receipt transition.');
    expect(() =>
      store.settle(ROOT_INVOCATION.invocationId, 'needs_attention', 'private recovery' as never),
    ).toThrow('Invalid interaction receipt transition.');
  });

  it.each([
    'succeeded',
    'needs_attention',
    'failed',
    'handed_off',
    'superseded',
    'abandoned',
    'timed_out',
  ] as const)('settles the %s terminal outcome', (outcome: InteractionOutcome) => {
    const store = createInteractionReceiptStore();
    const current = invocation(`ephemeral-${outcome}`);
    store.activate(current);
    store.acknowledge(current.invocationId);

    expect(store.settle(current.invocationId, outcome).outcome).toBe(outcome);
  });

  it('evicts completed receipts oldest-first after the completed bound', () => {
    let now = 0;
    const store = createInteractionReceiptStore({ now: () => now });

    for (let index = 0; index <= MAX_COMPLETED_RECEIPTS; index += 1) {
      now = index;
      const current = invocation(`ephemeral-completed-${index}`);
      store.activate(current);
      store.acknowledge(current.invocationId);
      store.settle(current.invocationId, 'succeeded');
    }

    const completed = store.snapshot().completed;
    expect(completed).toHaveLength(MAX_COMPLETED_RECEIPTS);
    expect(completed[0]?.startedAt).toBe(1);
    expect(completed.at(-1)?.startedAt).toBe(MAX_COMPLETED_RECEIPTS);
  });

  it('times out the oldest live receipt and reports a generic leak at the live bound', () => {
    const leakCodes: string[] = [];
    const reportLeak = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createInteractionReceiptStore({
      onLeak: (failure) => leakCodes.push(failure.code),
    });

    try {
      for (let index = 0; index <= MAX_LIVE_RECEIPTS; index += 1) {
        store.activate(invocation(`ephemeral-live-${index}`));
      }

      expect(store.snapshot().live).toHaveLength(MAX_LIVE_RECEIPTS);
      expect(store.snapshot().completed).toEqual([
        expect.objectContaining({ outcome: 'timed_out', phase: 'settled' }),
      ]);
      expect(leakCodes).toEqual(['live-capacity-exceeded']);
    } finally {
      reportLeak.mockRestore();
    }
  });

  it('emits a development leak failure even without a caller-provided callback', () => {
    const reportLeak = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = createInteractionReceiptStore({ environment: 'test' });

    try {
      for (let index = 0; index <= MAX_LIVE_RECEIPTS; index += 1) {
        store.activate(invocation(`ephemeral-default-reporter-${index}`));
      }

      expect(reportLeak).toHaveBeenCalledWith('Interaction receipt live capacity exceeded.');
    } finally {
      reportLeak.mockRestore();
    }
  });

  it('abandons only unresolved work during teardown while retaining an earlier handoff', () => {
    const store = createInteractionReceiptStore();
    const unresolved = invocation('ephemeral-unresolved');
    const handoff = invocation('ephemeral-handoff');
    store.activate(unresolved);
    store.acknowledge(unresolved.invocationId);
    store.activate(handoff);
    store.acknowledge(handoff.invocationId);
    store.settle(handoff.invocationId, 'handed_off');

    store.teardown();

    expect(store.snapshot().completed.map((receipt) => receipt.outcome)).toEqual([
      'handed_off',
      'abandoned',
    ]);
  });

  it('serializes only the closed receipt shape and rejects a concrete route', () => {
    const store = createInteractionReceiptStore();
    const parent = invocation('ephemeral-parent-to-redact');
    store.activate(parent);
    const untrusted = {
      ...ROOT_INVOCATION,
      invocationId: 'ephemeral-invocation-to-redact',
      parentInvocationId: parent.invocationId,
      entityId: 'task_very_private',
      typedText: 'A private task title must never reach diagnostics.',
      url: 'https://private.example.test/tasks/task_very_private',
      error: new Error('A private provider exception must never reach diagnostics.'),
    } as InteractionInvocation;
    store.activate(untrusted);
    store.acknowledge(untrusted.invocationId);
    store.settle(untrusted.invocationId, 'succeeded');

    const serialized = JSON.stringify(store.snapshot());
    expect(serialized).not.toContain(untrusted.invocationId);
    expect(serialized).not.toContain('ephemeral-parent-to-redact');
    expect(serialized).not.toContain('task_very_private');
    expect(serialized).not.toContain('private task title');
    expect(serialized).not.toContain('private.example.test');
    expect(serialized).not.toContain('private provider exception');
    expect(() =>
      store.activate({
        ...ROOT_INVOCATION,
        invocationId: 'ephemeral-rejected-route',
        routeTemplateId: '/tasks/task_very_private',
      } as unknown as InteractionInvocation),
    ).toThrow('Invalid interaction invocation.');
  });
});

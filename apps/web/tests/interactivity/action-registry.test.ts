import { describe, expect, it, vi } from 'vitest';

import type { ObjectRef } from '../../src/lib/actions/object';
import {
  createActionRegistry,
  defineActionDomain,
  DuplicateActionIdError,
  DuplicateDomainRegistrationError,
  MalformedActionIdError,
  UnknownActionError,
} from '../../src/lib/actions/registry';
import type { ActionContext, ActionDefinition } from '../../src/lib/actions/types';

const TASK_MUTATION_RECEIPT = {
  ownership: 'root',
  interactionId: 'app.mutation',
  category: 'mutation',
  routeTemplateId: '/tasks/[taskId]',
} as const;

const task: ObjectRef = { kind: 'task', id: 't1', organizationId: 'org1', title: 'Write the spec' };
const otherTask: ObjectRef = { kind: 'task', id: 't2', organizationId: 'org1', title: 'Review it' };
const project: ObjectRef = {
  kind: 'project',
  id: 'p1',
  organizationId: 'org1',
  title: 'Launch',
};

/** A context for `objects`, defaulting to the surface the tests care least about. */
function contextFor(objects: readonly ObjectRef[]): ActionContext {
  return { objects, source: 'context-menu', organizationId: 'org1' };
}

describe('action registry: registration', () => {
  it('requires declared receipt metadata for asynchronous actions', () => {
    const missingReceipt = defineActionDomain('task', [
      // @ts-expect-error Promise-returning actions must declare closed responsiveness metadata.
      {
        id: 'task.complete',
        label: 'Complete',
        run: async () => undefined,
      },
    ]);

    expect(missingReceipt[0]?.responsiveness).toBeUndefined();
  });

  it('accepts promise-returning work that declares receipt metadata without the async keyword', async () => {
    const registry = createActionRegistry();
    const definitions = defineActionDomain('task', [
      {
        id: 'task.complete',
        label: 'Complete',
        responsiveness: TASK_MUTATION_RECEIPT,
        run: () => Promise.resolve(),
      },
    ]);

    registry.register('task', definitions);
    await expect(registry.invoke('task.complete', () => contextFor([task]))).resolves.toEqual({
      status: 'ran',
    });
  });

  it('keeps untyped promise work without metadata eligible for the runtime watchdog', async () => {
    const observeAsync = vi.fn();
    const registry = createActionRegistry({
      receiptRuntime: { begin: vi.fn(), observeAsync },
    });
    const untypedRun: () => unknown = () => Promise.resolve();
    const untypedPromise = defineActionDomain('task', [
      {
        id: 'task.complete',
        label: 'Complete',
        run: untypedRun,
      },
    ]);

    registry.register('task', untypedPromise);
    await registry.invoke('task.complete', () => contextFor([task]));

    expect(observeAsync).toHaveBeenCalledWith('task.complete', undefined, undefined);
  });

  it('abandons a metadata-bearing synchronous runtime edge after entry activation', async () => {
    const begin = vi.fn(() => 'ephemeral-root-invocation');
    const abandon = vi.fn();
    const receiptRuntime = { begin, observeAsync: vi.fn(), abandon };
    const registry = createActionRegistry({ receiptRuntime });
    const invalidSynchronousReceipt = [
      {
        id: 'task.open' as const,
        domain: 'task' as const,
        label: 'Open',
        responsiveness: TASK_MUTATION_RECEIPT,
        run: () => undefined,
      },
    ] as const;

    registry.register('task', invalidSynchronousReceipt as unknown as readonly ActionDefinition[]);
    await expect(registry.invoke('task.open', () => contextFor([task]))).resolves.toEqual({
      status: 'ran',
    });

    expect(begin).toHaveBeenCalledTimes(1);
    expect(abandon).toHaveBeenCalledWith('ephemeral-root-invocation');
  });

  it('stamps the domain onto every definition and freezes the set', () => {
    const actions = defineActionDomain('task', [
      { id: 'task.complete', label: 'Complete', run: () => undefined },
    ]);
    expect(actions[0]?.domain).toBe('task');
    expect(Object.isFrozen(actions)).toBe(true);
  });

  it('refuses an id that is not prefixed with its own domain', () => {
    const registry = createActionRegistry();
    const misfiled = defineActionDomain('task', [
      { id: 'project.archive', label: 'Archive', run: () => undefined },
    ]);
    // Without this an id could drift from the module that owns it, and "grep the id to find its
    // one registration" — the property the whole registry rests on — would stop being true.
    expect(() => registry.register('task', misfiled)).toThrow(MalformedActionIdError);
  });

  it('refuses a duplicate id inside one domain', () => {
    const registry = createActionRegistry();
    const duplicated = defineActionDomain('task', [
      { id: 'task.open', label: 'Open', run: () => undefined },
      { id: 'task.open', label: 'Open in tab', run: () => undefined },
    ]);
    expect(() => registry.register('task', duplicated)).toThrow(DuplicateActionIdError);
  });

  it('makes a cross-domain id collision structurally impossible', () => {
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [{ id: 'task.open', label: 'Open', run: () => undefined }]),
    );
    // Another domain cannot even spell an id that collides: the prefix rule rejects it before
    // uniqueness is consulted, which is why ids stay greppable back to exactly one module.
    const collision = [
      { id: 'task.open' as const, domain: 'project' as const, label: 'Open', run: () => undefined },
    ];
    expect(() => registry.register('project', collision)).toThrow(MalformedActionIdError);
  });

  it('refuses a second module registering the same domain', () => {
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [{ id: 'task.a', label: 'A', run: () => undefined }]),
    );
    const secondModule = defineActionDomain('task', [
      { id: 'task.b', label: 'B', run: () => undefined },
    ]);
    // "Each domain registers exactly once" has to be enforced, not documented: a second
    // registration module is how duplicate, divergent copies of an action appear.
    expect(() => registry.register('task', secondModule)).toThrow(DuplicateDomainRegistrationError);
  });

  it('treats re-registering the identical set as a no-op', () => {
    const registry = createActionRegistry();
    const actions = defineActionDomain('task', [
      { id: 'task.a', label: 'A', run: () => undefined },
      { id: 'task.b', label: 'B', run: () => undefined },
    ]);
    registry.register('task', actions);
    const first = registry.snapshot();
    registry.register('task', actions);
    registry.register('task', actions);
    // A remount, a navigation, and strict-mode's double invocation all land here. The registry
    // must be byte-identical afterwards or it accumulates duplicates at runtime.
    expect(registry.snapshot()).toEqual(first);
    expect(registry.snapshot().count).toBe(2);
  });

  it('withdraws a domain on unregister', () => {
    const registry = createActionRegistry();
    const actions = defineActionDomain('task', [
      { id: 'task.a', label: 'A', run: () => undefined },
    ]);
    const unregister = registry.register('task', actions);
    expect(registry.snapshot().count).toBe(1);
    unregister();
    expect(registry.snapshot()).toEqual({ count: 0, ids: [], domains: [] });
  });

  it('notifies subscribers when registrations change', () => {
    const registry = createActionRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    const before = registry.version();
    registry.register(
      'task',
      defineActionDomain('task', [{ id: 'task.a', label: 'A', run: () => undefined }]),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.version()).toBeGreaterThan(before);
    unsubscribe();
    registry.register(
      'project',
      defineActionDomain('project', [{ id: 'project.a', label: 'A', run: () => undefined }]),
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('action registry: applicability', () => {
  const registry = createActionRegistry();
  registry.register(
    'task',
    defineActionDomain('task', [
      { id: 'task.open', label: 'Open', objectKinds: ['task'], run: () => undefined },
      {
        id: 'task.bulkComplete',
        label: 'Complete',
        objectKinds: ['task'],
        multi: true,
        run: () => undefined,
      },
    ]),
  );
  registry.register(
    'app',
    defineActionDomain('app', [{ id: 'app.signOut', label: 'Sign out', run: () => undefined }]),
  );

  it('offers only the actions that accept the context', () => {
    const ids = registry.resolve(() => contextFor([task])).map((action) => action.id);
    expect(ids).toContain('task.open');
    expect(ids).toContain('task.bulkComplete');
    expect(ids).toContain('app.signOut');
  });

  it('withholds single-object actions from a multi-object context', () => {
    const ids = registry.resolve(() => contextFor([task, otherTask])).map((action) => action.id);
    expect(ids).toEqual(['task.bulkComplete']);
  });

  it('withholds an object action from a context of the wrong kind', () => {
    const ids = registry.resolve(() => contextFor([project])).map((action) => action.id);
    expect(ids).toEqual(['app.signOut']);
  });

  it('offers global actions when nothing is selected but withholds object ones', () => {
    const ids = registry.resolve(() => contextFor([])).map((action) => action.id);
    expect(ids).toEqual(['app.signOut']);
  });
});

describe('action registry: resolution', () => {
  it('evaluates context-dependent labels and groups by section', () => {
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.delete',
          label: (context) => `Delete ${context.objects.length} tasks`,
          objectKinds: ['task'],
          multi: true,
          section: 'danger',
          destructive: true,
          run: () => undefined,
        },
        {
          id: 'task.open',
          label: 'Open',
          objectKinds: ['task'],
          multi: true,
          section: 'primary',
          run: () => undefined,
        },
      ]),
    );

    const resolved = registry.resolve(() => contextFor([task, otherTask]));
    // Sections order the menu regardless of registration order, so a destructive action can never
    // sit above a benign one.
    expect(resolved.map((action) => action.id)).toEqual(['task.open', 'task.delete']);
    expect(resolved[1]?.label).toBe('Delete 2 tasks');
    expect(resolved[1]?.destructive).toBe(true);
  });

  it('carries the disabled reason so no item is inert without saying why', () => {
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.archive',
          label: 'Archive',
          objectKinds: ['task'],
          disabledReason: () => 'Finish the task before archiving it.',
          run: () => undefined,
        },
      ]),
    );
    const [action] = registry.resolve(() => contextFor([task]));
    expect(action?.disabledReason).toBe('Finish the task before archiving it.');
  });
});

describe('action registry: invocation', () => {
  it('starts one root receipt before asynchronous work and lets child work share it', async () => {
    const begin = vi.fn(() => 'ephemeral-root-invocation');
    const observeAsync = vi.fn();
    const registry = createActionRegistry({
      receiptRuntime: { begin, observeAsync },
    });
    const run = async (context: ActionContext): Promise<void> => {
      expect(begin).toHaveBeenCalledTimes(1);
      expect(context.parentInvocationId).toBe('ephemeral-root-invocation');
    };

    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.complete',
          label: 'Complete',
          responsiveness: TASK_MUTATION_RECEIPT,
          run,
        },
      ]),
    );

    const result = await registry.invoke('task.complete', () => contextFor([task]));

    expect(result).toEqual({ status: 'ran' });
    expect(begin).toHaveBeenCalledWith(TASK_MUTATION_RECEIPT, undefined);
    expect(observeAsync).toHaveBeenCalledWith(
      'task.complete',
      'ephemeral-root-invocation',
      TASK_MUTATION_RECEIPT,
    );
  });

  it('does not activate or report a second receipt for child asynchronous work', async () => {
    const begin = vi.fn(() => 'ephemeral-root-invocation');
    const observeAsync = vi.fn();
    const registry = createActionRegistry({ receiptRuntime: { begin, observeAsync } });
    const childReceipt = { ...TASK_MUTATION_RECEIPT, ownership: 'child' as const };
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.root',
          label: 'Root',
          responsiveness: TASK_MUTATION_RECEIPT,
          run: async () => undefined,
        },
        {
          id: 'task.child',
          label: 'Child',
          responsiveness: childReceipt,
          run: async (context) => {
            expect(context.parentInvocationId).toBe('ephemeral-root-invocation');
          },
        },
      ]),
    );

    await registry.invoke('task.root', () => contextFor([task]));
    await registry.invoke('task.child', () => ({
      ...contextFor([task]),
      parentInvocationId: 'ephemeral-root-invocation',
    }));

    expect(begin).toHaveBeenCalledTimes(1);
    expect(observeAsync).toHaveBeenCalledTimes(1);
  });

  it('injects the context resolved at invoke time, not at list time', () => {
    const seen: ActionContext[] = [];
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.complete',
          label: 'Complete',
          objectKinds: ['task'],
          multi: true,
          run: (context) => {
            seen.push(context);
          },
        },
      ]),
    );

    // The selection at the moment the list was drawn…
    let selection: readonly ObjectRef[] = [task];
    const [action] = registry.resolve(() => contextFor(selection));
    expect(action).toBeDefined();

    // …changes before the user picks the row. Acting on the stale snapshot would operate on
    // something other than what they can see, which is the whole reason context is a callback.
    selection = [task, otherTask];
    return action?.invoke().then((result) => {
      expect(result).toEqual({ status: 'ran' });
      expect(seen[0]?.objects).toEqual([task, otherTask]);
    });
  });

  it('serves the same definition from three different entry points', async () => {
    const sources: string[] = [];
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.complete',
          label: 'Complete',
          objectKinds: ['task'],
          run: (context) => {
            sources.push(`${context.source}:${context.objects[0]?.id ?? ''}`);
          },
        },
      ]),
    );

    await registry.invoke('task.complete', () => ({
      objects: [task],
      source: 'context-menu',
      organizationId: 'org1',
    }));
    await registry.invoke('task.complete', () => ({
      objects: [otherTask],
      source: 'command-palette',
      organizationId: 'org1',
    }));
    await registry.invoke('task.complete', () => ({
      objects: [task],
      source: 'shortcut',
      organizationId: 'org1',
    }));

    // One definition, three call sites, three different injected contexts.
    expect(sources).toEqual(['context-menu:t1', 'command-palette:t2', 'shortcut:t1']);
  });

  it('skips rather than silently running when the action does not apply', async () => {
    const run = vi.fn();
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [{ id: 'task.open', label: 'Open', objectKinds: ['task'], run }]),
    );
    const result = await registry.invoke('task.open', () => contextFor([project]));
    expect(result).toEqual({ status: 'skipped', reason: 'not-applicable', detail: null });
    expect(run).not.toHaveBeenCalled();
  });

  it('skips with the stated reason when the action is disabled', async () => {
    const run = vi.fn();
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.archive',
          label: 'Archive',
          objectKinds: ['task'],
          disabledReason: () => 'Finish the task first.',
          run,
        },
      ]),
    );
    const result = await registry.invoke('task.archive', () => contextFor([task]));
    expect(result).toEqual({
      status: 'skipped',
      reason: 'disabled',
      detail: 'Finish the task first.',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('reports a failure instead of swallowing it', async () => {
    const failure = new Error('the write did not land');
    const registry = createActionRegistry();
    registry.register(
      'task',
      defineActionDomain('task', [
        {
          id: 'task.complete',
          label: 'Complete',
          objectKinds: ['task'],
          run: () => {
            throw failure;
          },
        },
      ]),
    );
    // A connector or a mutation that fails must never read as success. The registry hands the
    // error back so the app can render its own copy; it never invents a happy path.
    const result = await registry.invoke('task.complete', () => contextFor([task]));
    expect(result).toEqual({ status: 'failed', error: failure });
  });

  it('throws for an id nothing ever registered', async () => {
    const registry = createActionRegistry();
    await expect(registry.invoke('task.nope', () => contextFor([task]))).rejects.toBeInstanceOf(
      UnknownActionError,
    );
  });
});

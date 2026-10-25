import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CycleError } from '../../src/error';
import {
  prepareCreationForest,
  prospectiveCreationInsert,
  validateExistingCreationDependencies,
} from '../../src/lib/work-creation/forest-preflight';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';
import type { PreparedBlueprintCreation } from '../../src/lib/work-template-blueprints/preflight';
import type {
  ProspectiveWorkReference,
  WorkCreationBatchCommand,
} from '../../src/lib/work-creation/types';
import type { ResolvedWorkInsert } from '../../src/lib/work-creation/writers';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  prepare: vi.fn(),
  timing: vi.fn(),
  plan: vi.fn(),
  cycle: vi.fn(),
  access: vi.fn(),
}));
vi.mock('../../src/lib/recurrence/work-template-placement', () => ({
  resolveRetainedRootPlacement: async () => ({}),
}));
vi.mock('../../src/lib/recurrence/schedule-root-placement', () => ({
  resolveScheduleRootPlacement: () => ({}),
}));
vi.mock('../../src/lib/work-creation/retained-authority', () => ({
  retainedRootBinding: () => undefined,
}));
vi.mock('../../src/lib/work-creation/ordinary-prospective', () => ({
  createOrdinaryPreparationContext: mocks.context,
}));
vi.mock('../../src/lib/work-template-blueprints/preflight', () => ({
  prepareBlueprintCreation: mocks.prepare,
}));
vi.mock('../../src/lib/recurrence/schedule-timing', () => ({
  compileScheduleTiming: mocks.timing,
}));
vi.mock('../../src/lib/recurrence/schedule-compiler', () => ({
  planScheduleBlueprint: mocks.plan,
}));
vi.mock('../../src/lib/work-template-blueprints/root', () => ({
  preparedBlueprintRoot: (prepared: unknown) => ({ prepared }),
}));
vi.mock('../../src/lib/work-dependency-forest', () => ({
  closesWorkspaceDependencyCycle: mocks.cycle,
}));
vi.mock('../../src/lib/work-template-selection', () => ({
  requireWorkAccess: mocks.access,
}));

const tx = {} as TemplateTransaction;
const caller = { orgId: 'org-1', actorId: 'actor-1' };

/** One forest root command a test submits. */
interface RootSeed {
  readonly key: string;
  readonly kind: 'initiative' | 'program' | 'project' | 'task';
  readonly body?: Record<string, unknown>;
  readonly placement?: Record<string, unknown>;
  readonly blueprint?: Record<string, unknown>;
}

function batch(roots: readonly RootSeed[], extra: Record<string, unknown> = {}) {
  return {
    roots: roots.map((root) => ({
      key: root.key,
      command: {
        kind: root.kind,
        caller,
        body: root.body ?? {},
        ...(root.blueprint ? { blueprint: root.blueprint } : {}),
        invocation: {
          prospectiveWorkId: `${root.key}-id`,
          ...(root.placement ? { placement: root.placement } : {}),
        },
      },
    })),
    ...extra,
  } as unknown as WorkCreationBatchCommand;
}

/** Prepared rows a mocked blueprint preparation returns for one root. */
interface PlanSeed {
  readonly entries: readonly unknown[];
  readonly dependencies?: readonly unknown[];
  readonly actorId?: string | null;
}

function plan(seed: PlanSeed): PreparedBlueprintCreation {
  return {
    command: { caller: { orgId: 'org-1', actorId: seed.actorId ?? null } },
    graph: { fingerprint: 'graph' },
    tree: { dependencies: seed.dependencies ?? [] },
    context: { workingWeekdays: [1, 2, 3, 4, 5] },
    entries: seed.entries,
  } as unknown as PreparedBlueprintCreation;
}

function allocated(id: string, path: readonly string[]) {
  return { id, node: { path } };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.context.mockImplementation(async () => ({}));
});

describe('prospective creation inserts', () => {
  it('projects each authorized insert kind without inventing placement', () => {
    const cases: [ResolvedWorkInsert, ProspectiveWorkReference][] = [
      [
        { kind: 'initiative', values: { organizationId: 'org-1' } } as ResolvedWorkInsert,
        { id: 'w', orgId: 'org-1', kind: 'initiative' },
      ],
      [
        { kind: 'program', values: { organizationId: 'org-1' } } as ResolvedWorkInsert,
        { id: 'w', orgId: 'org-1', kind: 'program', visibility: 'public' },
      ],
      [
        {
          kind: 'project',
          values: { organizationId: 'org-1', visibility: 'private', programId: 'p' },
        } as ResolvedWorkInsert,
        { id: 'w', orgId: 'org-1', kind: 'project', visibility: 'private', programId: 'p' },
      ],
      [
        {
          kind: 'task',
          values: { organizationId: 'org-1', visibility: null },
        } as unknown as ResolvedWorkInsert,
        {
          id: 'w',
          orgId: 'org-1',
          kind: 'task',
          visibility: 'public',
          projectId: null,
          programId: null,
          parentTaskId: null,
        },
      ],
      [
        {
          kind: 'milestone',
          values: { organizationId: 'org-1', projectId: 'p' },
        } as ResolvedWorkInsert,
        { id: 'w', orgId: 'org-1', kind: 'milestone', projectId: 'p' },
      ],
    ];
    for (const [insert, expected] of cases)
      expect(prospectiveCreationInsert(insert, 'w')).toEqual(expected);
  });
});

describe('creation forest preflight', () => {
  it('offers later roots every earlier prospective root, row and checkpoint', async () => {
    mocks.prepare
      .mockResolvedValueOnce(plan({ entries: [] }))
      .mockResolvedValueOnce(
        plan({
          entries: [
            {
              kind: 'ordinary',
              allocated: allocated('launch-id', []),
              prepared: {
                insert: { kind: 'project', values: { organizationId: 'org-1' } },
                milestoneRows: [
                  { organizationId: 'org-1', projectId: 'launch-id' },
                  { id: 'gate', organizationId: 'org-1', projectId: 'launch-id' },
                ],
              },
            },
            {
              kind: 'task',
              allocated: allocated('prep-id', ['prep']),
              insert: { kind: 'task', values: { organizationId: 'org-1' } },
            },
            { kind: 'existing', allocated: allocated('kept', ['kept']), work: { id: 'kept' } },
          ],
        }),
      )
      .mockResolvedValue(plan({ entries: [] }));
    const prepared = await prepareCreationForest(
      tx,
      batch([
        { key: 'goal', kind: 'initiative' },
        { key: 'launch', kind: 'program', body: { visibility: 'private' } },
        { key: 'follow', kind: 'program' },
      ]),
    );
    expect(prepared).toHaveLength(3);
    const offered = mocks.context.mock.calls.map(
      (call) => call[2] as readonly ProspectiveWorkReference[],
    );
    expect(offered[0]).toEqual([{ id: 'goal-id', orgId: 'org-1', kind: 'initiative' }]);
    expect(offered[1]).toContainEqual({
      id: 'launch-id',
      orgId: 'org-1',
      kind: 'program',
      visibility: 'private',
    });
    expect(offered[2]?.map((reference) => reference.id)).toEqual([
      'goal-id',
      'launch-id',
      'gate',
      'prep-id',
      'follow-id',
    ]);
    expect(offered[2]).toContainEqual({
      id: 'follow-id',
      orgId: 'org-1',
      kind: 'program',
      visibility: 'public',
    });
    expect(mocks.timing).not.toHaveBeenCalled();
  });

  it('replans private timing from a new canonical root with default choices', async () => {
    const root = {
      kind: 'ordinary',
      allocated: allocated('event-id', []),
      prepared: { insert: { kind: 'project', values: { organizationId: 'org-1' } } },
    };
    mocks.prepare.mockResolvedValue(plan({ entries: [root] }));
    mocks.plan.mockReturnValue({ tree: { nodes: ['replanned'] } });
    let replanned: unknown;
    mocks.timing.mockImplementation((command, plans) => {
      replanned = plans[0].replan(command.roots[0].command);
      return command;
    });
    const input = batch([{ key: 'event', kind: 'project' }], { scheduleTiming: [{}] });
    await prepareCreationForest(tx, input);
    expect(replanned).toEqual({ nodes: ['replanned'] });
    expect(mocks.plan).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ choices: [] }),
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });

  it('refuses private timing when the root adopted existing work', async () => {
    mocks.prepare.mockResolvedValue(
      plan({
        entries: [{ kind: 'existing', allocated: allocated('kept', []), work: { id: 'kept' } }],
      }),
    );
    mocks.timing.mockImplementation((command, plans) => plans[0].replan(command.roots[0].command));
    await expect(
      prepareCreationForest(
        tx,
        batch([{ key: 'event', kind: 'project' }], { scheduleFieldTiming: {} }),
      ),
    ).rejects.toBeInstanceOf(CycleError);
  });
});

describe('existing creation dependency validation', () => {
  const existing = (id: string, path: readonly string[]) => ({
    kind: 'existing',
    allocated: allocated(id, path),
    work: { id },
  });
  const created = (id: string, path: readonly string[]) => ({
    kind: 'task',
    allocated: allocated(id, path),
  });

  it('skips forests that adopt no existing work', async () => {
    await validateExistingCreationDependencies(
      tx,
      [plan({ entries: [created('a', ['a'])] })],
      [{ blockerId: 'a', blockedId: 'b' }],
    );
    expect(mocks.cycle).not.toHaveBeenCalled();
  });

  it('refuses a validated dependency whose Task was never allocated', async () => {
    await expect(
      validateExistingCreationDependencies(
        tx,
        [
          plan({
            entries: [existing('kept', ['kept'])],
            dependencies: [{ blockerPath: ['kept'], blockedPath: ['missing'] }],
          }),
        ],
        [],
      ),
    ).rejects.toThrow(Error);
  });

  it('checks each adopted endpoint once and refuses an edge that closes a cycle', async () => {
    mocks.cycle.mockResolvedValue(true);
    const prepared = [
      plan({
        actorId: 'actor-1',
        entries: [existing('kept', ['kept']), existing('idle', ['idle']), created('new', ['new'])],
        dependencies: [{ blockerPath: ['kept'], blockedPath: ['new'] }],
      }),
      plan({ actorId: 'actor-1', entries: [existing('kept', ['kept'])] }),
      plan({ actorId: null, entries: [existing('kept', ['kept'])] }),
    ];
    await expect(
      validateExistingCreationDependencies(tx, prepared, [{ blockerId: 'new', blockedId: 'kept' }]),
    ).rejects.toBeInstanceOf(CycleError);
    expect(mocks.access).toHaveBeenCalledTimes(1);
    expect(mocks.access).toHaveBeenCalledWith(tx, expect.anything(), 'task', 'kept');
    expect(mocks.cycle).toHaveBeenCalledWith(tx, 'org-1', 'task', [
      { from: 'new', to: 'kept' },
      { from: 'kept', to: 'new' },
    ]);
  });

  it('accepts adopted work without new edges', async () => {
    await validateExistingCreationDependencies(
      tx,
      [plan({ actorId: 'actor-1', entries: [existing('kept', ['kept'])] })],
      [],
    );
    expect(mocks.cycle).not.toHaveBeenCalled();
    expect(mocks.access).not.toHaveBeenCalled();
  });
});

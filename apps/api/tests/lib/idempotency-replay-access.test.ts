/**
 * `@docket/api` — reauthorization before an object-command idempotency replay
 * (`lib/idempotency-replay-access.ts`).
 *
 * @remarks
 * The database and the batched resource-access resolver are replaced with in-memory fakes so each
 * scenario can grant one capability per resource. {@link minimalCapabilities} then derives, through
 * the public entry point alone, the weakest capability each touched resource must hold for the
 * replay to be allowed. That map is the observable contract under test.
 */
import type { Capability } from '@docket/authz';
import type * as DbModule from '@docket/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ResourceAccessModule from '../../src/permissions/resource-access';

const { select, resolveResourceAccess } = vi.hoisted(() => ({
  select: vi.fn(),
  resolveResourceAccess: vi.fn(),
}));

vi.mock('@docket/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  db: { select },
}));
vi.mock('../../src/permissions/resource-access', async (importOriginal) => ({
  ...(await importOriginal<typeof ResourceAccessModule>()),
  resolveResourceAccess,
}));

import { actor } from '@docket/db';

import { CapabilityError, NotFoundError } from '../../src/error';
import { assertCurrentObjectCommandReplayAccess } from '../../src/lib/idempotency-replay-access';
import {
  resourceAccessKey,
  type ResourceAccessRef,
  type ResourceAccessResult,
} from '../../src/permissions/resource-access';

/** A row carrying only an id, as returned by the membership and label lookups. */
interface IdRow {
  readonly id: string;
}

/** Arguments for one replay-access check; omitted fields use the defaults below. */
interface ReplayCheck {
  readonly path?: string;
  readonly organizationId?: string | null;
  readonly requestBody?: string;
  readonly result: unknown;
}

/** One receipt entry as stored in an object-command result. */
type ReceiptEntry = Record<string, unknown>;

const USER_ID = 'user-1';
const ORG_ID = 'org-1';
const PATH = `/v1/orgs/${ORG_ID}/object-commands`;
const LADDER: readonly Capability[] = ['view', 'comment', 'contribute', 'assign', 'manage'];

/** Build a deterministic 26-character ULID from a small number. */
function ulid(value: number): string {
  return `01J${String(value).padStart(23, '0')}`;
}

const TASK_1 = ulid(1);
const TASK_2 = ulid(2);
const TASK_3 = ulid(3);
const PROJECT_1 = ulid(11);
const PROJECT_2 = ulid(12);
const PROGRAM_1 = ulid(21);
const TEAM_1 = ulid(31);
const TEAM_2 = ulid(32);
const ACTOR_1 = ulid(41);
const LABEL_1 = ulid(51);
const INITIATIVE_1 = ulid(61);

let membershipRows: readonly IdRow[] = [];
let labelRows: readonly IdRow[] = [];
const grantedByKey = new Map<string, Capability | null>();

/** Resolve a fake query to its rows whether it is awaited directly or through `.limit()`. */
function queryResult(rows: readonly IdRow[]): Promise<readonly IdRow[]> {
  return Object.assign(Promise.resolve(rows), { limit: async () => rows });
}

beforeEach(() => {
  membershipRows = [{ id: 'actor-row' }];
  labelRows = [];
  grantedByKey.clear();
  select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => queryResult(table === actor ? membershipRows : labelRows),
    }),
  }));
  resolveResourceAccess.mockImplementation(
    async (_userId: string, refs: readonly ResourceAccessRef[]) =>
      new Map<string, ResourceAccessResult>(
        refs.map((ref) => {
          const key = resourceAccessKey(ref);
          const capability = grantedByKey.has(key) ? (grantedByKey.get(key) ?? null) : 'manage';
          return [key, { canView: capability !== null, effectiveCapability: capability }];
        }),
      ),
  );
});

afterEach(() => {
  select.mockReset();
  resolveResourceAccess.mockReset();
});

/** Run the replay-access check with defaults for every omitted argument. */
async function check(input: ReplayCheck): Promise<void> {
  const organizationId = 'organizationId' in input ? (input.organizationId ?? null) : ORG_ID;
  await assertCurrentObjectCommandReplayAccess(
    USER_ID,
    input.path ?? PATH,
    organizationId,
    input.requestBody ?? '',
    input.result,
  );
}

/** Return whether the check passes, treating only a capability shortfall as a denial. */
async function passes(input: ReplayCheck): Promise<boolean> {
  try {
    await check(input);
    return true;
  } catch (error) {
    if (error instanceof CapabilityError) return false;
    throw error;
  }
}

/** Find the weakest capability one resource must hold while every other resource holds manage. */
async function weakestPassingCapability(
  input: ReplayCheck,
  ref: ResourceAccessRef,
): Promise<Capability | undefined> {
  const key = resourceAccessKey(ref);
  for (const capability of LADDER) {
    grantedByKey.set(key, capability);
    if (await passes(input)) {
      grantedByKey.delete(key);
      return capability;
    }
  }
  grantedByKey.delete(key);
  return undefined;
}

/** Derive the weakest capability each touched resource needs, keyed by `kind:id`. */
async function minimalCapabilities(input: ReplayCheck): Promise<Record<string, Capability>> {
  resolveResourceAccess.mockClear();
  await check(input);
  const refs = (resolveResourceAccess.mock.calls[0]?.[1] ?? []) as readonly ResourceAccessRef[];
  const required: Record<string, Capability> = {};
  for (const ref of refs) {
    const capability = await weakestPassingCapability(input, ref);
    if (capability) required[`${ref.kind}:${ref.id}`] = capability;
  }
  return required;
}

/** Build a valid object-command result around one receipt. */
function commandResult(
  objectKind: 'task' | 'project',
  action: string,
  entries: readonly ReceiptEntry[],
  appliedIds: readonly string[] = [],
): Record<string, unknown> {
  return {
    appliedIds,
    conflictingIds: [],
    deniedIds: [],
    receipt: { commandId: 'command-1', objectKind, action, entries },
  };
}

/** Build an object-property receipt entry. */
function objectEntry(
  objectId: string,
  property: string,
  before: unknown,
  after: unknown,
): ReceiptEntry {
  return { kind: 'object', objectId, property, before, after };
}

/** Build a relation receipt entry that records an added edge. */
function relationEntry(objectId: string, relation: string, relatedId: string): ReceiptEntry {
  return { kind: 'relation', objectId, relation, relatedId, before: false, after: true };
}

const EMPTY_TASK_RESULT = commandResult('task', 'replace_property', []);

describe('object-command replay access guards', () => {
  it('hides a result replayed under a different organization path', async () => {
    await expect(
      check({ path: '/v1/orgs/other-org/object-commands', result: EMPTY_TASK_RESULT }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hides a result replayed on a path that is not the object-command route', async () => {
    await expect(check({ path: '/v1/tasks', result: EMPTY_TASK_RESULT })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('hides a result when the caller has no organization context', async () => {
    await expect(check({ organizationId: null, result: EMPTY_TASK_RESULT })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('hides a stored response that is not an object-command result', async () => {
    await expect(check({ result: { unexpected: true } })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hides a result from a caller without an active membership', async () => {
    membershipRows = [];

    await expect(check({ result: EMPTY_TASK_RESULT })).rejects.toBeInstanceOf(NotFoundError);
    expect(resolveResourceAccess).not.toHaveBeenCalled();
  });

  it('hides a result whose object the caller can no longer see', async () => {
    const result = commandResult('task', 'trash', [], [TASK_1]);
    grantedByKey.set(resourceAccessKey({ organizationId: ORG_ID, kind: 'task', id: TASK_1 }), null);

    await expect(check({ result })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hides a result whose label no longer exists and allows it while the label exists', async () => {
    const result = commandResult('task', 'add_association', [
      relationEntry(TASK_1, 'label', LABEL_1),
    ]);

    await expect(check({ result })).rejects.toBeInstanceOf(NotFoundError);
    labelRows = [{ id: LABEL_1 }];
    await expect(check({ result })).resolves.toBeUndefined();
  });
});

describe('object-command replay access from the stored receipt', () => {
  it('requires the strongest capability any Task entry needs plus view on referenced records', async () => {
    const result = commandResult(
      'task',
      'replace_property',
      [
        objectEntry(TASK_1, 'assigneeId', null, ACTOR_1),
        objectEntry(TASK_1, 'priority', 'low', 'high'),
        objectEntry(TASK_2, 'programId', PROGRAM_1, null),
        objectEntry(TASK_2, 'parentTaskId', null, TASK_3),
      ],
      [TASK_1, TASK_2],
    );

    expect(await minimalCapabilities({ result })).toEqual({
      [`task:${TASK_1}`]: 'assign',
      [`task:${TASK_2}`]: 'contribute',
      [`program:${PROGRAM_1}`]: 'view',
      [`task:${TASK_3}`]: 'view',
    });
  });

  it('requires manage to replay a Project archive and view on its Team and Program references', async () => {
    const result = commandResult(
      'project',
      'replace_property',
      [
        objectEntry(PROJECT_1, 'archivedAt', null, '2026-09-01T00:00:00.000Z'),
        objectEntry(PROJECT_1, 'teamId', TEAM_1, TEAM_2),
        objectEntry(PROJECT_1, 'programId', null, PROGRAM_1),
      ],
      [PROJECT_1],
    );

    expect(await minimalCapabilities({ result })).toEqual({
      [`project:${PROJECT_1}`]: 'manage',
      [`team:${TEAM_1}`]: 'view',
      [`team:${TEAM_2}`]: 'view',
      [`program:${PROGRAM_1}`]: 'view',
    });
  });

  it('requires view on an Initiative association and contribute on a dependency endpoint', async () => {
    const result = commandResult('project', 'add_association', [
      relationEntry(PROJECT_1, 'initiative', INITIATIVE_1),
      relationEntry(PROJECT_1, 'dependency', PROJECT_2),
    ]);

    expect(await minimalCapabilities({ result })).toEqual({
      [`project:${PROJECT_1}`]: 'contribute',
      [`initiative:${INITIATIVE_1}`]: 'view',
      [`project:${PROJECT_2}`]: 'contribute',
    });
  });
});

describe('object-command replay access from an undo or redo request', () => {
  /** Serialize an undo/redo request over a Task receipt. */
  function replayRequest(
    direction: 'undo' | 'redo',
    action: string,
    entries: readonly ReceiptEntry[],
  ): string {
    return JSON.stringify({
      commandId: `${direction}-1`,
      direction,
      receipt: { commandId: 'command-1', objectKind: 'task', action, entries },
    });
  }

  const moveEntries = [
    objectEntry(TASK_1, 'projectId', PROJECT_1, PROJECT_2),
    objectEntry(TASK_1, 'programId', PROGRAM_1, null),
    objectEntry(TASK_1, 'priority', 'low', 'high'),
  ];

  it('requires contribute on the Project an undo restores', async () => {
    const requestBody = replayRequest('undo', 'replace_property', moveEntries);

    expect(await minimalCapabilities({ result: EMPTY_TASK_RESULT, requestBody })).toEqual({
      [`task:${TASK_1}`]: 'contribute',
      [`project:${PROJECT_1}`]: 'contribute',
      [`program:${PROGRAM_1}`]: 'contribute',
    });
  });

  it('requires contribute on the Project a redo reapplies', async () => {
    const requestBody = replayRequest('redo', 'replace_property', moveEntries);

    expect(await minimalCapabilities({ result: EMPTY_TASK_RESULT, requestBody })).toEqual({
      [`task:${TASK_1}`]: 'contribute',
      [`project:${PROJECT_2}`]: 'contribute',
    });
  });

  it('requires contribute on both dependency endpoints and nothing extra for a label edge', async () => {
    const requestBody = replayRequest('undo', 'add_dependency', [
      relationEntry(TASK_1, 'dependency', TASK_2),
      relationEntry(TASK_1, 'label', LABEL_1),
    ]);

    expect(await minimalCapabilities({ result: EMPTY_TASK_RESULT, requestBody })).toEqual({
      [`task:${TASK_1}`]: 'contribute',
      [`task:${TASK_2}`]: 'contribute',
    });
  });
});

describe('object-command replay access from a forward request', () => {
  /** Serialize a forward command over the given objects. */
  function forwardRequest(
    objectKind: 'task' | 'project',
    objectIds: readonly string[],
    operation: Record<string, unknown>,
  ): string {
    return JSON.stringify({ commandId: 'forward-1', objectKind, objectIds, operation });
  }

  /** Derive the weakest capabilities a forward request requires on its own. */
  async function forwardRequirements(requestBody: string): Promise<Record<string, Capability>> {
    return minimalCapabilities({ result: EMPTY_TASK_RESULT, requestBody });
  }

  it.each(['trash', 'restore'])('requires manage to %s a Project', async (type) => {
    expect(await forwardRequirements(forwardRequest('project', [PROJECT_1], { type }))).toEqual({
      [`project:${PROJECT_1}`]: 'manage',
    });
  });

  it('requires only contribute to trash a Task', async () => {
    expect(await forwardRequirements(forwardRequest('task', [TASK_1], { type: 'trash' }))).toEqual({
      [`task:${TASK_1}`]: 'contribute',
    });
  });

  it('requires assign to change a Task assignee', async () => {
    const operation = { type: 'replace_property', property: 'assigneeId', value: ACTOR_1 };

    expect(await forwardRequirements(forwardRequest('task', [TASK_1], operation))).toEqual({
      [`task:${TASK_1}`]: 'assign',
    });
  });

  it('requires assign to change a Project lead', async () => {
    const operation = { type: 'replace_property', property: 'leadId', value: ACTOR_1 };

    expect(await forwardRequirements(forwardRequest('project', [PROJECT_1], operation))).toEqual({
      [`project:${PROJECT_1}`]: 'assign',
    });
  });

  it('requires contribute on the Project a Task moves into', async () => {
    const operation = { type: 'replace_property', property: 'projectId', value: PROJECT_1 };

    expect(await forwardRequirements(forwardRequest('task', [TASK_1], operation))).toEqual({
      [`task:${TASK_1}`]: 'contribute',
      [`project:${PROJECT_1}`]: 'contribute',
    });
  });

  it('requires nothing beyond the Task when it leaves its Project', async () => {
    const operation = { type: 'replace_property', property: 'projectId', value: null };

    expect(await forwardRequirements(forwardRequest('task', [TASK_1], operation))).toEqual({
      [`task:${TASK_1}`]: 'contribute',
    });
  });

  it('requires nothing beyond the Task for a property without a referenced record', async () => {
    const operation = { type: 'replace_property', property: 'title', value: 'Renamed' };

    expect(await forwardRequirements(forwardRequest('task', [TASK_1], operation))).toEqual({
      [`task:${TASK_1}`]: 'contribute',
    });
  });

  it('requires contribute on both endpoints of a new dependency', async () => {
    const operation = { type: 'add_dependency', blockingId: TASK_1, blockedId: TASK_2 };

    expect(await forwardRequirements(forwardRequest('task', [TASK_1], operation))).toEqual({
      [`task:${TASK_1}`]: 'contribute',
      [`task:${TASK_2}`]: 'contribute',
    });
  });

  it('requires contribute on the new parent Task', async () => {
    const operation = { type: 'change_parent', parentId: TASK_3 };

    expect(await forwardRequirements(forwardRequest('task', [TASK_1], operation))).toEqual({
      [`task:${TASK_1}`]: 'contribute',
      [`task:${TASK_3}`]: 'contribute',
    });
  });

  it('requires nothing beyond the Task when it is detached from its parent', async () => {
    const operation = { type: 'change_parent', parentId: null };

    expect(await forwardRequirements(forwardRequest('task', [TASK_1], operation))).toEqual({
      [`task:${TASK_1}`]: 'contribute',
    });
  });

  it('ignores a request body that is not valid JSON', async () => {
    expect(await forwardRequirements('{not json')).toEqual({});
  });
});

/**
 * Unit tests for the full-fidelity {@link LinearProviderClient} work-graph client.
 *
 * @remarks
 * Every request-building and response-mapping path is exercised through a fake
 * {@link HttpClient} wrapped in a real {@link ProviderHttp}, so no network is touched. Request
 * bodies are inspected to prove cursors/filters travel as GraphQL **variables**, never as
 * string-interpolated query text. The pure edge-mapping functions are tested directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectorError, type ConnectorErrorKind } from '../../src/ports/connector-error';
import { ProviderHttp } from '../../src/real/connector-http';
import type { HttpClient } from '../../src/real/http';
import {
  LinearProviderClient,
  mapLinearPriority,
  mapLinearProjectState,
  mapLinearStateType,
  toExternalCycle,
  toExternalLabel,
  toExternalProject,
  toExternalUser,
  toExternalWorkItem,
  toExternalWorkflowState,
  toLinearPriority,
} from '../../src/real/connector-linear';
import type { ExternalPriority } from '../../src/ports/work-graph';

/** One recorded HTTP call: the URL and the parsed JSON request body. */
interface RecordedCall {
  readonly url: string;
  readonly body: { readonly query: string; readonly variables?: Record<string, unknown> };
}

/** A fake {@link HttpClient} that records calls (with parsed bodies) and returns scripted responses. */
function fakeHttp(responses: Response[]): {
  client: LinearProviderClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let index = 0;
  const http: HttpClient = async (url, init) => {
    calls.push({ url, body: JSON.parse(init?.body as string) });
    const res = responses[index];
    index += 1;
    if (!res) throw new Error(`fakeHttp: no scripted response for call #${index}`);
    return res;
  };
  const providerHttp = new ProviderHttp('linear', 'https://api.linear.app', 'lin_tok', http);
  return { client: new LinearProviderClient(providerHttp), calls };
}

/** Wrap a `data` payload as a Linear GraphQL 200 response. */
function gql(data: unknown): Response {
  return new Response(JSON.stringify({ data }), { status: 200 });
}

/** A GraphQL 200 carrying an `errors[]` array (Linear surfaces auth failures this way). */
function gqlError(message: string): Response {
  return new Response(JSON.stringify({ errors: [{ message }] }), { status: 200 });
}

/** Assert a thunk rejects with a {@link ConnectorError} of the expected kind. */
async function expectConnectorError(
  thunk: () => Promise<unknown>,
  kind: ConnectorErrorKind,
): Promise<void> {
  await expect(thunk()).rejects.toMatchObject({ kind });
  await expect(thunk()).rejects.toBeInstanceOf(ConnectorError);
}

/** An empty paginated connection (no next page) for a resource we don't care about in a given test. */
function emptyConnection(): { nodes: never[]; pageInfo: { hasNextPage: false } } {
  return { nodes: [], pageInfo: { hasNextPage: false } };
}

/** The five responses (users, labels, projects, cycles, issues) `pullWorkGraph` consumes, in order. */
function emptyPullResponses(): Response[] {
  return [
    gql({ users: emptyConnection() }),
    gql({ issueLabels: emptyConnection() }),
    gql({ projects: emptyConnection() }),
    gql({ cycles: emptyConnection() }),
    gql({ issues: emptyConnection() }),
  ];
}

describe('LinearProviderClient — resolveAccount', () => {
  it('resolves the viewer label plus the organization id and slug', async () => {
    const { client, calls } = fakeHttp([
      gql({
        viewer: { id: 'u1', name: 'Ada', email: 'ada@x.dev' },
        organization: { id: 'org-uuid', urlKey: 'docket' },
      }),
    ]);
    const account = await client.resolveAccount();
    expect(account).toEqual({
      label: 'Ada',
      externalWorkspaceId: 'org-uuid',
      externalWorkspaceSlug: 'docket',
    });
    expect(calls[0]!.url).toBe('https://api.linear.app/graphql');
    expect(calls[0]!.body.query).toContain('organization');
  });

  it('falls back to the viewer email and omits workspace ids when absent', async () => {
    const { client } = fakeHttp([gql({ viewer: { id: 'u1', email: 'only@x.dev' } })]);
    const account = await client.resolveAccount();
    expect(account).toEqual({ label: 'only@x.dev' });
  });

  it('returns undefined when the viewer has no label', async () => {
    const { client } = fakeHttp([gql({ viewer: { id: 'u1' } })]);
    expect(await client.resolveAccount()).toBeUndefined();
  });
});

describe('LinearProviderClient — listContainers (teams)', () => {
  it('maps teams to id/title resource refs', async () => {
    const { client, calls } = fakeHttp([
      gql({
        teams: {
          nodes: [
            { id: 't1', name: 'Engineering', key: 'ENG' },
            { id: 't2', name: 'Design', key: 'DES' },
          ],
          pageInfo: { hasNextPage: false },
        },
      }),
    ]);
    const containers = await client.listContainers();
    expect(containers).toEqual([
      { id: 't1', title: 'Engineering' },
      { id: 't2', title: 'Design' },
    ]);
    expect(calls[0]!.body.query).toContain('teams');
  });
});

describe('LinearProviderClient — listTeamStates', () => {
  it('maps and orders workflow states by position, passing the team id as a variable', async () => {
    const { client, calls } = fakeHttp([
      gql({
        team: {
          states: {
            nodes: [
              { id: 's2', name: 'In Progress', type: 'started', position: 2 },
              { id: 's1', name: 'Todo', type: 'unstarted', position: 1 },
            ],
          },
        },
      }),
    ]);
    const states = await client.listTeamStates('t1');
    expect(states.map((s) => s.externalId)).toEqual(['s1', 's2']);
    expect(states[0]).toEqual({
      externalId: 's1',
      name: 'Todo',
      type: 'unstarted',
      position: 1,
    });
    expect(calls[0]!.body.variables).toEqual({ id: 't1' });
    expect(calls[0]!.body.query).not.toContain('t1');
  });
});

describe('LinearProviderClient — pagination', () => {
  it('follows the endCursor across pages, passing it as the $after variable', async () => {
    const { client, calls } = fakeHttp([
      gql({
        users: {
          nodes: [{ id: 'u1', displayName: 'One', active: true }],
          pageInfo: { hasNextPage: true, endCursor: 'CUR1' },
        },
      }),
      gql({
        users: {
          nodes: [{ id: 'u2', displayName: 'Two', active: true }],
          pageInfo: { hasNextPage: false },
        },
      }),
      gql({ issueLabels: emptyConnection() }),
      gql({ projects: emptyConnection() }),
      gql({ cycles: emptyConnection() }),
      gql({ issues: emptyConnection() }),
    ]);
    const snapshot = await client.pullWorkGraph({ externalTeamIds: [] });
    expect(snapshot.users.map((u) => u.externalId)).toEqual(['u1', 'u2']);
    // First page sends no cursor; second page sends it as a variable, not interpolated.
    expect(calls[0]!.body.variables).not.toHaveProperty('after');
    expect(calls[1]!.body.variables).toMatchObject({ after: 'CUR1' });
    expect(calls[1]!.body.query).not.toContain('CUR1');
  });

  it('stops at MAX_IMPORT_PAGES and logs a truncation warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // 100 user pages that all claim another page, then labels/projects/cycles/issues empties.
    const pages = Array.from({ length: 100 }, (_unused, i) =>
      gql({
        users: {
          nodes: [{ id: `u${i}`, displayName: `U${i}`, active: true }],
          pageInfo: { hasNextPage: true, endCursor: `CUR${i}` },
        },
      }),
    );
    const { client, calls } = fakeHttp([
      ...pages,
      gql({ issueLabels: emptyConnection() }),
      gql({ projects: emptyConnection() }),
      gql({ cycles: emptyConnection() }),
      gql({ issues: emptyConnection() }),
    ]);
    const snapshot = await client.pullWorkGraph({ externalTeamIds: [] });
    expect(snapshot.users).toHaveLength(100);
    // Exactly 100 user requests were made (the safety bound), plus 4 other collections.
    expect(calls).toHaveLength(104);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('import_truncated');
    warn.mockRestore();
  });
});

describe('LinearProviderClient — filter composition', () => {
  it('omits the issue filter and cycle team filter on a full unscoped pull', async () => {
    const { client, calls } = fakeHttp(emptyPullResponses());
    await client.pullWorkGraph({ externalTeamIds: [] });
    const cyclesCall = calls[3]!;
    const issuesCall = calls[4]!;
    expect(cyclesCall.body.query).not.toContain('filter');
    expect(cyclesCall.body.variables).not.toHaveProperty('teamIds');
    expect(issuesCall.body.variables).not.toHaveProperty('filter');
  });

  it('scopes cycles by team variable and issues by a team filter when teams are selected', async () => {
    const { client, calls } = fakeHttp(emptyPullResponses());
    await client.pullWorkGraph({ externalTeamIds: ['t1', 't2'] });
    const cyclesCall = calls[3]!;
    const issuesCall = calls[4]!;
    expect(cyclesCall.body.query).toContain('filter: { team: { id: { in: $teamIds } } }');
    expect(cyclesCall.body.variables).toMatchObject({ teamIds: ['t1', 't2'] });
    expect(issuesCall.body.variables).toEqual({ filter: { team: { id: { in: ['t1', 't2'] } } } });
  });

  it('adds an updatedAt cutoff to the issue filter on an incremental pull', async () => {
    const { client, calls } = fakeHttp(emptyPullResponses());
    await client.pullWorkGraph({ externalTeamIds: [], updatedAfter: '2026-06-01T00:00:00.000Z' });
    const issuesCall = calls[4]!;
    expect(issuesCall.body.variables).toEqual({
      filter: { updatedAt: { gt: '2026-06-01T00:00:00.000Z' } },
    });
  });

  it('composes team scope AND the updatedAt cutoff together', async () => {
    const { client, calls } = fakeHttp(emptyPullResponses());
    await client.pullWorkGraph({
      externalTeamIds: ['t1'],
      updatedAfter: '2026-06-01T00:00:00.000Z',
    });
    expect(calls[4]!.body.variables).toEqual({
      filter: {
        team: { id: { in: ['t1'] } },
        updatedAt: { gt: '2026-06-01T00:00:00.000Z' },
      },
    });
  });
});

describe('LinearProviderClient — pullWorkGraph project scoping', () => {
  it('client-side filters projects to those intersecting the selected teams', async () => {
    const { client } = fakeHttp([
      gql({ users: emptyConnection() }),
      gql({ issueLabels: emptyConnection() }),
      gql({
        projects: {
          nodes: [
            {
              id: 'p1',
              name: 'Kept',
              state: 'started',
              url: 'https://linear.app/p/p1',
              updatedAt: '2026-06-01T00:00:00.000Z',
              teams: { nodes: [{ id: 't1' }, { id: 't9' }] },
            },
            {
              id: 'p2',
              name: 'Dropped',
              state: 'started',
              url: 'https://linear.app/p/p2',
              updatedAt: '2026-06-01T00:00:00.000Z',
              teams: { nodes: [{ id: 't9' }] },
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      }),
      gql({ cycles: emptyConnection() }),
      gql({ issues: emptyConnection() }),
    ]);
    const snapshot = await client.pullWorkGraph({ externalTeamIds: ['t1'] });
    expect(snapshot.projects.map((p) => p.externalId)).toEqual(['p1']);
  });
});

describe('LinearProviderClient — pushWorkItem', () => {
  it('builds an issueUpdate input from only the present fields, addressing by id variable', async () => {
    const { client, calls } = fakeHttp([
      gql({ issueUpdate: { success: true, issue: { id: 'i1', updatedAt: 'T2' } } }),
    ]);
    const result = await client.pushWorkItem({
      kind: 'update',
      externalId: 'i1',
      fields: { title: 'New title', priority: 'high', stateExternalId: 's2' },
    });
    expect(result).toEqual({ externalId: 'i1', externalUpdatedAt: 'T2' });
    expect(calls[0]!.body.variables).toEqual({
      id: 'i1',
      input: { title: 'New title', priority: 2, stateId: 's2' },
    });
  });

  it('preserves explicit null to CLEAR a field but omits absent fields entirely', async () => {
    const { client, calls } = fakeHttp([
      gql({ issueUpdate: { success: true, issue: { id: 'i1', updatedAt: 'T2' } } }),
    ]);
    await client.pushWorkItem({
      kind: 'update',
      externalId: 'i1',
      fields: { assigneeExternalId: null, dueDate: null, estimate: null },
    });
    const input = calls[0]!.body.variables!['input'] as Record<string, unknown>;
    expect(input).toEqual({ assigneeId: null, dueDate: null, estimate: null });
    expect(input).not.toHaveProperty('title');
  });

  it('maps a create op to issueCreate with the teamId and returns the new id', async () => {
    const { client, calls } = fakeHttp([
      gql({ issueCreate: { success: true, issue: { id: 'new-1', updatedAt: 'T1', url: 'u' } } }),
    ]);
    const result = await client.pushWorkItem({
      kind: 'create',
      externalTeamId: 't1',
      fields: { title: 'Fresh', labelExternalIds: ['l1', 'l2'] },
    });
    expect(result).toEqual({ externalId: 'new-1', externalUpdatedAt: 'T1' });
    expect(calls[0]!.body.variables).toEqual({
      input: { teamId: 't1', title: 'Fresh', labelIds: ['l1', 'l2'] },
    });
  });

  it('throws a provider ConnectorError when the mutation reports success: false', async () => {
    const { client } = fakeHttp([gql({ issueUpdate: { success: false } })]);
    await expectConnectorError(
      () => client.pushWorkItem({ kind: 'update', externalId: 'i1', fields: { title: 'x' } }),
      'provider',
    );
  });

  it('classifies an auth-shaped GraphQL error as an auth ConnectorError', async () => {
    const { client } = fakeHttp([gqlError('Access denied: token expired')]);
    await expectConnectorError(
      () => client.pushWorkItem({ kind: 'update', externalId: 'i1', fields: { title: 'x' } }),
      'auth',
    );
  });
});

describe('LinearProviderClient — importWork', () => {
  it('emits the issue UUID (not the identifier) as the provenance externalId', async () => {
    const { client } = fakeHttp([
      gql({
        issues: {
          nodes: [
            {
              id: 'issue-uuid',
              identifier: 'ENG-1',
              title: 'Ship it',
              description: 'body',
              url: 'https://linear.app/x/ENG-1',
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      }),
    ]);
    const items = await client.importWork({ connectionId: 'c1', provider: 'linear' }, 'NOW');
    expect(items[0]).toEqual({
      id: 'issue-uuid',
      kind: 'issue',
      title: 'Ship it',
      body: 'body',
      provenance: {
        provider: 'linear',
        externalId: 'issue-uuid',
        externalUrl: 'https://linear.app/x/ENG-1',
        importedAt: 'NOW',
      },
    });
  });
});

describe('edge mapping — priority', () => {
  const cases: readonly (readonly [number, ExternalPriority])[] = [
    [0, 'none'],
    [1, 'urgent'],
    [2, 'high'],
    [3, 'medium'],
    [4, 'low'],
  ];

  it.each(cases)('maps Linear priority %i to %s and back', (num, priority) => {
    expect(mapLinearPriority(num)).toBe(priority);
    expect(toLinearPriority(priority)).toBe(num);
  });

  it('throws on an unknown priority number', () => {
    expect(() => mapLinearPriority(7)).toThrow(ConnectorError);
  });
});

describe('edge mapping — state type', () => {
  const types = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'] as const;

  it.each(types)('passes through the known state type %s', (type) => {
    expect(mapLinearStateType(type)).toBe(type);
  });

  it('throws on an unrecognized state type (no silent fallback)', () => {
    expect(() => mapLinearStateType('mystery')).toThrow(ConnectorError);
  });
});

describe('edge mapping — project state', () => {
  const states = ['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'] as const;

  it.each(states)('passes through the known project state %s', (state) => {
    expect(mapLinearProjectState(state)).toBe(state);
  });

  it('throws on an unrecognized project state', () => {
    expect(() => mapLinearProjectState('mystery')).toThrow(ConnectorError);
  });
});

describe('edge mapping — user', () => {
  it('prefers displayName and carries email/avatar/active', () => {
    expect(
      toExternalUser({
        id: 'u1',
        name: 'Ada Lovelace',
        displayName: 'Ada',
        email: 'ada@x.dev',
        avatarUrl: 'https://img/ada',
        active: true,
      }),
    ).toEqual({
      externalId: 'u1',
      displayName: 'Ada',
      email: 'ada@x.dev',
      avatarUrl: 'https://img/ada',
      active: true,
    });
  });

  it('falls back to name only when displayName is absent, omitting a null email', () => {
    expect(toExternalUser({ id: 'u2', name: 'Grace', email: null, active: false })).toEqual({
      externalId: 'u2',
      displayName: 'Grace',
      active: false,
    });
  });
});

describe('edge mapping — label team scoping', () => {
  it('carries the team id for a team-scoped label', () => {
    expect(toExternalLabel({ id: 'l1', name: 'Bug', color: '#f00', team: { id: 't1' } })).toEqual({
      externalId: 'l1',
      name: 'Bug',
      color: '#f00',
      externalTeamId: 't1',
    });
  });

  it('omits the team id for a workspace-level label', () => {
    expect(toExternalLabel({ id: 'l2', name: 'Chore', color: '#0f0', team: null })).toEqual({
      externalId: 'l2',
      name: 'Chore',
      color: '#0f0',
    });
  });
});

describe('edge mapping — project tombstone', () => {
  it('marks an archived project removed and carries lead/dates/teams', () => {
    expect(
      toExternalProject({
        id: 'p1',
        name: 'Old',
        description: 'desc',
        state: 'completed',
        url: 'https://linear.app/p/p1',
        startDate: '2026-01-01',
        targetDate: '2026-03-01',
        archivedAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        lead: { id: 'u1' },
        teams: { nodes: [{ id: 't1' }] },
      }),
    ).toEqual({
      externalId: 'p1',
      name: 'Old',
      description: 'desc',
      state: 'completed',
      leadExternalId: 'u1',
      startDate: '2026-01-01',
      targetDate: '2026-03-01',
      url: 'https://linear.app/p/p1',
      updatedAt: '2026-04-01T00:00:00.000Z',
      removed: true,
      externalTeamIds: ['t1'],
    });
  });

  it('leaves a live project without a removed flag', () => {
    const project = toExternalProject({
      id: 'p2',
      name: 'Live',
      state: 'started',
      url: 'https://linear.app/p/p2',
      updatedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(project).not.toHaveProperty('removed');
    expect(project.externalTeamIds).toEqual([]);
  });
});

describe('edge mapping — cycle', () => {
  it('requires a team and passes timestamps through', () => {
    expect(
      toExternalCycle({
        id: 'cy1',
        number: 7,
        name: 'Sprint 7',
        startsAt: '2026-06-01T00:00:00.000Z',
        endsAt: '2026-06-14T00:00:00.000Z',
        completedAt: '2026-06-14T00:00:00.000Z',
        updatedAt: '2026-06-14T00:00:00.000Z',
        team: { id: 't1' },
      }),
    ).toEqual({
      externalId: 'cy1',
      externalTeamId: 't1',
      number: 7,
      name: 'Sprint 7',
      startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-06-14T00:00:00.000Z',
      completedAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
    });
  });

  it('throws when a cycle has no team', () => {
    expect(() =>
      toExternalCycle({
        id: 'cy2',
        number: 1,
        startsAt: 'a',
        endsAt: 'b',
        updatedAt: 'c',
        team: null,
      }),
    ).toThrow(ConnectorError);
  });
});

describe('edge mapping — workflow state', () => {
  it('maps id/name/type/position', () => {
    expect(
      toExternalWorkflowState({ id: 's1', name: 'In Review', type: 'started', position: 3 }),
    ).toEqual({ externalId: 's1', name: 'In Review', type: 'started', position: 3 });
  });
});

describe('edge mapping — work item', () => {
  const richNode = {
    id: 'i1',
    identifier: 'ENG-1',
    title: 'Title',
    description: 'desc',
    url: 'https://linear.app/x/ENG-1',
    priority: 2,
    estimate: 5,
    dueDate: '2026-07-01',
    startedAt: '2026-06-02T00:00:00.000Z',
    completedAt: '2026-06-10T00:00:00.000Z',
    canceledAt: null,
    archivedAt: null,
    trashed: false,
    updatedAt: '2026-06-10T00:00:00.000Z',
    state: { id: 's1', name: 'Done', type: 'completed', position: 5 },
    assignee: { id: 'u1' },
    labels: { nodes: [{ id: 'l1' }, { id: 'l2' }] },
    project: { id: 'p1' },
    cycle: { id: 'cy1' },
    parent: { id: 'i0' },
    team: { id: 't1' },
  };

  it('maps every field and derives no tombstone for a live issue', () => {
    expect(toExternalWorkItem(richNode)).toEqual({
      externalId: 'i1',
      identifier: 'ENG-1',
      title: 'Title',
      description: 'desc',
      stateType: 'completed',
      stateName: 'Done',
      priority: 'high',
      assigneeExternalId: 'u1',
      labelExternalIds: ['l1', 'l2'],
      projectExternalId: 'p1',
      cycleExternalId: 'cy1',
      parentExternalId: 'i0',
      externalTeamId: 't1',
      estimate: 5,
      dueDate: '2026-07-01',
      startedAt: '2026-06-02T00:00:00.000Z',
      completedAt: '2026-06-10T00:00:00.000Z',
      url: 'https://linear.app/x/ENG-1',
      updatedAt: '2026-06-10T00:00:00.000Z',
    });
  });

  it('derives removed from archivedAt', () => {
    const item = toExternalWorkItem({ ...richNode, archivedAt: '2026-06-11T00:00:00.000Z' });
    expect(item.removed).toBe(true);
  });

  it('derives removed from trashed', () => {
    const item = toExternalWorkItem({ ...richNode, trashed: true });
    expect(item.removed).toBe(true);
  });

  it('omits optional fields when absent and defaults labels to an empty list', () => {
    const item = toExternalWorkItem({
      id: 'i2',
      identifier: 'ENG-2',
      title: 'Bare',
      url: 'u',
      priority: 0,
      updatedAt: 'T',
      state: { id: 's2', name: 'Todo', type: 'unstarted', position: 1 },
      team: { id: 't1' },
    });
    expect(item).not.toHaveProperty('assigneeExternalId');
    expect(item).not.toHaveProperty('estimate');
    expect(item).not.toHaveProperty('description');
    expect(item.labelExternalIds).toEqual([]);
    expect(item.priority).toBe('none');
  });

  it('throws when an issue has no team', () => {
    expect(() => toExternalWorkItem({ ...richNode, team: null })).toThrow(ConnectorError);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

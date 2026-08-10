import '@testing-library/jest-dom/vitest';

import {
  ActorId,
  type InitiativeOut,
  type MemberOut,
  type OrgOut,
  type OrgSummary,
  OrganizationId,
  type ProgramOut,
  type ProjectOut,
  RoleId,
  type RoleOut,
  type TaskOut,
  TeamId,
  type TeamOut,
} from '@docket/types';
import { ContextProvider, useContextState } from '@docket/ui/components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { membersGet, orgGet, rolesGet, sessionState, teamsGet } = vi.hoisted(() => {
  const sessionState: {
    data: null | { user: { id: string } };
    isPending: boolean;
  } = { data: null, isPending: true };
  return {
    membersGet: vi.fn(),
    orgGet: vi.fn(),
    rolesGet: vi.fn(),
    sessionState,
    teamsGet: vi.fn(),
  };
});

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          $get: orgGet,
          members: { $get: membersGet },
          roles: { $get: rolesGet },
          teams: { $get: teamsGet },
        },
      },
    },
  },
}));

vi.mock('../../src/lib/auth-client', () => ({
  useSession: () => sessionState,
}));

import { ActiveOrgContext } from '../../src/components/active-org';
import {
  type CreateInitiativeRequest,
  completeCreateObject,
  CreateObjectProvider,
  type CreateProgramRequest,
  type CreateProjectRequest,
  type CreateTaskRequest,
  type CreateTeamRequest,
  useCreateObject,
} from '../../src/components/create-object/create-object-provider';
import { useCreationContext } from '../../src/components/create-object/creation-context';
import { WorkspacePicker } from '../../src/components/create-object/workspace-picker';
import { okResponse } from '../support/query';

const ALPHA_ID = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2H');
const BRAVO_ID = OrganizationId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2J');
const ALPHA_TEAM_ID = TeamId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2K');
const BRAVO_TEAM_ID = TeamId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2M');
const BRAVO_DEFAULT_TEAM_ID = TeamId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2N');
const ALPHA_ACTOR_ID = ActorId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2P');
const BRAVO_ACTOR_ID = ActorId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2Q');
const ALPHA_ROLE_ID = RoleId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2R');
const BRAVO_ROLE_ID = RoleId.parse('01HZX5K3QJ9F8B7C6D5E4F3G2S');

const ALPHA_WORKSPACE: OrgSummary = {
  id: ALPHA_ID,
  name: 'Alpha workspace',
  slug: 'alpha',
  avatar: null,
  isPersonal: true,
};

const BRAVO_WORKSPACE: OrgSummary = {
  id: BRAVO_ID,
  name: 'Bravo workspace',
  slug: 'bravo',
  avatar: null,
  isPersonal: false,
};

const WORKSPACES: readonly OrgSummary[] = [ALPHA_WORKSPACE, BRAVO_WORKSPACE];

describe('completeCreateObject', () => {
  it('invalidates destination keys and runs a same-workspace stay callback without routing', () => {
    const invalidate = vi.fn();
    const onCreated = vi.fn();
    const openDestination = vi.fn();
    const created = { id: 'project_1' };

    completeCreateObject({
      created,
      initialWorkspaceId: ALPHA_ID,
      targetWorkspaceId: ALPHA_ID,
      sameWorkspaceCompletion: 'stay',
      onCreated,
      invalidationKeys: [['org', ALPHA_ID, 'projects'], ['portfolio']],
      invalidate,
      openDestination,
    });

    expect(invalidate.mock.calls).toEqual([[['org', ALPHA_ID, 'projects']], [['portfolio']]]);
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(openDestination).not.toHaveBeenCalled();
  });

  it('routes a same-workspace open completion after notifying its launcher', () => {
    const onCreated = vi.fn();
    const openDestination = vi.fn();
    const created = { id: 'program_1' };

    completeCreateObject({
      created,
      initialWorkspaceId: ALPHA_ID,
      targetWorkspaceId: ALPHA_ID,
      sameWorkspaceCompletion: 'open',
      onCreated,
      invalidationKeys: [],
      invalidate: vi.fn(),
      openDestination,
    });

    expect(onCreated).toHaveBeenCalledWith(created);
    expect(openDestination).toHaveBeenCalledOnce();
  });

  it('overrides stay for a cross-workspace target and suppresses the origin callback', () => {
    const invalidate = vi.fn();
    const onCreated = vi.fn();
    const openDestination = vi.fn();

    completeCreateObject({
      created: { id: 'task_1' },
      initialWorkspaceId: ALPHA_ID,
      targetWorkspaceId: BRAVO_ID,
      sameWorkspaceCompletion: 'stay',
      onCreated,
      invalidationKeys: [['org', BRAVO_ID, 'tasks']],
      invalidate,
      openDestination,
    });

    expect(invalidate).toHaveBeenCalledWith(['org', BRAVO_ID, 'tasks']);
    expect(onCreated).not.toHaveBeenCalled();
    expect(openDestination).toHaveBeenCalledOnce();
  });

  it('can suppress navigation for create-more while retaining invalidation and callback policy', () => {
    const invalidate = vi.fn();
    const onCreated = vi.fn();
    const openDestination = vi.fn();

    completeCreateObject({
      created: { id: 'task_2' },
      initialWorkspaceId: ALPHA_ID,
      targetWorkspaceId: ALPHA_ID,
      sameWorkspaceCompletion: 'open',
      navigationEnabled: false,
      onCreated,
      invalidationKeys: [['org', ALPHA_ID, 'tasks']],
      invalidate,
      openDestination,
    });

    expect(invalidate).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledOnce();
    expect(openDestination).not.toHaveBeenCalled();
  });
});

const DETAILS: Readonly<Record<string, OrgOut>> = {
  [ALPHA_ID]: {
    ...ALPHA_WORKSPACE,
    purpose: null,
    vocabulary: { preset: 'startup', overrides: {} },
    lifecycleState: 'active',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  [BRAVO_ID]: {
    ...BRAVO_WORKSPACE,
    purpose: null,
    vocabulary: {
      preset: 'agency',
      overrides: { project: { singular: 'Engagement', plural: 'Engagements' } },
    },
    lifecycleState: 'active',
    createdAt: '2026-08-02T00:00:00.000Z',
  },
};

const TEAMS: Readonly<Record<string, readonly TeamOut[]>> = {
  [ALPHA_ID]: [
    {
      id: ALPHA_TEAM_ID,
      organizationId: ALPHA_ID,
      name: 'General',
      key: 'GEN',
      summary: null,
      triageEnabled: true,
    },
  ],
  [BRAVO_ID]: [
    {
      id: BRAVO_TEAM_ID,
      organizationId: BRAVO_ID,
      name: 'Delivery',
      key: 'DEL',
      summary: null,
      triageEnabled: true,
    },
    {
      id: BRAVO_DEFAULT_TEAM_ID,
      organizationId: BRAVO_ID,
      name: 'General',
      key: 'GEN',
      summary: null,
      triageEnabled: true,
    },
  ],
};

const MEMBERS: Readonly<Record<string, readonly MemberOut[]>> = {
  [ALPHA_ID]: [
    {
      actorId: ALPHA_ACTOR_ID,
      organizationId: ALPHA_ID,
      displayName: 'Ada Lovelace',
      status: 'active',
      roleId: ALPHA_ROLE_ID,
      userId: 'user_1',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ],
  [BRAVO_ID]: [
    {
      actorId: BRAVO_ACTOR_ID,
      organizationId: BRAVO_ID,
      displayName: 'Ada Lovelace',
      status: 'active',
      roleId: BRAVO_ROLE_ID,
      userId: 'user_1',
      createdAt: '2026-08-02T00:00:00.000Z',
    },
  ],
};

const ROLES: Readonly<Record<string, readonly RoleOut[]>> = {
  [ALPHA_ID]: [
    {
      id: ALPHA_ROLE_ID,
      organizationId: ALPHA_ID,
      key: 'owner',
      name: 'Owner',
      isSystem: true,
      capabilities: ['manage'],
      baseCapability: 'manage',
      defaultVisibility: 'public',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ],
  [BRAVO_ID]: [
    {
      id: BRAVO_ROLE_ID,
      organizationId: BRAVO_ID,
      key: 'member',
      name: 'Member',
      isSystem: true,
      capabilities: ['contribute'],
      baseCapability: 'contribute',
      defaultVisibility: 'public',
      createdAt: '2026-08-02T00:00:00.000Z',
    },
  ],
};

const REQUEST_CONTRACT = [
  {
    kind: 'task',
    sameWorkspaceCompletion: 'stay',
    onCreated: (_created: TaskOut): void => undefined,
  } satisfies CreateTaskRequest,
  {
    kind: 'project',
    sameWorkspaceCompletion: 'open',
    onCreated: (_created: ProjectOut): void => undefined,
  } satisfies CreateProjectRequest,
  {
    kind: 'initiative',
    sameWorkspaceCompletion: 'stay',
    onCreated: (_created: InitiativeOut): void => undefined,
  } satisfies CreateInitiativeRequest,
  {
    kind: 'program',
    sameWorkspaceCompletion: 'open',
    onCreated: (_created: ProgramOut): void => undefined,
  } satisfies CreateProgramRequest,
  {
    kind: 'team',
    onCreated: (_created: TeamOut): void => undefined,
  } satisfies CreateTeamRequest,
] as const;

/** Expose the provider state through user-operable controls, including the workspace picker. */
function ProviderProbe(): JSX.Element {
  const { request, openCreate, closeCreate } = useCreateObject();
  const creation = useCreationContext();
  const { activeOrgId: shellWorkspaceId } = useContextState();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          openCreate({ kind: 'project', sameWorkspaceCompletion: 'open' });
        }}
      >
        Open project
      </button>
      <button
        type="button"
        onClick={() => {
          openCreate({
            kind: 'project',
            initialWorkspaceId: BRAVO_ID,
            sameWorkspaceCompletion: 'stay',
          });
        }}
      >
        Open targeted project
      </button>
      <button
        type="button"
        onClick={() => {
          openCreate({ kind: 'program', sameWorkspaceCompletion: 'open' });
        }}
      >
        Open program
      </button>
      <button type="button" onClick={closeCreate}>
        Close create
      </button>

      <output data-testid="request-kind">{request?.kind ?? 'closed'}</output>
      <output data-testid="initial-workspace" data-workspace-id={request?.initialWorkspaceId ?? ''}>
        {request?.initialWorkspaceId ?? 'none'}
      </output>
      <output data-testid="shell-workspace" data-workspace-id={shellWorkspaceId ?? ''}>
        {shellWorkspaceId ?? 'none'}
      </output>
      <output data-testid="target-workspace" data-workspace-id={creation.targetWorkspaceId ?? ''}>
        {creation.targetWorkspaceId ?? 'none'}
      </output>
      <output data-testid="target-state">{creation.loading ? 'loading' : 'settled'}</output>
      <output data-testid="target-name">{creation.workspace?.name ?? 'none'}</output>
      <output data-testid="target-vocabulary">
        {creation.vocabulary?.overrides?.['project']?.singular ??
          creation.vocabulary?.preset ??
          'none'}
      </output>
      <output data-testid="default-team">{creation.defaultTeamId ?? 'none'}</output>
      <output data-testid="can-create">{String(creation.permissions.canCreate)}</output>
      <output data-testid="permissions-loading">{String(creation.permissions.loading)}</output>
      {request ? <WorkspacePicker /> : null}
    </>
  );
}

/** Resolve shell workspace data after a creation request has already opened. */
function DelayedProviderHarness(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<readonly OrgSummary[]>([]);
  const { setContext } = useContextState();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setWorkspaces(WORKSPACES);
        }}
      >
        Publish workspace memberships
      </button>
      <button
        type="button"
        onClick={() => {
          setContext(BRAVO_ID);
        }}
      >
        Resolve persisted Bravo workspace
      </button>
      <button
        type="button"
        onClick={() => {
          setContext(ALPHA_ID);
        }}
      >
        Navigate shell to Alpha workspace
      </button>
      <ActiveOrgContext orgs={workspaces} activeOrgId={null} orgsError={null}>
        <CreateObjectProvider>
          <ProviderProbe />
        </CreateObjectProvider>
      </ActiveOrgContext>
    </>
  );
}

/** Render the global provider in the same shell contexts it consumes in production. */
function renderProvider(workspaces: readonly OrgSummary[] = WORKSPACES): {
  readonly rerenderProvider: () => void;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const frame = (): JSX.Element => (
    <QueryClientProvider client={client}>
      <ContextProvider initialContext={ALPHA_ID}>
        <ActiveOrgContext orgs={workspaces} activeOrgId={null} orgsError={null}>
          <CreateObjectProvider>
            <ProviderProbe />
          </CreateObjectProvider>
        </ActiveOrgContext>
      </ContextProvider>
    </QueryClientProvider>
  );
  const rendered = render(frame());
  return {
    rerenderProvider: () => {
      rendered.rerender(frame());
    },
  };
}

/** Render the provider before the shell knows any workspace. */
function renderDelayedProvider(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <ContextProvider initialContext={null}>
        <DelayedProviderHarness />
      </ContextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionState.data = { user: { id: 'user_1' } };
  sessionState.isPending = false;
  orgGet
    .mockReset()
    .mockImplementation(({ param }: { param: { orgId: string } }) =>
      Promise.resolve(okResponse(DETAILS[param.orgId])),
    );
  teamsGet
    .mockReset()
    .mockImplementation(({ param }: { param: { orgId: string } }) =>
      Promise.resolve(okResponse({ items: TEAMS[param.orgId] ?? [] })),
    );
  membersGet
    .mockReset()
    .mockImplementation(({ param }: { param: { orgId: string } }) =>
      Promise.resolve(okResponse({ items: MEMBERS[param.orgId] ?? [] })),
    );
  rolesGet
    .mockReset()
    .mockImplementation(({ param }: { param: { orgId: string } }) =>
      Promise.resolve(okResponse({ items: ROLES[param.orgId] ?? [] })),
    );
});

describe('CreateObjectProvider', () => {
  it('carries completion behavior and a kind-typed callback for every supported request', () => {
    expect(REQUEST_CONTRACT.map((request) => request.kind)).toEqual([
      'task',
      'project',
      'initiative',
      'program',
      'team',
    ]);
    expect([
      REQUEST_CONTRACT[0].sameWorkspaceCompletion,
      REQUEST_CONTRACT[1].sameWorkspaceCompletion,
      REQUEST_CONTRACT[2].sameWorkspaceCompletion,
      REQUEST_CONTRACT[3].sameWorkspaceCompletion,
    ]).toEqual(['stay', 'open', 'stay', 'open']);
    expect('sameWorkspaceCompletion' in REQUEST_CONTRACT[4]).toBe(false);
  });

  it('opens the requested supported kind', () => {
    renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));

    expect(screen.getByTestId('request-kind')).toHaveTextContent('project');
  });

  it('defaults the creation target to the shell workspace without rebinding the shell', async () => {
    renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));

    expect(screen.getByTestId('target-workspace')).toHaveTextContent(ALPHA_ID);
    await waitFor(() => {
      expect(screen.getByTestId('target-name')).toHaveTextContent('Alpha workspace');
    });
  });

  it('prefers an explicit initial destination over the shell workspace', async () => {
    renderProvider();

    fireEvent.click(screen.getByRole('button', { name: 'Open targeted project' }));

    expect(screen.getByTestId('target-workspace')).toHaveTextContent(BRAVO_ID);
    expect(screen.getByTestId('shell-workspace')).toHaveTextContent(ALPHA_ID);
    await waitFor(() => {
      expect(screen.getByTestId('target-name')).toHaveTextContent('Bravo workspace');
    });
  });

  it('waits for the resolved shell workspace before freezing an unresolved opening snapshot', async () => {
    renderDelayedProvider();

    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));
    expect(screen.getByTestId('target-workspace')).toHaveAttribute('data-workspace-id', '');
    expect(screen.getByTestId('initial-workspace')).toHaveAttribute('data-workspace-id', '');

    fireEvent.click(screen.getByRole('button', { name: 'Publish workspace memberships' }));
    expect(screen.getByTestId('shell-workspace')).toHaveAttribute('data-workspace-id', '');
    expect(screen.getByTestId('target-workspace')).toHaveAttribute('data-workspace-id', '');
    expect(screen.getByTestId('initial-workspace')).toHaveAttribute('data-workspace-id', '');

    fireEvent.click(screen.getByRole('button', { name: 'Resolve persisted Bravo workspace' }));
    await waitFor(() => {
      expect(screen.getByTestId('target-workspace')).toHaveAttribute('data-workspace-id', BRAVO_ID);
      expect(screen.getByTestId('initial-workspace')).toHaveAttribute(
        'data-workspace-id',
        BRAVO_ID,
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Navigate shell to Alpha workspace' }));
    expect(screen.getByTestId('shell-workspace')).toHaveAttribute('data-workspace-id', ALPHA_ID);
    expect(screen.getByTestId('target-workspace')).toHaveAttribute('data-workspace-id', BRAVO_ID);
    expect(screen.getByTestId('initial-workspace')).toHaveAttribute('data-workspace-id', BRAVO_ID);

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: ALPHA_ID },
    });

    expect(screen.getByTestId('target-workspace')).toHaveAttribute('data-workspace-id', ALPHA_ID);
    expect(screen.getByTestId('initial-workspace')).toHaveAttribute('data-workspace-id', BRAVO_ID);
  });

  it('freezes the delayed shell workspace without replacing a target selected during the gap', async () => {
    renderDelayedProvider();

    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish workspace memberships' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: ALPHA_ID },
    });

    await waitFor(() => {
      expect(screen.getByTestId('target-workspace')).toHaveAttribute('data-workspace-id', ALPHA_ID);
      expect(screen.getByTestId('target-state')).toHaveTextContent('settled');
      expect(screen.getByTestId('target-name')).toHaveTextContent('Alpha workspace');
    });
    expect(screen.getByTestId('initial-workspace')).toHaveAttribute('data-workspace-id', '');

    fireEvent.click(screen.getByRole('button', { name: 'Resolve persisted Bravo workspace' }));
    await waitFor(() => {
      expect(screen.getByTestId('initial-workspace')).toHaveAttribute(
        'data-workspace-id',
        BRAVO_ID,
      );
    });
    expect(screen.getByTestId('target-workspace')).toHaveAttribute('data-workspace-id', ALPHA_ID);

    fireEvent.click(screen.getByRole('button', { name: 'Navigate shell to Alpha workspace' }));
    expect(screen.getByTestId('initial-workspace')).toHaveAttribute('data-workspace-id', BRAVO_ID);
    expect(screen.getByTestId('target-workspace')).toHaveAttribute('data-workspace-id', ALPHA_ID);
  });

  it('switches among workspaces and resolves the selected target data and permissions', async () => {
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Open program' }));

    expect(screen.getByTestId('target-state')).toHaveTextContent('loading');
    await waitFor(() => {
      expect(screen.getByTestId('target-name')).toHaveTextContent('Alpha workspace');
      expect(screen.getByTestId('can-create')).toHaveTextContent('true');
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: BRAVO_ID },
    });

    expect(screen.getByTestId('target-workspace')).toHaveTextContent(BRAVO_ID);
    expect(screen.getByTestId('shell-workspace')).toHaveTextContent(ALPHA_ID);
    await waitFor(() => {
      expect(screen.getByTestId('target-name')).toHaveTextContent('Bravo workspace');
      expect(screen.getByTestId('target-vocabulary')).toHaveTextContent('Engagement');
      expect(screen.getByTestId('default-team')).toHaveTextContent(BRAVO_DEFAULT_TEAM_ID);
      expect(screen.getByTestId('can-create')).toHaveTextContent('false');
    });

    expect(orgGet).toHaveBeenCalledWith({ param: { orgId: BRAVO_ID } });
    expect(teamsGet).toHaveBeenCalledWith({ param: { orgId: BRAVO_ID } });
    expect(membersGet).toHaveBeenCalledWith({ param: { orgId: BRAVO_ID } });
    expect(rolesGet).toHaveBeenCalledWith({ param: { orgId: BRAVO_ID } });
  });

  it('keeps permission resolution loading until the signed-in identity resolves', async () => {
    sessionState.data = null;
    sessionState.isPending = true;
    const { rerenderProvider } = renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Open program' }));

    await waitFor(() => {
      expect(screen.getByTestId('target-state')).toHaveTextContent('settled');
    });
    expect(screen.getByTestId('permissions-loading')).toHaveTextContent('true');
    expect(screen.getByTestId('can-create')).toHaveTextContent('false');

    sessionState.data = { user: { id: 'user_1' } };
    sessionState.isPending = false;
    rerenderProvider();

    await waitFor(() => {
      expect(screen.getByTestId('permissions-loading')).toHaveTextContent('false');
      expect(screen.getByTestId('can-create')).toHaveTextContent('true');
    });
  });

  it('renders a static workspace label when there is only one destination', () => {
    renderProvider([ALPHA_WORKSPACE]);

    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));

    expect(screen.getByText('Workspace:')).toHaveClass('sr-only');
    expect(screen.getByText('Alpha workspace')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Workspace' })).not.toBeInTheDocument();
  });

  it('closes the active request and clears its destination', () => {
    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));

    fireEvent.click(screen.getByRole('button', { name: 'Close create' }));

    expect(screen.getByTestId('request-kind')).toHaveTextContent('closed');
    expect(screen.getByTestId('target-workspace')).toHaveTextContent('none');
    expect(screen.queryByRole('combobox', { name: 'Workspace' })).not.toBeInTheDocument();
  });
});

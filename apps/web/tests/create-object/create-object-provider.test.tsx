import '@testing-library/jest-dom/vitest';

import {
  ActorId,
  type MemberOut,
  type OrgOut,
  type OrgSummary,
  OrganizationId,
  RoleId,
  type RoleOut,
  TeamId,
  type TeamOut,
} from '@docket/types';
import { ContextProvider } from '@docket/ui/components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { membersGet, orgGet, rolesGet, teamsGet } = vi.hoisted(() => ({
  membersGet: vi.fn(),
  orgGet: vi.fn(),
  rolesGet: vi.fn(),
  teamsGet: vi.fn(),
}));

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
  useSession: () => ({ data: { user: { id: 'user_1' } } }),
}));

import { ActiveOrgContext } from '../../src/components/active-org';
import {
  CreateObjectProvider,
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

/** Expose the provider state through user-operable controls, including the workspace picker. */
function ProviderProbe(): JSX.Element {
  const { request, openCreate, closeCreate } = useCreateObject();
  const creation = useCreationContext();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          openCreate({ kind: 'project' });
        }}
      >
        Open project
      </button>
      <button
        type="button"
        onClick={() => {
          openCreate({ kind: 'program' });
        }}
      >
        Open program
      </button>
      <button type="button" onClick={closeCreate}>
        Close create
      </button>

      <output data-testid="request-kind">{request?.kind ?? 'closed'}</output>
      <output data-testid="target-workspace">{creation.targetWorkspaceId ?? 'none'}</output>
      <output data-testid="target-state">{creation.loading ? 'loading' : 'settled'}</output>
      <output data-testid="target-name">{creation.workspace?.name ?? 'none'}</output>
      <output data-testid="target-vocabulary">
        {creation.vocabulary?.overrides?.['project']?.singular ??
          creation.vocabulary?.preset ??
          'none'}
      </output>
      <output data-testid="default-team">{creation.defaultTeamId ?? 'none'}</output>
      <output data-testid="can-create">{String(creation.permissions.canCreate)}</output>
      {request ? <WorkspacePicker /> : null}
    </>
  );
}

/** Render the global provider in the same shell contexts it consumes in production. */
function renderProvider(workspaces: readonly OrgSummary[] = WORKSPACES): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={client}>
      <ContextProvider initialContext={ALPHA_ID}>
        <ActiveOrgContext orgs={workspaces} activeOrgId={null} orgsError={null}>
          <CreateObjectProvider>
            <ProviderProbe />
          </CreateObjectProvider>
        </ActiveOrgContext>
      </ContextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
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

  it('renders a static workspace label when there is only one destination', () => {
    renderProvider([ALPHA_WORKSPACE]);

    fireEvent.click(screen.getByRole('button', { name: 'Open project' }));

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

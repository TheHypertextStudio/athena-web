/** Behavior tests for legacy and shell-global Team creation. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { teamPost, creationState, createObjectState, routerPush } = vi.hoisted(() => {
  const creationState: { current: unknown } = { current: null };
  const createObjectState: { current: unknown } = { current: null };
  return {
    teamPost: vi.fn(),
    creationState,
    createObjectState,
    routerPush: vi.fn(),
  };
});

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          teams: { $post: teamPost },
        },
      },
    },
  },
}));

vi.mock('../../src/components/create-object/create-object-provider', () => ({
  useCreateObject: () => createObjectState.current,
}));

vi.mock('../../src/components/create-object/creation-context', () => ({
  useCreationContext: () => creationState.current,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { GlobalTeamComposer } from '../../src/components/teams/create-team';
import { queryKeys } from '../../src/lib/query';
import { firstJson, jsonResponse } from '../support/http';

const ORG_ID = '0RG00000000000000000000001';
const TARGET_ORG_ID = '0RG00000000000000000000002';

beforeEach(() => {
  teamPost.mockReset();
  createObjectState.current = {
    request: null,
    closeCreate: vi.fn(),
    openCreate: vi.fn(),
  };
  creationState.current = null;
  routerPush.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

/** Render a request-bound global Team composer with a locally switchable destination. */
function renderGlobalTeam({
  destination = {},
}: {
  readonly destination?: {
    readonly workspaceResolved?: boolean;
    readonly loading?: boolean;
    readonly loadError?: string | null;
    readonly canManage?: boolean;
    readonly permissionsLoading?: boolean;
  };
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const closeCreate = vi.fn();
  const onCreated = vi.fn();
  createObjectState.current = {
    request: { kind: 'team', initialWorkspaceId: ORG_ID, onCreated },
    closeCreate,
    openCreate: vi.fn(),
  };

  function Harness(): JSX.Element {
    const [targetWorkspaceId, setTargetWorkspaceId] = useState(ORG_ID);
    const targetIsOriginal = targetWorkspaceId === ORG_ID;
    creationState.current = {
      workspaces: [
        { id: ORG_ID, name: 'Alpha workspace', slug: 'alpha', avatar: null, isPersonal: true },
        {
          id: TARGET_ORG_ID,
          name: 'Bravo workspace',
          slug: 'bravo',
          avatar: null,
          isPersonal: false,
        },
      ],
      targetWorkspaceId,
      setTargetWorkspaceId,
      workspace:
        destination.workspaceResolved === false
          ? null
          : {
              id: targetWorkspaceId,
              name: targetIsOriginal ? 'Alpha workspace' : 'Bravo workspace',
              vocabulary: { preset: targetIsOriginal ? 'startup' : 'agency', overrides: {} },
            },
      teams: [],
      members: [],
      roles: [],
      vocabulary: { preset: targetIsOriginal ? 'startup' : 'agency', overrides: {} },
      defaultTeamId: null,
      permissions: {
        canContribute: true,
        canManage: destination.canManage ?? true,
        canCreate: destination.canManage ?? true,
        loading: destination.permissionsLoading ?? false,
      },
      loading: destination.loading ?? false,
      loadError: destination.loadError ?? null,
    };
    return <GlobalTeamComposer />;
  }

  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { client, closeCreate, onCreated };
}

describe('GlobalTeamComposer', () => {
  it('renders only Workspace above the title with no decorative separator', () => {
    renderGlobalTeam();

    const workspace = screen.getByRole('combobox', { name: 'Workspace' });
    const title = screen.getByLabelText('Team name');

    expect(
      workspace.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelectorAll('[data-testid="ChevronRightIcon"]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Template' })).toBeNull();
  });

  it('disables submission when the member cannot manage the destination workspace', () => {
    renderGlobalTeam({ destination: { canManage: false } });
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Blocked' } });

    expect(screen.getByRole('button', { name: 'Create team' })).toBeDisabled();
    expect(teamPost).not.toHaveBeenCalled();
  });

  it('retargets the POST while preserving every portable Team field', async () => {
    teamPost.mockResolvedValue(jsonResponse(true, { id: 'team_target', name: 'Delivery' }));
    const { client, closeCreate, onCreated } = renderGlobalTeam();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Delivery' } });
    fireEvent.change(screen.getByLabelText('Team key'), { target: { value: 'DLV' } });
    fireEvent.change(screen.getByLabelText('One-sentence summary'), {
      target: { value: 'Keep this summary.' },
    });
    const description = screen.getByLabelText('What does this team own? (optional)');
    await act(async () => {
      description.innerHTML = '<p>Keep this body.</p>';
      fireEvent.input(description);
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Triage queue' }));
    fireEvent.change(screen.getByLabelText('Agent guidance'), {
      target: { value: 'Preserve this guidance.' },
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: TARGET_ORG_ID },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create pod' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create pod' }));

    await waitFor(() => {
      expect(teamPost).toHaveBeenCalledTimes(1);
    });
    expect(teamPost).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: TARGET_ORG_ID } }),
    );
    expect(firstJson(teamPost.mock.calls)).toMatchObject({
      name: 'Delivery',
      key: 'DLV',
      summary: 'Keep this summary.',
      description: 'Keep this body.',
      triageEnabled: false,
      agentGuidance: 'Preserve this guidance.',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.teams(TARGET_ORG_ID) });
    expect(routerPush).toHaveBeenCalledWith(`/orgs/${TARGET_ORG_ID}/teams`);
    expect(closeCreate).toHaveBeenCalledOnce();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('notifies the opening workspace and still opens its Teams page after success', async () => {
    teamPost.mockResolvedValue(jsonResponse(true, { id: 'team_origin', name: 'Origin team' }));
    const { onCreated } = renderGlobalTeam();

    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Origin team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));

    await waitFor(() => {
      expect(teamPost).toHaveBeenCalledTimes(1);
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'team_origin' }));
    expect(routerPush).toHaveBeenCalledWith(`/orgs/${ORG_ID}/teams`);
  });
});

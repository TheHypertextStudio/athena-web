/** Behavior tests for legacy and shell-global Initiative creation. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  initiativePost,
  membersGet,
  agentsGet,
  templatesGet,
  creationState,
  createObjectState,
  sessionState,
  routerPush,
} = vi.hoisted(() => {
  const creationState: { current: unknown } = { current: null };
  const createObjectState: { current: unknown } = { current: null };
  return {
    initiativePost: vi.fn(),
    membersGet: vi.fn(),
    agentsGet: vi.fn(),
    templatesGet: vi.fn(),
    creationState,
    createObjectState,
    sessionState: { data: { user: { id: 'user_1' } }, isPending: false },
    routerPush: vi.fn(),
  };
});

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          initiatives: { $post: initiativePost },
          members: { $get: membersGet },
          agents: { $get: agentsGet },
          templates: { $get: templatesGet },
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

vi.mock('../../src/lib/auth-client', () => ({
  useSession: () => sessionState,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { GlobalInitiativeComposer } from '../../src/components/initiatives/create-initiative';
import { queryKeys } from '../../src/lib/query';
import { firstJson, jsonResponse } from '../support/http';

const ORG_ID = '0RG00000000000000000000001';
const OWNER_ID = 'ADA00000000000000000000002';
const TARGET_ORG_ID = '0RG00000000000000000000003';
const TARGET_OWNER_ID = 'GRC00000000000000000000004';

const MEMBERS = [
  {
    actorId: OWNER_ID,
    organizationId: ORG_ID,
    displayName: 'Ada Lovelace',
    avatar: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

beforeEach(() => {
  initiativePost.mockReset();
  membersGet.mockReset().mockResolvedValue(jsonResponse(true, { items: MEMBERS }));
  agentsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  templatesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  createObjectState.current = {
    request: null,
    closeCreate: vi.fn(),
    openCreate: vi.fn(),
  };
  creationState.current = null;
  routerPush.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

/** Render a request-bound global Initiative composer with a locally switchable destination. */
function renderGlobalInitiative({
  request = {},
  destination = {},
}: {
  readonly request?: Record<string, unknown>;
  readonly destination?: {
    readonly workspaceResolved?: boolean;
    readonly loading?: boolean;
    readonly loadError?: string | null;
    readonly canContribute?: boolean;
    readonly permissionsLoading?: boolean;
  };
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const closeCreate = vi.fn();
  const onCreated = vi.fn();
  createObjectState.current = {
    request: {
      kind: 'initiative',
      initialWorkspaceId: ORG_ID,
      sameWorkspaceCompletion: 'stay',
      onCreated,
      ...request,
    },
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
      members: [
        {
          actorId: targetIsOriginal ? OWNER_ID : TARGET_OWNER_ID,
          organizationId: targetWorkspaceId,
          displayName: targetIsOriginal ? 'Ada Lovelace' : 'Grace Hopper',
          userId: 'user_1',
        },
      ],
      roles: [],
      vocabulary: { preset: targetIsOriginal ? 'startup' : 'agency', overrides: {} },
      defaultTeamId: null,
      permissions: {
        canContribute: destination.canContribute ?? true,
        canManage: true,
        canCreate: destination.canContribute ?? true,
        loading: destination.permissionsLoading ?? false,
      },
      loading: destination.loading ?? false,
      loadError: destination.loadError ?? null,
    };
    return <GlobalInitiativeComposer />;
  }

  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { client, closeCreate, onCreated };
}

/** Make an Initiative template fixture for scope-filter behavior. */
function initiativeTemplate(
  name: string,
  scope: 'organization' | 'personal' | 'team',
  ownerActorId: string | null,
  teamId: string | null,
) {
  return {
    id: `${name.replaceAll(' ', '_')}_id`,
    organizationId: ORG_ID,
    targetType: 'initiative',
    name,
    description: null,
    scope,
    ownerActorId,
    teamId,
    payload: { targetType: 'initiative' },
    isSeed: false,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('GlobalInitiativeComposer', () => {
  it('renders Workspace, Owner, then Template above the title with no duplicate Owner', async () => {
    templatesGet.mockResolvedValue(
      jsonResponse(true, {
        items: [
          initiativeTemplate('My theme', 'personal', OWNER_ID, null),
          initiativeTemplate('Team theme', 'team', OWNER_ID, 'TEAM0000000000000000000005'),
        ],
      }),
    );
    renderGlobalInitiative();

    const workspace = screen.getByRole('combobox', { name: 'Workspace' });
    const owner = screen.getByRole('button', { name: /Owner/ });
    const template = await screen.findByRole('button', { name: 'Template' });
    const title = screen.getByLabelText('Initiative name');

    expect(
      workspace.compareDocumentPosition(owner) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(owner.compareDocumentPosition(template) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(template.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Owner/ })).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="ChevronRightIcon"]')).toHaveLength(2);

    fireEvent.pointerDown(template, { button: 0, ctrlKey: false });
    expect(await screen.findByText('My theme')).toBeVisible();
    expect(screen.queryByText('Team theme')).toBeNull();
  });

  it('disables submission when the member cannot contribute in the destination', () => {
    renderGlobalInitiative({ destination: { canContribute: false } });
    fireEvent.change(screen.getByLabelText('Initiative name'), { target: { value: 'Blocked' } });

    expect(screen.getByRole('button', { name: 'Create Initiative' })).toBeDisabled();
    expect(initiativePost).not.toHaveBeenCalled();
  });

  it('retargets the POST while preserving portable fields and clearing the prior owner', async () => {
    initiativePost.mockResolvedValue(
      jsonResponse(true, { id: 'initiative_target', name: 'Portable initiative' }),
    );
    const { client, closeCreate, onCreated } = renderGlobalInitiative();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await waitFor(() => {
      expect(membersGet).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByLabelText('Initiative name'), {
      target: { value: 'Portable initiative' },
    });
    fireEvent.change(screen.getByLabelText('One-sentence summary'), {
      target: { value: 'Keep this summary.' },
    });
    const description = screen.getByLabelText('Add a description…');
    await act(async () => {
      description.innerHTML = '<p>Keep this body.</p>';
      fireEvent.input(description);
    });
    fireEvent.click(screen.getByRole('button', { name: /Owner/ }));
    fireEvent.click(await screen.findByText('Ada Lovelace'));
    fireEvent.click(screen.getByRole('button', { name: 'Priority — No priority' }));
    fireEvent.click(await screen.findByText('High priority'));

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: TARGET_ORG_ID },
    });
    await waitFor(() => {
      expect(membersGet).toHaveBeenCalledWith({ param: { orgId: TARGET_ORG_ID } });
      expect(screen.getByRole('button', { name: 'Create Engagement' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Engagement' }));

    await waitFor(() => {
      expect(initiativePost).toHaveBeenCalledTimes(1);
    });
    expect(initiativePost).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: TARGET_ORG_ID } }),
    );
    const body = firstJson(initiativePost.mock.calls);
    expect(body).toMatchObject({
      name: 'Portable initiative',
      summary: 'Keep this summary.',
      description: 'Keep this body.',
      status: 'active',
      priority: 'high',
      updateCadence: 'monthly',
    });
    expect(body).not.toHaveProperty('ownerId');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.initiatives(TARGET_ORG_ID) });
    expect(routerPush).toHaveBeenCalledWith(`/orgs/${TARGET_ORG_ID}/initiatives/initiative_target`);
    expect(closeCreate).toHaveBeenCalledOnce();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

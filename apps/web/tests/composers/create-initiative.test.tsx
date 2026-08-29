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
  settingsGet,
  creationState,
  createObjectState,
  sessionState,
  routerPush,
  invalidateWorkTargetQueries,
} = vi.hoisted(() => {
  const creationState: { current: unknown } = { current: null };
  const createObjectState: { current: unknown } = { current: null };
  return {
    initiativePost: vi.fn(),
    membersGet: vi.fn(),
    agentsGet: vi.fn(),
    templatesGet: vi.fn(),
    settingsGet: vi.fn(),
    creationState,
    createObjectState,
    sessionState: { data: { user: { id: 'user_1' } }, isPending: false },
    routerPush: vi.fn(),
    invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
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
          settings: { 'work-structure': { $get: settingsGet } },
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

vi.mock('../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));

import { GlobalInitiativeComposer } from '../../src/components/initiatives/create-initiative';
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

interface InitiativeDestinationOverrides {
  readonly openingWorkspaceResolved?: boolean;
  readonly workspaceResolved?: boolean;
  readonly loading?: boolean;
  readonly loadError?: string | null;
  readonly canContribute?: boolean;
  readonly permissionsLoading?: boolean;
}

/** Destination states that must never enable an Initiative mutation. */
const BLOCKED_INITIATIVE_DESTINATIONS: readonly [string, InitiativeDestinationOverrides][] = [
  ['the opening workspace is unresolved', { openingWorkspaceResolved: false }],
  ['the target workspace is unresolved', { workspaceResolved: false }],
  ['target data is loading', { loading: true }],
  ['target data failed to load', { loadError: 'Application-owned load failure.' }],
  ['target permissions are unresolved', { permissionsLoading: true }],
  ['the member cannot contribute', { canContribute: false }],
];

beforeEach(() => {
  initiativePost.mockReset();
  membersGet.mockReset().mockResolvedValue(jsonResponse(true, { items: MEMBERS }));
  agentsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  templatesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  settingsGet.mockReset().mockResolvedValue(
    jsonResponse(true, {
      autoArchiveCompletedProjects: false,
      defaultProjectStatus: 'planned',
      fiscalYearStartMonth: 0,
    }),
  );
  createObjectState.current = {
    request: null,
    closeCreate: vi.fn(),
    openCreate: vi.fn(),
  };
  creationState.current = null;
  routerPush.mockReset();
  invalidateWorkTargetQueries.mockClear();
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
  readonly destination?: InitiativeDestinationOverrides;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const closeCreate = vi.fn();
  const onCreated = vi.fn();
  createObjectState.current = {
    request: {
      kind: 'initiative',
      initialWorkspaceId: destination.openingWorkspaceResolved === false ? null : ORG_ID,
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
  it('renders Workspace, Owner, then Start from template above the title with no duplicate Owner', async () => {
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
    const template = await screen.findByRole('button', { name: 'Start from template' });
    const title = screen.getByLabelText('Initiative name');

    expect(
      workspace.compareDocumentPosition(owner) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(owner.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(template) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Owner/ })).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="ChevronRightIcon"]')).toHaveLength(1);

    fireEvent.pointerDown(template, { button: 0, ctrlKey: false });
    expect(await screen.findByText('My theme')).toBeVisible();
    expect(screen.queryByText('Team theme')).toBeNull();
  });

  it.each(BLOCKED_INITIATIVE_DESTINATIONS)(
    'disables submission when %s',
    (_reason, destination) => {
      renderGlobalInitiative({ destination });
      fireEvent.change(screen.getByLabelText('Initiative name'), { target: { value: 'Blocked' } });

      expect(screen.getByRole('button', { name: 'Create Initiative' })).toBeDisabled();
      expect(initiativePost).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['stay', false],
    ['open', true],
  ] as const)(
    'notifies the opening workspace and honors same-workspace %s completion',
    async (sameWorkspaceCompletion, shouldRoute) => {
      initiativePost.mockResolvedValue(
        jsonResponse(true, { id: `initiative_${sameWorkspaceCompletion}`, name: 'Origin' }),
      );
      const { onCreated } = renderGlobalInitiative({ request: { sameWorkspaceCompletion } });

      fireEvent.change(screen.getByLabelText('Initiative name'), { target: { value: 'Origin' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Initiative' }));

      await waitFor(() => {
        expect(initiativePost).toHaveBeenCalledTimes(1);
      });
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: `initiative_${sameWorkspaceCompletion}` }),
      );
      if (shouldRoute) {
        expect(routerPush).toHaveBeenCalledWith(
          `/orgs/${ORG_ID}/initiatives/initiative_${sameWorkspaceCompletion}`,
        );
      } else {
        expect(routerPush).not.toHaveBeenCalled();
      }
    },
  );

  it('retargets the POST while preserving portable fields and clearing the prior owner', async () => {
    initiativePost.mockResolvedValue(
      jsonResponse(true, { id: 'initiative_target', name: 'Portable initiative' }),
    );
    const { client, closeCreate, onCreated } = renderGlobalInitiative();

    await waitFor(() => {
      expect(membersGet).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByLabelText('Initiative name'), {
      target: { value: 'Portable initiative' },
    });
    fireEvent.change(screen.getByLabelText('One-sentence summary'), {
      target: { value: 'Keep this summary.' },
    });
    const description = screen.getByLabelText('Add a description');
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
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'initiative',
      ownerOrganizationId: TARGET_ORG_ID,
    });
    expect(routerPush).toHaveBeenCalledWith(`/orgs/${TARGET_ORG_ID}/initiatives/initiative_target`);
    expect(closeCreate).toHaveBeenCalledOnce();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('continues with initiative properties retained while clearing its copy', async () => {
    initiativePost.mockResolvedValue(jsonResponse(true, { id: 'initiative_more', name: 'First' }));
    const { closeCreate, onCreated } = renderGlobalInitiative();

    fireEvent.change(screen.getByLabelText('Initiative name'), { target: { value: 'First' } });
    fireEvent.change(screen.getByLabelText('One-sentence summary'), {
      target: { value: 'Clear this.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Priority — No priority' }));
    fireEvent.click(await screen.findByText('High priority'));
    fireEvent.click(screen.getByRole('switch', { name: 'Create more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Initiative' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Initiative name')).toHaveValue('');
      expect(screen.getByLabelText('One-sentence summary')).toHaveValue('');
    });
    expect(screen.getByRole('button', { name: 'Priority — High priority' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Initiative created. Ready to create another.',
    );
    expect(routerPush).not.toHaveBeenCalled();
    expect(closeCreate).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it('sends a broad Initiative target with its canonical anchor and resolution', async () => {
    initiativePost.mockResolvedValue(
      jsonResponse(true, { id: 'initiative_timeframe', name: 'Timed initiative' }),
    );
    renderGlobalInitiative();

    await waitFor(() => {
      expect(settingsGet).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByLabelText('Initiative name'), {
      target: { value: 'Timed initiative' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Initiative target/ }));
    fireEvent.click(screen.getByRole('option', { name: 'December 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Initiative' }));

    await waitFor(() => {
      expect(initiativePost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(initiativePost.mock.calls)).toMatchObject({
      targetDate: '2026-12-31',
      targetDateResolution: 'month',
    });
  });

  it('does not allow a broad target while the workspace planning calendar is unavailable', async () => {
    settingsGet.mockResolvedValue(jsonResponse(false, { detail: 'Provider text.' }));
    renderGlobalInitiative();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load planning calendar settings.',
    );
    expect(screen.getByRole('button', { name: /Initiative target/ })).toBeDisabled();
    expect(screen.queryByText('Provider text.')).toBeNull();
  });
});

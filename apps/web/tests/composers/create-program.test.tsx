/**
 * Behavior tests for the program-create composer's visibility picker.
 *
 * @remarks
 * The properties panel on an existing program already explains what public/private *does*
 * (`@/components/pickers/options`'s `VISIBILITY_OPTIONS`), but the create composer used to
 * build its own bare `{ value, label }` pair with no supporting copy — the exact "two bare words"
 * gap the launch note named, just reachable from a different screen. These tests pin that the
 * create composer's Visibility picker uses the same explanatory options as the properties panel,
 * and that the chosen value still threads through to the create DTO.
 *
 * The RPC client is mocked; the actor roster (the only composer option this dialog loads) is fed
 * through the mocked `$get`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  programPost,
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
    programPost: vi.fn(),
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
          programs: { $post: programPost },
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

import {
  CreateProgramDialog,
  GlobalProgramComposer,
} from '../../src/components/programs/create-program';
import { queryKeys } from '../../src/lib/query';
import { firstJson, jsonResponse } from '../support/http';
import { choosePickerOption } from '../support/pickers';

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

interface ProgramDestinationOverrides {
  readonly openingWorkspaceResolved?: boolean;
  readonly workspaceResolved?: boolean;
  readonly loading?: boolean;
  readonly loadError?: string | null;
  readonly canManage?: boolean;
  readonly permissionsLoading?: boolean;
}

/** Destination states that must never enable a Program mutation. */
const BLOCKED_PROGRAM_DESTINATIONS: readonly [string, ProgramDestinationOverrides][] = [
  ['the opening workspace is unresolved', { openingWorkspaceResolved: false }],
  ['the target workspace is unresolved', { workspaceResolved: false }],
  ['target data is loading', { loading: true }],
  ['target data failed to load', { loadError: 'Application-owned load failure.' }],
  ['target permissions are unresolved', { permissionsLoading: true }],
  ['the member cannot manage', { canManage: false }],
];

beforeEach(() => {
  programPost.mockReset();
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

/** Render the composer open; returns the spy callbacks. */
function renderComposer() {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CreateProgramDialog
        orgId={ORG_ID}
        programNoun="Program"
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { onCreated, onOpenChange };
}

/** Render a request-bound global Program composer with a locally switchable destination. */
function renderGlobalProgram({
  request = {},
  destination = {},
}: {
  readonly request?: Record<string, unknown>;
  readonly destination?: ProgramDestinationOverrides;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const closeCreate = vi.fn();
  const onCreated = vi.fn();
  createObjectState.current = {
    request: {
      kind: 'program',
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
        canContribute: true,
        canManage: destination.canManage ?? true,
        canCreate: destination.canManage ?? true,
        loading: destination.permissionsLoading ?? false,
      },
      loading: destination.loading ?? false,
      loadError: destination.loadError ?? null,
    };
    return <GlobalProgramComposer />;
  }

  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { client, closeCreate, onCreated };
}

/** Make a Program template fixture for selected-person and no-team filtering. */
function programTemplate(
  name: string,
  scope: 'organization' | 'personal' | 'team',
  ownerActorId: string | null,
  teamId: string | null,
) {
  return {
    id: `${name.replaceAll(' ', '_')}_id`,
    organizationId: ORG_ID,
    targetType: 'program',
    name,
    description: null,
    scope,
    ownerActorId,
    teamId,
    payload: { targetType: 'program' },
    isSeed: false,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('CreateProgramDialog — visibility picker', () => {
  it('renders Workspace, Owner, then Start from template above the title without a duplicate Owner', async () => {
    templatesGet.mockResolvedValue(
      jsonResponse(true, {
        items: [
          programTemplate('My program', 'personal', OWNER_ID, null),
          programTemplate('Team program', 'team', OWNER_ID, 'TEAM0000000000000000000005'),
        ],
      }),
    );
    renderGlobalProgram();

    const workspace = screen.getByRole('combobox', { name: 'Workspace' });
    const owner = screen.getByRole('button', { name: /Owner/ });
    const template = await screen.findByRole('button', { name: 'Start from template' });
    const title = screen.getByLabelText('Program name');

    expect(
      workspace.compareDocumentPosition(owner) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(owner.compareDocumentPosition(template) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(template.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Owner/ })).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="ChevronRightIcon"]')).toHaveLength(2);

    fireEvent.pointerDown(template, { button: 0, ctrlKey: false });
    expect(await screen.findByText('My program')).toBeVisible();
    expect(screen.queryByText('Team program')).toBeNull();
  });

  it.each(BLOCKED_PROGRAM_DESTINATIONS)('disables submission when %s', (_reason, destination) => {
    renderGlobalProgram({ destination });
    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'Blocked' } });

    expect(screen.getByRole('button', { name: 'Create Program' })).toBeDisabled();
    expect(programPost).not.toHaveBeenCalled();
  });

  it.each([
    ['stay', false],
    ['open', true],
  ] as const)(
    'notifies the opening workspace and honors same-workspace %s completion',
    async (sameWorkspaceCompletion, shouldRoute) => {
      programPost.mockResolvedValue(
        jsonResponse(true, { id: `program_${sameWorkspaceCompletion}`, name: 'Origin' }),
      );
      const { onCreated } = renderGlobalProgram({ request: { sameWorkspaceCompletion } });

      fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'Origin' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create Program' }));

      await waitFor(() => {
        expect(programPost).toHaveBeenCalledTimes(1);
      });
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: `program_${sameWorkspaceCompletion}` }),
      );
      if (shouldRoute) {
        expect(routerPush).toHaveBeenCalledWith(
          `/orgs/${ORG_ID}/programs/program_${sameWorkspaceCompletion}`,
        );
      } else {
        expect(routerPush).not.toHaveBeenCalled();
      }
    },
  );

  it('retargets the POST while preserving portable fields and clearing the prior owner', async () => {
    programPost.mockResolvedValue(
      jsonResponse(true, { id: 'program_target', name: 'Portable program' }),
    );
    const { client, closeCreate, onCreated } = renderGlobalProgram();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await waitFor(() => {
      expect(membersGet).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByLabelText('Program name'), {
      target: { value: 'Portable program' },
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
    fireEvent.click(screen.getByRole('button', { name: 'Visibility — Public' }));
    choosePickerOption(/Private/);

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: TARGET_ORG_ID },
    });
    await waitFor(() => {
      expect(membersGet).toHaveBeenCalledWith({ param: { orgId: TARGET_ORG_ID } });
      expect(screen.getByRole('button', { name: 'Create Retainer' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Retainer' }));

    await waitFor(() => {
      expect(programPost).toHaveBeenCalledTimes(1);
    });
    expect(programPost).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: TARGET_ORG_ID } }),
    );
    const body = firstJson(programPost.mock.calls);
    expect(body).toMatchObject({
      name: 'Portable program',
      summary: 'Keep this summary.',
      description: 'Keep this body.',
      status: 'active',
      visibility: 'private',
    });
    expect(body).not.toHaveProperty('ownerId');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.programs(TARGET_ORG_ID) });
    expect(routerPush).toHaveBeenCalledWith(`/orgs/${TARGET_ORG_ID}/programs/program_target`);
    expect(closeCreate).toHaveBeenCalledOnce();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('explains each choice in the menu instead of offering two bare words', async () => {
    renderComposer();

    fireEvent.click(screen.getByRole('button', { name: /Visibility/ }));
    const list = await screen.findByRole('listbox');
    const options = within(list).getAllByRole('option');

    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Public');
    expect(options[0]).toHaveTextContent('Anyone in this workspace can find it in search.');
    expect(options[1]).toHaveTextContent('Private');
    expect(options[1]).toHaveTextContent('Kept out of search for anyone without access to it.');
  });

  it('defaults to public and threads a chosen visibility through the create DTO', async () => {
    programPost.mockResolvedValue(jsonResponse(true, { id: 'prog_1', name: 'Ops' }));
    const { onCreated } = renderComposer();

    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'Ops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Visibility — Public' }));
    choosePickerOption(/Private/);
    fireEvent.click(screen.getByRole('button', { name: 'Create Program' }));

    await waitFor(() => {
      expect(programPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(programPost.mock.calls)).toMatchObject({
      name: 'Ops',
      visibility: 'private',
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'prog_1' }));
  });

  it('continues with program properties retained while clearing its copy', async () => {
    programPost.mockResolvedValue(jsonResponse(true, { id: 'prog_more', name: 'First' }));
    const { onCreated, onOpenChange } = renderComposer();

    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'First' } });
    fireEvent.change(screen.getByLabelText('One-sentence summary'), {
      target: { value: 'Clear this.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Visibility — Public' }));
    choosePickerOption(/Private/);
    fireEvent.click(screen.getByRole('switch', { name: 'Create more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Program' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Program name')).toHaveValue('');
      expect(screen.getByLabelText('One-sentence summary')).toHaveValue('');
    });
    expect(screen.getByRole('button', { name: 'Visibility — Private' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Program created. Ready to create another.',
    );
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

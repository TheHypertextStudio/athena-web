/**
 * Behavior tests for the robust project-create composer.
 *
 * @remarks
 * A Project's create DTO accepts more than a name — a description, a lead, a team, a start→target
 * timeline, and the initiatives it advances. These tests pin that the composer threads those rich
 * fields through `projects.$post`:
 *
 * - the title + description flow through;
 * - choosing a lead and toggling an initiative thread their ids into the create body;
 * - a server error is surfaced and no `onCreated` fires.
 *
 * The RPC client is mocked; the lead + initiative rosters are fed through the mocked `$get`s.
 */
import { OrganizationId, TeamId, type TeamOut } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  projectPost,
  membersGet,
  agentsGet,
  initiativesGet,
  programsGet,
  templatesGet,
  settingsGet,
  creationState,
  createObjectState,
  sessionState,
  routerPush,
} = vi.hoisted(() => {
  const creationState: { current: unknown } = { current: null };
  const createObjectState: { current: unknown } = { current: null };
  return {
    projectPost: vi.fn(),
    membersGet: vi.fn(),
    agentsGet: vi.fn(),
    initiativesGet: vi.fn(),
    programsGet: vi.fn(),
    templatesGet: vi.fn(),
    settingsGet: vi.fn(),
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
          projects: { $post: projectPost },
          members: { $get: membersGet },
          agents: { $get: agentsGet },
          initiatives: { $get: initiativesGet },
          programs: { $get: programsGet },
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

import {
  CreateProjectDialog,
  GlobalProjectComposer,
} from '../../src/components/projects/create-project';
import { queryKeys } from '../../src/lib/query';
import { firstJson, jsonResponse } from '../support/http';

// Valid ULID-shaped ids (no I/L/O/U) so the composer's `*.parse(...)` guards accept them.
const ORG_ID = '0RG00000000000000000000001';
const TEAM_ID = 'TEAM0000000000000000000002';
const GRACE_ID = 'GRC00000000000000000000003';
const Q3_ID = 'Q3000000000000000000000004';
const PROGRAM_ID = 'PR0GRAM0000000000000000005';
const TARGET_ORG_ID = '0RG00000000000000000000006';
const TARGET_TEAM_ID = 'TEAM0000000000000000000007';
const TARGET_ACTOR_ID = 'ADA00000000000000000000008';
const SECOND_TEAM_ID = 'TEAM0000000000000000000009';
const TARGET_SECOND_TEAM_ID = 'TEAM0000000000000000000010';
const TARGET_PROGRAM_ID = 'PR0GRAM0000000000000000011';
const TARGET_INITIATIVE_ID = 'Q3000000000000000000000012';

/** The single (implicit) team the composer creates projects in. */
const TEAMS: readonly TeamOut[] = [
  {
    id: TeamId.parse(TEAM_ID),
    organizationId: OrganizationId.parse(ORG_ID),
    name: 'General',
    key: 'GEN',
    summary: null,
    triageEnabled: true,
  },
];

// Fixtures are fed through the mocked `$get().json()` (typed `unknown`), so plain shapes suffice.
const MEMBERS = [
  {
    actorId: GRACE_ID,
    organizationId: ORG_ID,
    displayName: 'Grace Hopper',
    avatar: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

const TARGET_MEMBERS = [
  {
    actorId: TARGET_ACTOR_ID,
    organizationId: TARGET_ORG_ID,
    displayName: 'Target Lead',
    avatar: null,
    status: 'active',
    createdAt: '2026-01-02T00:00:00Z',
  },
];

const INITIATIVES = [
  {
    id: Q3_ID,
    organizationId: ORG_ID,
    name: 'Q3 Reliability',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

const TARGET_INITIATIVES = [
  {
    id: TARGET_INITIATIVE_ID,
    organizationId: TARGET_ORG_ID,
    name: 'Delivery initiative',
    status: 'active',
    createdAt: '2026-01-02T00:00:00Z',
  },
];

const PROGRAMS = [
  {
    id: PROGRAM_ID,
    organizationId: ORG_ID,
    name: 'Platform program',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

const TARGET_PROGRAMS = [
  {
    id: TARGET_PROGRAM_ID,
    organizationId: TARGET_ORG_ID,
    name: 'Delivery program',
    status: 'active',
    createdAt: '2026-01-02T00:00:00Z',
  },
];

const TARGET_TEAMS: readonly TeamOut[] = [
  {
    id: TeamId.parse(TARGET_TEAM_ID),
    organizationId: OrganizationId.parse(TARGET_ORG_ID),
    name: 'Delivery',
    key: 'DEL',
    summary: null,
    triageEnabled: true,
  },
  {
    id: TeamId.parse(TARGET_SECOND_TEAM_ID),
    organizationId: OrganizationId.parse(TARGET_ORG_ID),
    name: 'Operations',
    key: 'OPS',
    summary: null,
    triageEnabled: true,
  },
];

const GLOBAL_PROJECT_TEAMS: readonly TeamOut[] = [
  ...TEAMS,
  {
    id: TeamId.parse(SECOND_TEAM_ID),
    organizationId: OrganizationId.parse(ORG_ID),
    name: 'Platform',
    key: 'PLT',
    summary: null,
    triageEnabled: true,
  },
];

beforeEach(() => {
  projectPost.mockReset();
  membersGet
    .mockReset()
    .mockImplementation(({ param }: { param: { orgId: string } }) =>
      jsonResponse(true, { items: param.orgId === TARGET_ORG_ID ? TARGET_MEMBERS : MEMBERS }),
    );
  agentsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  initiativesGet.mockReset().mockImplementation(({ param }: { param: { orgId: string } }) =>
    jsonResponse(true, {
      items: param.orgId === TARGET_ORG_ID ? TARGET_INITIATIVES : INITIATIVES,
    }),
  );
  programsGet
    .mockReset()
    .mockImplementation(({ param }: { param: { orgId: string } }) =>
      jsonResponse(true, { items: param.orgId === TARGET_ORG_ID ? TARGET_PROGRAMS : PROGRAMS }),
    );
  templatesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  settingsGet.mockReset().mockResolvedValue(
    jsonResponse(true, {
      initiativeMaxDepth: 2,
      estimationScale: 'fibonacci',
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
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Render the composer open with the standard rosters; returns the spy callbacks. */
function renderComposer(onCreated = vi.fn()) {
  const onOpenChange = vi.fn();
  // The composer reads its option rosters through the shared useApiQuery layer, so it must run
  // under a QueryClientProvider (as it does in the app via providers.tsx). Retry-free for tests.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CreateProjectDialog
        orgId={ORG_ID}
        projectNoun="Project"
        teams={TEAMS}
        defaultTeamId={TEAM_ID}
        teamsLoading={false}
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { onCreated, onOpenChange };
}

interface ProjectDestinationOverrides {
  readonly openingWorkspaceResolved?: boolean;
  readonly workspaceResolved?: boolean;
  readonly loading?: boolean;
  readonly loadError?: string | null;
  readonly canContribute?: boolean;
  readonly permissionsLoading?: boolean;
}

/** Destination states that must never enable a Project mutation. */
const BLOCKED_PROJECT_DESTINATIONS: readonly [string, ProjectDestinationOverrides][] = [
  ['the opening workspace is unresolved', { openingWorkspaceResolved: false }],
  ['the target workspace is unresolved', { workspaceResolved: false }],
  ['target data is loading', { loading: true }],
  ['target data failed to load', { loadError: 'Application-owned load failure.' }],
  ['target permissions are unresolved', { permissionsLoading: true }],
  ['the member cannot contribute', { canContribute: false }],
];

/** Render the global Project host with a destination that can be changed without moving the page. */
function renderGlobalProject({
  request = {},
  delayedOpening = false,
  destination = {},
}: {
  readonly request?: Record<string, unknown>;
  readonly delayedOpening?: boolean;
  readonly destination?: ProjectDestinationOverrides;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const closeCreate = vi.fn();
  const onCreated = vi.fn();
  const requestedInitialWorkspaceId =
    'initialWorkspaceId' in request ? (request['initialWorkspaceId'] as string | null) : ORG_ID;

  function Harness(): JSX.Element {
    const [initialWorkspaceId, setInitialWorkspaceId] = useState<string | null>(
      delayedOpening || destination.openingWorkspaceResolved === false
        ? null
        : requestedInitialWorkspaceId,
    );
    const [targetWorkspaceId, setTargetWorkspaceId] = useState(
      delayedOpening ? TARGET_ORG_ID : ORG_ID,
    );
    const targetIsOriginal = targetWorkspaceId === ORG_ID;
    const targetTeams = targetIsOriginal ? GLOBAL_PROJECT_TEAMS : TARGET_TEAMS;
    createObjectState.current = {
      request: {
        kind: 'project',
        sameWorkspaceCompletion: 'stay',
        onCreated,
        ...request,
        initialWorkspaceId,
      },
      closeCreate,
      openCreate: vi.fn(),
    };
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
      teams: targetTeams,
      members: [
        {
          actorId: targetIsOriginal ? GRACE_ID : TARGET_ACTOR_ID,
          organizationId: targetWorkspaceId,
          displayName: targetIsOriginal ? 'Grace Hopper' : 'Ada Lovelace',
          userId: 'user_1',
        },
      ],
      roles: [],
      vocabulary: { preset: targetIsOriginal ? 'startup' : 'agency', overrides: {} },
      defaultTeamId: targetTeams[0]?.id ?? null,
      permissions: {
        canContribute: destination.canContribute ?? true,
        canManage: true,
        canCreate: destination.canContribute ?? true,
        loading: destination.permissionsLoading ?? false,
      },
      loading: destination.loading ?? false,
      loadError: destination.loadError ?? null,
    };
    return (
      <>
        {delayedOpening ? (
          <button
            type="button"
            onClick={() => {
              setInitialWorkspaceId(ORG_ID);
            }}
          >
            Freeze opening workspace
          </button>
        ) : null}
        <GlobalProjectComposer />
      </>
    );
  }

  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { client, closeCreate, onCreated };
}

/** Resolve a provider-delayed opening workspace without changing the intended destination. */
function renderDelayedOpeningProject() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Harness(): JSX.Element {
    const [resolved, setResolved] = useState(false);
    creationState.current = {
      workspaces: [
        { id: ORG_ID, name: 'Alpha workspace', slug: 'alpha', avatar: null, isPersonal: true },
      ],
      targetWorkspaceId: resolved ? ORG_ID : null,
      setTargetWorkspaceId: vi.fn(),
      workspace: resolved
        ? {
            id: ORG_ID,
            name: 'Alpha workspace',
            vocabulary: { preset: 'startup', overrides: {} },
          }
        : null,
      teams: GLOBAL_PROJECT_TEAMS,
      members: [],
      roles: [],
      vocabulary: { preset: 'startup', overrides: {} },
      defaultTeamId: TEAM_ID,
      permissions: {
        canContribute: true,
        canManage: true,
        canCreate: true,
        loading: !resolved,
      },
      loading: !resolved,
      loadError: null,
    };

    return (
      <>
        <button
          type="button"
          onClick={() => {
            setResolved(true);
          }}
        >
          Resolve opening workspace
        </button>
        <CreateProjectDialog
          orgId={ORG_ID}
          projectNoun="Project"
          teams={GLOBAL_PROJECT_TEAMS}
          defaultTeamId={TEAM_ID}
          teamsLoading={!resolved}
          defaultProgramId={PROGRAM_ID}
          open
          onOpenChange={() => undefined}
          onCreated={() => undefined}
          globalCreation={{
            targetWorkspaceId: resolved ? ORG_ID : null,
            initialWorkspaceId: resolved ? ORG_ID : null,
            ready: resolved,
            loadError: null,
            canContribute: true,
            currentActorId: null,
            onCreated: () => undefined,
          }}
        />
      </>
    );
  }

  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

/** Make a project template fixture without coupling these tests to transport parsing. */
function projectTemplate(
  name: string,
  scope: 'organization' | 'personal' | 'team',
  ownerActorId: string | null,
  teamId: string | null,
) {
  return {
    id: `${name.replaceAll(' ', '_')}_id`,
    organizationId: ORG_ID,
    targetType: 'project',
    name,
    description: null,
    scope,
    ownerActorId,
    teamId,
    payload: { targetType: 'project' },
    isSeed: false,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('CreateProjectDialog — robust composer', () => {
  it('keeps properties on one measured row and moves later controls into More', async () => {
    let propertiesResize: ResizeObserverCallback | undefined;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const priority = this.getAttribute('data-entity-metadata-priority');
      const width = priority === null ? 0 : 80;
      return {
        x: 0,
        y: 0,
        top: 0,
        right: width,
        bottom: 28,
        left: 0,
        width,
        height: 28,
        toJSON: () => ({}),
      };
    });
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        constructor(readonly callback: ResizeObserverCallback) {}

        observe(target: Element): void {
          if (target.getAttribute('aria-label') === 'Project properties') {
            propertiesResize = this.callback;
          }
        }
        unobserve(): void {
          return undefined;
        }
        disconnect(): void {
          return undefined;
        }
      },
    );
    templatesGet.mockResolvedValue(
      jsonResponse(true, {
        items: [projectTemplate('General project', 'team', GRACE_ID, TEAM_ID)],
      }),
    );
    renderGlobalProject();

    const workspace = screen.getByRole('combobox', { name: 'Workspace' });
    const program = screen.getByRole('button', { name: /Program/ });
    const template = await screen.findByRole('button', { name: 'Start from template' });
    const title = screen.getByLabelText('Project name');

    expect(
      workspace.compareDocumentPosition(program) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(program.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(template) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Program/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Team/ })).toBeVisible();
    expect(document.querySelectorAll('[data-testid="ChevronRightIcon"]')).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Composer context' })).toHaveClass('flex-nowrap');
    expect(template).toHaveClass('h-8', 'rounded-full', 'border');

    fireEvent.pointerDown(template);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'General project' })).toBeVisible();
    expect(within(menu).queryByText('Workspace')).not.toBeInTheDocument();
    expect(within(menu).queryByText('Team')).not.toBeInTheDocument();
    fireEvent.keyDown(menu, { key: 'Escape' });

    const properties = screen.getByRole('group', { name: 'Project properties' });
    expect(properties).toHaveClass('flex-nowrap');
    expect(propertiesResize).toBeDefined();
    act(() => {
      propertiesResize?.(
        [{ contentRect: { width: 180 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'More Project properties' }));
    const overflow = await screen.findByRole('group', { name: 'More Project properties' });
    expect(within(overflow).getByRole('group', { name: 'Timeline' })).toBeVisible();

    act(() => {
      propertiesResize?.(
        [{ contentRect: { width: 1_000 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
    });

    expect(
      screen.queryByRole('button', { name: 'More Project properties' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Program/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Start from template' })).toBeVisible();
    expect(within(properties).getByRole('group', { name: 'Timeline' })).toBeVisible();
  });

  it.each(BLOCKED_PROJECT_DESTINATIONS)('disables submission when %s', (_reason, destination) => {
    renderGlobalProject({ destination });

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Blocked' } });

    expect(screen.getByRole('button', { name: 'Create Project' })).toBeDisabled();
    expect(projectPost).not.toHaveBeenCalled();
  });

  it('preserves an opening Program default when the delayed shell workspace resolves', async () => {
    projectPost.mockResolvedValue(
      jsonResponse(true, { id: 'project_delayed', name: 'Delayed project' }),
    );
    renderDelayedOpeningProject();

    fireEvent.click(screen.getByText('Resolve opening workspace'));
    await waitFor(() => {
      expect(programsGet).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Program — Platform program/ })).toBeVisible();
    });
    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Delayed project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(projectPost.mock.calls)).toMatchObject({ programId: PROGRAM_ID });
  });

  it('keeps a ready selected target blocked until the opening workspace freezes', async () => {
    projectPost.mockResolvedValue(
      jsonResponse(true, { id: 'project_delayed_cross', name: 'Delayed project' }),
    );
    const { onCreated } = renderGlobalProject({ delayedOpening: true });

    expect(screen.getByRole('combobox', { name: 'Workspace' })).toHaveValue(TARGET_ORG_ID);
    fireEvent.change(screen.getByLabelText(/^(Project|Engagement) name$/), {
      target: { value: 'Delayed project' },
    });
    expect(screen.getByRole('button', { name: /^Create (Project|Engagement)$/ })).toBeDisabled();
    expect(projectPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Freeze opening workspace'));
    await waitFor(() => {
      expect(programsGet).toHaveBeenCalledWith(
        expect.objectContaining({ param: { orgId: TARGET_ORG_ID } }),
      );
      expect(screen.getByRole('button', { name: /^Create (Project|Engagement)$/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /^Create (Project|Engagement)$/ }));

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith(
        `/orgs/${TARGET_ORG_ID}/projects/project_delayed_cross`,
      );
    });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('clears destination references again after a round trip to the opening workspace', async () => {
    projectPost.mockResolvedValue(
      jsonResponse(true, { id: 'project_round_trip', name: 'Round trip' }),
    );
    renderGlobalProject();

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: TARGET_ORG_ID },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Team — currently Delivery/ })).toBeVisible();
      expect(programsGet).toHaveBeenCalledWith(
        expect.objectContaining({ param: { orgId: TARGET_ORG_ID } }),
      );
    });
    fireEvent.change(screen.getByLabelText(/^(Project|Engagement) name$/), {
      target: { value: 'Round trip' },
    });
    fireEvent.pointerDown(screen.getByRole('button', { name: /Team — currently Delivery/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByText('Operations'));
    fireEvent.click(screen.getByRole('button', { name: /Lead/ }));
    fireEvent.click(await screen.findByText('Target Lead'));
    fireEvent.click(screen.getByRole('button', { name: /^(Program|Retainer) —/ }));
    fireEvent.click(await screen.findByText('Delivery program'));
    const initiatives = screen.getByRole('button', { name: /^(Initiatives|Engagements) —/ });
    fireEvent.click(initiatives);
    fireEvent.click(await screen.findByText('Delivery initiative'));
    fireEvent.click(initiatives);

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: ORG_ID },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Create Project' })).toBeEnabled();
      expect(programsGet).toHaveBeenCalledWith(
        expect.objectContaining({ param: { orgId: ORG_ID } }),
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    const body = firstJson(projectPost.mock.calls);
    expect(body).toMatchObject({ name: 'Round trip', teamId: TEAM_ID });
    expect(body).not.toHaveProperty('leadId');
    expect(body).not.toHaveProperty('programId');
    expect(body).not.toHaveProperty('initiativeIds');
    expect(body['teamId']).not.toBe(TARGET_SECOND_TEAM_ID);
  });

  it('invalidates the independent portfolio for same-workspace stay success', async () => {
    projectPost.mockResolvedValue(jsonResponse(true, { id: 'project_stay', name: 'Stay' }));
    const { client, onCreated } = renderGlobalProject();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Stay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects(ORG_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.portfolio() });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'project_stay' }));
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('posts portable content to the selected workspace and clears all prior workspace references', async () => {
    projectPost.mockResolvedValue(
      jsonResponse(true, { id: 'project_target', name: 'Portable project' }),
    );
    const { client, closeCreate, onCreated } = renderGlobalProject({
      request: { defaultProgramId: PROGRAM_ID },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await waitFor(() => {
      expect(membersGet).toHaveBeenCalled();
      expect(initiativesGet).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByLabelText('Project name'), {
      target: { value: 'Portable project' },
    });
    fireEvent.change(screen.getByLabelText('One-sentence summary'), {
      target: { value: 'Keep the portable summary.' },
    });
    const description = screen.getByLabelText('Add a description');
    await act(async () => {
      description.innerHTML = '<p>Keep the portable body.</p>';
      fireEvent.input(description);
    });
    fireEvent.click(screen.getByRole('button', { name: /Lead/ }));
    fireEvent.click(await screen.findByText('Grace Hopper'));
    const initiatives = screen.getByRole('button', { name: /Initiatives/ });
    fireEvent.click(initiatives);
    fireEvent.click(await screen.findByText('Q3 Reliability'));
    fireEvent.click(initiatives);

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: TARGET_ORG_ID },
    });

    await waitFor(() => {
      expect(programsGet).toHaveBeenCalledWith(
        expect.objectContaining({ param: { orgId: TARGET_ORG_ID } }),
      );
      expect(screen.getByRole('button', { name: 'Create Project' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    expect(projectPost).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: TARGET_ORG_ID } }),
    );
    const body = firstJson(projectPost.mock.calls);
    expect(body).toMatchObject({
      name: 'Portable project',
      summary: 'Keep the portable summary.',
      description: 'Keep the portable body.',
      teamId: TARGET_TEAM_ID,
      status: 'planned',
    });
    expect(body).not.toHaveProperty('leadId');
    expect(body).not.toHaveProperty('programId');
    expect(body).not.toHaveProperty('initiativeIds');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects(TARGET_ORG_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.portfolio() });
    expect(routerPush).toHaveBeenCalledWith(`/orgs/${TARGET_ORG_ID}/projects/project_target`);
    expect(closeCreate).toHaveBeenCalledOnce();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('sends the title, description, and default team through the create DTO', async () => {
    projectPost.mockResolvedValue(jsonResponse(true, { id: 'proj_1', name: 'Atlas' }));
    const { onCreated } = renderComposer();

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Atlas' } });
    const description = screen.getByLabelText('Add a description');
    // Tiptap observes the contenteditable DOM; act flushes that observer before form submission.
    await act(async () => {
      description.innerHTML = '<p>Re-platform.</p>';
      fireEvent.input(description);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(projectPost.mock.calls)).toMatchObject({
      name: 'Atlas',
      description: 'Re-platform.',
      teamId: TEAM_ID,
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'proj_1' }));
  });

  it('sends broad Project start and target resolutions with their canonical anchors', async () => {
    projectPost.mockResolvedValue(jsonResponse(true, { id: 'proj_timeframe', name: 'Timed' }));
    renderComposer();

    await waitFor(() => {
      expect(settingsGet).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Timed' } });
    fireEvent.click(screen.getByRole('button', { name: /Project start/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Quarter' }));
    fireEvent.click(screen.getByRole('option', { name: 'Q3 2026' }));
    fireEvent.click(screen.getByRole('button', { name: /Project target/ }));
    fireEvent.click(screen.getByRole('option', { name: 'December 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(projectPost.mock.calls)).toMatchObject({
      startDate: '2026-07-01',
      startDateResolution: 'quarter',
      targetDate: '2026-12-31',
      targetDateResolution: 'month',
    });
  });

  it('threads a chosen lead through the create DTO', async () => {
    projectPost.mockResolvedValue(jsonResponse(true, { id: 'proj_2', name: 'Led' }));
    renderComposer();

    await waitFor(() => {
      expect(membersGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Led' } });
    fireEvent.click(screen.getByRole('button', { name: /Lead/ }));
    fireEvent.click(await screen.findByText('Grace Hopper'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(projectPost.mock.calls)).toMatchObject({ name: 'Led', leadId: GRACE_ID });
  });

  it('threads a toggled initiative through the create DTO', async () => {
    projectPost.mockResolvedValue(jsonResponse(true, { id: 'proj_3', name: 'Linked' }));
    renderComposer();

    await waitFor(() => {
      expect(initiativesGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Linked' } });
    // Initiatives use the multi-select picker: open, toggle, then re-click the trigger to close.
    const initiativesTrigger = screen.getByRole('button', { name: /Initiatives/ });
    fireEvent.click(initiativesTrigger);
    fireEvent.click(await screen.findByText('Q3 Reliability'));
    fireEvent.click(initiativesTrigger);

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(projectPost.mock.calls)).toMatchObject({
      name: 'Linked',
      initiativeIds: [Q3_ID],
    });
  });

  it('continues with relationships retained while clearing only project copy', async () => {
    projectPost.mockResolvedValue(jsonResponse(true, { id: 'proj_more', name: 'First' }));
    const onCreated = vi.fn(() => {
      throw new Error('page roster update failed');
    });
    const { onOpenChange } = renderComposer(onCreated);

    await waitFor(() => {
      expect(membersGet).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'First' } });
    fireEvent.change(screen.getByLabelText('One-sentence summary'), {
      target: { value: 'Clear this summary.' },
    });
    const description = screen.getByLabelText('Add a description');
    await act(async () => {
      description.innerHTML = '<p>Clear this description.</p>';
      fireEvent.input(description);
    });
    fireEvent.click(screen.getByRole('button', { name: /Lead/ }));
    fireEvent.click(await screen.findByText('Grace Hopper'));
    fireEvent.click(screen.getByRole('switch', { name: 'Create more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Project name')).toHaveValue('');
      expect(screen.getByLabelText('One-sentence summary')).toHaveValue('');
      expect(screen.getByLabelText('Add a description')).toHaveTextContent('');
    });
    expect(screen.getByRole('button', { name: /Lead — Grace Hopper/ })).toBeVisible();
    expect(firstJson(projectPost.mock.calls)).toMatchObject({ teamId: TEAM_ID, leadId: GRACE_ID });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Project created. Ready to create another.',
    );
    await waitFor(() => {
      expect(screen.getByLabelText('Project name')).toHaveFocus();
    });
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('surfaces application-owned copy when the create fails', async () => {
    projectPost.mockResolvedValue(jsonResponse(false, { detail: 'Name already used.' }));
    const { onCreated } = renderComposer();

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Could not create the project.')).toBeTruthy();
    expect(within(alert).queryByText('Name already used.')).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Project name')).toHaveValue('Dup');
  });
});

/**
 * Behavior tests for the robust task-create composer.
 *
 * @remarks
 * The directive's promise: the create modal is a Linear-grade composer, not a single name field —
 * a title + description body plus an inline strip of property pickers, all wired through the real
 * `TaskCreate` DTO. These tests pin that contract by driving the composer and asserting the shape
 * of the `tasks.$post` body it sends:
 *
 * - the title + description flow through, and a sensible default priority is always present;
 * - opening the assignee / project / label pickers and choosing options threads those ids into the
 *   create body (proving the pickers are wired, not decorative);
 * - the busy/disabled rules hold (no double-submit, no empty-title submit).
 *
 * The RPC client is mocked so the flow is asserted without a live API. The option rosters are fed
 * through the mocked `$get`s; the per-team workflow read seeds the status default.
 */
import { OrganizationId, TeamId, type TeamOut } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type JSX, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the mock factory (lifted above imports) can reference them.
const {
  taskPost,
  recurringTaskPost,
  membersGet,
  agentsGet,
  projectsGet,
  cyclesGet,
  labelsGet,
  milestonesGet,
  teamGet,
  templatesGet,
  workStructureGet,
  creationState,
  createObjectState,
  sessionState,
  routerPush,
} = vi.hoisted(() => {
  const creationState: { current: unknown } = { current: null };
  const createObjectState: { current: unknown } = { current: null };
  const sessionState: { data: { user: { id: string } } | null; isPending: boolean } = {
    data: { user: { id: 'user_1' } },
    isPending: false,
  };
  return {
    taskPost: vi.fn(),
    recurringTaskPost: vi.fn(),
    membersGet: vi.fn(),
    agentsGet: vi.fn(),
    projectsGet: vi.fn(),
    cyclesGet: vi.fn(),
    labelsGet: vi.fn(),
    milestonesGet: vi.fn(),
    teamGet: vi.fn(),
    templatesGet: vi.fn(),
    workStructureGet: vi.fn(),
    creationState,
    createObjectState,
    sessionState,
    routerPush: vi.fn(),
  };
});

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          tasks: { $post: taskPost },
          'recurring-tasks': { $post: recurringTaskPost },
          members: { $get: membersGet },
          agents: { $get: agentsGet },
          projects: { $get: projectsGet },
          cycles: { $get: cyclesGet },
          labels: { $get: labelsGet },
          milestones: { $get: milestonesGet },
          templates: { $get: templatesGet },
          settings: { 'work-structure': { $get: workStructureGet } },
          teams: { ':teamId': { $get: teamGet } },
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

import { CreateTaskDialog, GlobalTaskComposer } from '../../src/components/tasks/create-task';
import { UserFacingError } from '../../src/lib/problem';
import { queryKeys } from '../../src/lib/query';
import { firstJson, jsonResponse } from '../support/http';

// Branded ids (ActorId / ProjectId / TeamId / LabelId) are ULIDs, so the composer's `*.parse(...)`
// guards only accept the canonical 26-char Crockford-base32 shape. Use valid ULIDs throughout.
const ORG_ID = '0RG00000000000000000000001';
const TEAM_ID = 'TEAM0000000000000000000002';
const ADA_ID = 'ADA00000000000000000000003';
const APOLLO_ID = 'APR00000000000000000000004';
const BUG_ID = 'BG000000000000000000000005';
const TARGET_ORG_ID = '0RG00000000000000000000006';
const TARGET_TEAM_ID = 'TEAM0000000000000000000007';
const SECOND_TEAM_ID = 'TEAM0000000000000000000008';
const CYCLE_ID = 'CYC1E000000000000000000009';
const MILESTONE_ID = 'MILESTONE000000000000000010';

/** The single (implicit) team the composer creates tasks in. */
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
/** The org members fed into the assignee picker. */
const MEMBERS = [
  {
    actorId: ADA_ID,
    organizationId: ORG_ID,
    displayName: 'Ada Lovelace',
    avatar: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

/** The org projects fed into the project picker. */
const PROJECTS = [
  {
    id: APOLLO_ID,
    organizationId: ORG_ID,
    name: 'Apollo',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

/** The org labels fed into the labels picker. */
const LABELS = [
  {
    id: BUG_ID,
    organizationId: ORG_ID,
    name: 'Bug',
    color: '#ef4444',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

/** The cycle and milestone choices used to prove a workspace switch clears foreign ids. */
const CYCLES = [{ id: CYCLE_ID, teamId: TEAM_ID, displayName: 'Cycle 1' }];
const MILESTONES = [{ id: MILESTONE_ID, projectId: APOLLO_ID, name: 'Launch' }];

const GLOBAL_TEAMS: readonly TeamOut[] = [
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

const TARGET_TEAMS: readonly TeamOut[] = [
  {
    id: TeamId.parse(TARGET_TEAM_ID),
    organizationId: OrganizationId.parse(TARGET_ORG_ID),
    name: 'Delivery',
    key: 'DEL',
    summary: null,
    triageEnabled: true,
  },
];

/** No agents in these scenarios. */
const AGENTS: unknown[] = [];

beforeEach(() => {
  taskPost.mockReset();
  recurringTaskPost.mockReset();
  membersGet.mockReset().mockResolvedValue(jsonResponse(true, { items: MEMBERS }));
  agentsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: AGENTS }));
  projectsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: PROJECTS }));
  cyclesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: CYCLES }));
  labelsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: LABELS }));
  milestonesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: MILESTONES }));
  templatesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  workStructureGet.mockReset().mockResolvedValue(jsonResponse(true, { estimationScale: 'none' }));
  teamGet.mockReset().mockResolvedValue(
    jsonResponse(true, {
      workflowStates: [
        { key: 'backlog', name: 'Backlog', type: 'backlog', position: 0 },
        { key: 'todo', name: 'Todo', type: 'unstarted', position: 1 },
      ],
    }),
  );
  teamGet.mockImplementation(({ param }: { param: { teamId: string } }) =>
    jsonResponse(true, {
      workflowStates:
        param.teamId === SECOND_TEAM_ID
          ? [{ key: 'planned', name: 'Planned', type: 'unstarted', position: 0 }]
          : [
              { key: 'backlog', name: 'Backlog', type: 'backlog', position: 0 },
              { key: 'todo', name: 'Todo', type: 'unstarted', position: 1 },
            ],
    }),
  );
  createObjectState.current = {
    request: null,
    closeCreate: vi.fn(),
    openCreate: vi.fn(),
  };
  creationState.current = null;
  sessionState.data = { user: { id: 'user_1' } };
  sessionState.isPending = false;
  routerPush.mockReset();
  // Radix Popover needs these DOM APIs that jsdom does not implement.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

/** Render the composer open, with one team so the team picker stays implicit. */
function renderComposer(overrides: Partial<Parameters<typeof CreateTaskDialog>[0]> = {}) {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  // The composer reads its option rosters through the shared useApiQuery layer, so it must run
  // under a QueryClientProvider (as it does in the app via providers.tsx). Retry-free for tests.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CreateTaskDialog
        orgId={ORG_ID}
        teams={TEAMS}
        defaultTeamId={TEAM_ID}
        teamsLoading={false}
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onCreated, onOpenChange };
}

interface GlobalTaskHarnessProps {
  readonly teams?: readonly TeamOut[];
  readonly request?: Record<string, unknown>;
  /** Start on the ready target while the provider has not frozen the opening workspace. */
  readonly delayedOpening?: boolean;
  /** Override destination readiness facts for submit-gate coverage. */
  readonly destination?: {
    readonly workspaceResolved?: boolean;
    readonly loading?: boolean;
    readonly loadError?: string | null;
    readonly canContribute?: boolean;
    readonly permissionsLoading?: boolean;
  };
}

/** Destination states that must never enable a Task mutation. */
const BLOCKED_DESTINATIONS: readonly [
  string,
  NonNullable<GlobalTaskHarnessProps['destination']>,
][] = [
  ['the target has not resolved', { workspaceResolved: false }],
  ['target data is loading', { loading: true }],
  [
    'target data failed to load',
    { loadError: 'Could not load creation options for this workspace.' },
  ],
  ['the member cannot contribute', { canContribute: false }],
];

/** Render the global Task host with a switchable target workspace. */
function renderGlobalTask({
  teams = GLOBAL_TEAMS,
  request = {},
  delayedOpening = false,
  destination = {},
}: GlobalTaskHarnessProps = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const closeCreate = vi.fn();
  const onCreated = vi.fn();
  const requestedInitialWorkspaceId =
    'initialWorkspaceId' in request ? (request['initialWorkspaceId'] as string | null) : ORG_ID;

  function Harness(): JSX.Element {
    const [initialWorkspaceId, setInitialWorkspaceId] = useState<string | null>(
      delayedOpening ? null : requestedInitialWorkspaceId,
    );
    const [targetWorkspaceId, setTargetWorkspaceId] = useState(
      delayedOpening ? TARGET_ORG_ID : ORG_ID,
    );
    const targetIsOriginal = targetWorkspaceId === ORG_ID;
    const targetTeams = targetIsOriginal ? teams : TARGET_TEAMS;
    const defaultTeamId = targetTeams[0]?.id ?? null;
    createObjectState.current = {
      request: {
        kind: 'task',
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
          actorId: ADA_ID,
          organizationId: targetWorkspaceId,
          displayName: 'Ada Lovelace',
          userId: 'user_1',
        },
      ],
      roles: [],
      vocabulary: { preset: targetIsOriginal ? 'startup' : 'agency', overrides: {} },
      defaultTeamId,
      permissions: {
        canContribute: destination.canContribute ?? true,
        canManage: true,
        canCreate: true,
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
            Resolve opening workspace
          </button>
        ) : null}
        <GlobalTaskComposer />
      </>
    );
  }

  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { closeCreate, onCreated, client };
}

/** Render the real dialog while an initially-null shell workspace resolves to its opening org. */
function renderDelayedOpeningTaskDefaults() {
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
      teams: TEAMS,
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
          Resolve original workspace
        </button>
        <CreateTaskDialog
          orgId={ORG_ID}
          teams={TEAMS}
          defaultTeamId={TEAM_ID}
          teamsLoading={!resolved}
          open
          onOpenChange={() => undefined}
          onCreated={() => undefined}
          defaultProjectId={APOLLO_ID}
          defaultAssigneeId={ADA_ID}
          globalCreation={{
            targetWorkspaceId: resolved ? ORG_ID : null,
            initialWorkspaceId: resolved ? ORG_ID : null,
            ready: resolved,
            loadError: null,
            canContribute: true,
            currentActorId: ADA_ID,
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

/** Make one task template row without coupling tests to DTO implementation details. */
function taskTemplate(
  name: string,
  scope: 'organization' | 'personal' | 'team',
  ownerActorId: string | null,
  teamId: string | null,
) {
  return {
    id: `${name.replaceAll(' ', '_')}_id`,
    organizationId: ORG_ID,
    targetType: 'task',
    name,
    description: null,
    scope,
    ownerActorId,
    teamId,
    payload: { targetType: 'task' },
    isSeed: false,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('CreateTaskDialog — robust composer', () => {
  it('renders Start from template inside the empty editor after the task title', async () => {
    templatesGet.mockResolvedValue(
      jsonResponse(true, {
        items: [taskTemplate('My template', 'personal', ADA_ID, null)],
      }),
    );
    renderGlobalTask();

    const workspace = screen.getByRole('combobox', { name: 'Workspace' });
    const team = screen.getByRole('button', { name: /Team — currently General/ });
    const template = await screen.findByRole('button', { name: 'Start from template' });
    const title = screen.getByLabelText('Task title');

    expect(workspace.compareDocumentPosition(team) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(team.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(template) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Team/ })).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="ChevronRightIcon"]')).toHaveLength(1);
  });

  it('omits the team control from the global context row when one team is implied', async () => {
    templatesGet.mockResolvedValue(
      jsonResponse(true, {
        items: [taskTemplate('My template', 'personal', ADA_ID, null)],
      }),
    );
    renderGlobalTask({ teams: TEAMS });

    expect(screen.getByRole('combobox', { name: 'Workspace' })).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Start from template' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Team/ })).toBeNull();
    expect(document.querySelectorAll('[data-testid="ChevronRightIcon"]')).toHaveLength(0);
  });

  it('does not leave a blank context row in the legacy single-team composer', async () => {
    renderComposer();

    await waitFor(() => {
      expect(templatesGet).toHaveBeenCalled();
    });

    expect(screen.getByLabelText('Task title').closest('form')).toHaveClass('pt-5');
    expect(screen.queryByRole('button', { name: 'Start from template' })).toBeNull();
  });

  it('keeps the legacy Team context visible when no templates are available', async () => {
    renderComposer({ teams: GLOBAL_TEAMS, defaultTeamId: TEAM_ID });

    await waitFor(() => {
      expect(templatesGet).toHaveBeenCalled();
    });

    const team = screen.getByRole('button', { name: /Team — currently General/ });
    const title = screen.getByLabelText('Task title');
    const contextRow = team.closest('div.flex.items-center.gap-2');

    expect(team).toBeVisible();
    expect(contextRow).not.toHaveClass('has-[>div:empty]:hidden');
    expect(team.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.closest('form')).toHaveClass('pt-3');
  });

  it('keeps compact title spacing for a legacy template-only composer with a template', async () => {
    templatesGet.mockResolvedValue(
      jsonResponse(true, {
        items: [taskTemplate('My template', 'personal', ADA_ID, null)],
      }),
    );
    renderComposer();

    const template = await screen.findByRole('button', { name: 'Start from template' });
    const title = screen.getByLabelText('Task title');

    expect(title.compareDocumentPosition(template) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.closest('form')).toHaveClass('pt-5');
  });

  it.each(BLOCKED_DESTINATIONS)('disables submission when %s', async (_reason, destination) => {
    renderGlobalTask({ teams: TEAMS, destination });

    if (destination.workspaceResolved !== false && !destination.loading && !destination.loadError) {
      await waitFor(() => {
        expect(teamGet).toHaveBeenCalled();
      });
    }

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Blocked task' } });

    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Create more' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(taskPost).not.toHaveBeenCalled();
  });

  it('waits for the immutable opening workspace before classifying a selected target', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_delayed_cross', title: 'Delayed' }));
    const { onCreated } = renderGlobalTask({ teams: TEAMS, delayedOpening: true });

    expect(screen.getByRole('combobox', { name: 'Workspace' })).toHaveValue(TARGET_ORG_ID);
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Delayed' } });
    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled();
    expect(taskPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Resolve opening workspace'));
    await waitFor(() => {
      expect(teamGet).toHaveBeenCalledWith({
        param: { orgId: TARGET_ORG_ID, teamId: TARGET_TEAM_ID },
      });
      expect(screen.getByRole('button', { name: 'Create task' })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith(`/orgs/${TARGET_ORG_ID}/tasks/task_delayed_cross`);
    });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('preserves contextual Task defaults when the delayed shell resolves to its opening workspace', async () => {
    taskPost.mockResolvedValue(
      jsonResponse(true, { id: 'task_delayed_original', title: 'Delayed' }),
    );
    renderDelayedOpeningTaskDefaults();

    expect(workStructureGet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Resolve original workspace'));
    await waitFor(() => {
      expect(teamGet).toHaveBeenCalled();
      expect(workStructureGet).toHaveBeenCalledWith(
        expect.objectContaining({ param: { orgId: ORG_ID } }),
      );
      expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled();
    });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Delayed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(taskPost.mock.calls)).toMatchObject({
      assigneeId: ADA_ID,
      projectId: APOLLO_ID,
    });
  });

  it('closes the global composer before navigating to template settings', async () => {
    templatesGet.mockResolvedValue(
      jsonResponse(true, {
        items: [taskTemplate('Shared template', 'organization', null, null)],
      }),
    );
    const { closeCreate } = renderGlobalTask();

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Start from template' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Manage templates…' }));

    expect(closeCreate).toHaveBeenCalledOnce();
  });

  it('lists a sole personal template without a scope heading', async () => {
    templatesGet.mockResolvedValue(
      jsonResponse(true, {
        items: [taskTemplate('My template', 'personal', ADA_ID, null)],
      }),
    );
    renderGlobalTask();

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Start from template' }), {
      button: 0,
    });

    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText('Yours')).not.toBeInTheDocument();
    expect(within(menu).getByText('My template')).toBeVisible();
  });

  it('clears a prior team workflow and cycle before submitting under the newly selected team', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_team', title: 'Retargeted' }));
    renderGlobalTask();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Status — Backlog/ })).toBeVisible();
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Retargeted' } });
    fireEvent.click(screen.getByRole('button', { name: /Cycle/ }));
    fireEvent.click(await screen.findByText('Cycle 1'));
    fireEvent.pointerDown(screen.getByRole('button', { name: /Team — currently General/ }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByText('Platform'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Status — Planned/ })).toBeVisible();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    const body = firstJson(taskPost.mock.calls);
    expect(body).toMatchObject({ teamId: SECOND_TEAM_ID, state: 'planned' });
    expect(body).not.toHaveProperty('cycleId');
  });

  it('posts to the selected workspace and clears every task reference from the previous one', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_target', title: 'Portable task' }));
    renderGlobalTask({
      request: { defaultAssigneeId: ADA_ID, defaultProjectId: APOLLO_ID },
    });

    await waitFor(() => {
      expect(milestonesGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Portable task' } });
    const description = screen.getByLabelText('Add a description');
    await act(async () => {
      description.innerHTML = '<p>Keep this draft text.</p>';
      fireEvent.input(description);
    });
    fireEvent.click(screen.getByRole('button', { name: /Milestone/ }));
    fireEvent.click(await screen.findByText('Launch'));
    fireEvent.click(screen.getByRole('button', { name: /Cycle/ }));
    fireEvent.click(await screen.findByText('Cycle 1'));
    const labelsTrigger = screen.getByRole('button', { name: /Labels/ });
    fireEvent.click(labelsTrigger);
    fireEvent.click(await screen.findByText('Bug'));
    fireEvent.click(labelsTrigger);

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: TARGET_ORG_ID },
    });

    await waitFor(() => {
      expect(teamGet).toHaveBeenCalledWith({
        param: { orgId: TARGET_ORG_ID, teamId: TARGET_TEAM_ID },
      });
      expect(projectsGet).toHaveBeenCalledWith(
        expect.objectContaining({ param: { orgId: TARGET_ORG_ID } }),
      );
      expect(workStructureGet).toHaveBeenCalledWith(
        expect.objectContaining({ param: { orgId: TARGET_ORG_ID } }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    expect(taskPost).toHaveBeenCalledWith(
      expect.objectContaining({ param: { orgId: TARGET_ORG_ID } }),
    );
    const body = firstJson(taskPost.mock.calls);
    expect(body).toMatchObject({
      title: 'Portable task',
      description: 'Keep this draft text.',
      teamId: TARGET_TEAM_ID,
      priority: 'none',
    });
    expect(body).not.toHaveProperty('assigneeId');
    expect(body).not.toHaveProperty('projectId');
    expect(body).not.toHaveProperty('milestoneId');
    expect(body).not.toHaveProperty('cycleId');
    expect(body).not.toHaveProperty('labels');
  });

  it('offers only templates scoped to the selected person and team', async () => {
    templatesGet.mockResolvedValue(
      jsonResponse(true, {
        items: [
          taskTemplate('Workspace template', 'organization', null, null),
          taskTemplate('My template', 'personal', ADA_ID, null),
          taskTemplate('Someone else template', 'personal', APOLLO_ID, null),
          taskTemplate('General template', 'team', APOLLO_ID, TEAM_ID),
          taskTemplate('Platform template', 'team', APOLLO_ID, SECOND_TEAM_ID),
        ],
      }),
    );
    renderGlobalTask();

    await waitFor(() => {
      expect(templatesGet).toHaveBeenCalled();
    });
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Start from template' }), {
      button: 0,
      ctrlKey: false,
    });

    expect(await screen.findByText('Workspace template')).toBeVisible();
    expect(screen.getByText('My template')).toBeVisible();
    expect(screen.getByText('General template')).toBeVisible();
    expect(screen.queryByText('Someone else template')).toBeNull();
    expect(screen.queryByText('Platform template')).toBeNull();
  });

  it('sends the title, description, and a default priority through the create DTO', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_1', title: 'Ship it' }));
    const { onCreated, onOpenChange } = renderComposer();

    // The status default is seeded from the per-team workflow read.
    await waitFor(() => {
      expect(teamGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: '  Ship it  ' } });
    const description = screen.getByLabelText('Add a description');
    // Tiptap observes the contenteditable DOM; act flushes that observer before form submission.
    await act(async () => {
      description.innerHTML = '<p>The whole thing.</p>';
      fireEvent.input(description);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    const body = firstJson(taskPost.mock.calls);
    expect(body).toMatchObject({
      title: 'Ship it',
      description: 'The whole thing.',
      teamId: TEAM_ID,
      priority: 'none',
      state: 'backlog',
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'task_1' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('threads a chosen assignee through the create DTO', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_2', title: 'Wired' }));
    renderComposer();

    await waitFor(() => {
      expect(membersGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Wired' } });
    fireEvent.click(screen.getByRole('button', { name: /Assignee/ }));
    fireEvent.click(await screen.findByText('Ada Lovelace'));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(taskPost.mock.calls)).toMatchObject({ title: 'Wired', assigneeId: ADA_ID });
  });

  it('threads a chosen project through the create DTO', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_3', title: 'Scoped' }));
    renderComposer();

    await waitFor(() => {
      expect(projectsGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Scoped' } });
    fireEvent.click(screen.getByRole('button', { name: /Project/ }));
    fireEvent.click(await screen.findByText('Apollo'));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(taskPost.mock.calls)).toMatchObject({ title: 'Scoped', projectId: APOLLO_ID });
  });

  it('threads a toggled label through the create DTO', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_4', title: 'Tagged' }));
    renderComposer();

    await waitFor(() => {
      expect(labelsGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Tagged' } });
    // Labels is multi-select: open, toggle Bug, then re-click the trigger to close the popover.
    const labelsTrigger = screen.getByRole('button', { name: /Labels/ });
    fireEvent.click(labelsTrigger);
    fireEvent.click(await screen.findByText('Bug'));
    fireEvent.click(labelsTrigger);

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(taskPost.mock.calls)).toMatchObject({ title: 'Tagged', labels: [BUG_ID] });
  });

  it('creates a repeating task through the one-call recurrence endpoint', async () => {
    recurringTaskPost.mockResolvedValue(
      jsonResponse(true, {
        firstTask: { id: 'task_repeat', title: 'Run six miles' },
        series: { id: 'series_1' },
        occurrences: [],
      }),
    );
    const { onCreated } = renderComposer();
    await waitFor(() => {
      expect(teamGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Run six miles' } });
    fireEvent.click(screen.getByRole('button', { name: 'Repeat — Does not repeat' }));
    fireEvent.change(screen.getByLabelText('Repeat cadence'), { target: { value: 'daily' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create repeating task' }));

    await waitFor(() => {
      expect(recurringTaskPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(recurringTaskPost.mock.calls)).toMatchObject({
      task: { title: 'Run six miles', teamId: TEAM_ID, state: 'backlog' },
      schedule: { kind: 'daily', interval: 1 },
      missedPolicy: 'skip',
      materialization: { horizonDays: 28, minimumOccurrences: 2 },
    });
    expect(taskPost).not.toHaveBeenCalled();
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task_repeat', title: 'Run six miles' }),
    );
  });

  it('disables Create until the title is non-empty and never sends an empty title', async () => {
    renderComposer();
    await waitFor(() => {
      expect(teamGet).toHaveBeenCalled();
    });
    const create = screen.getByRole('button', { name: 'Create task' });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    expect(taskPost).not.toHaveBeenCalled();
  });

  it('defaults Create more off so the primary Create closes normally', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_normal', title: 'Normal task' }));
    const { closeCreate, onCreated } = renderGlobalTask({ teams: TEAMS });

    const createMore = screen.getByRole('switch', { name: 'Create more' });
    expect(createMore).toHaveAttribute('aria-checked', 'false');
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Normal task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    expect(closeCreate).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it('continues from the primary Create while Create more is on and closes after it is turned off', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_more', title: 'First task' }));
    const { onCreated, closeCreate } = renderGlobalTask({ teams: TEAMS });

    await waitFor(() => {
      expect(projectsGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'First task' } });
    fireEvent.click(screen.getByRole('button', { name: /Project/ }));
    fireEvent.click(await screen.findByText('Apollo'));
    const description = screen.getByLabelText('Add a description');
    await act(async () => {
      description.innerHTML = '<p>Only this text resets.</p>';
      fireEvent.input(description);
    });
    const createMore = screen.getByRole('switch', { name: 'Create more' });
    fireEvent.click(createMore);
    expect(createMore).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(taskPost.mock.calls)).toMatchObject({
      title: 'First task',
      description: 'Only this text resets.',
      projectId: APOLLO_ID,
      teamId: TEAM_ID,
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'task_more' }));
    expect(closeCreate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByLabelText('Task title')).toHaveValue('');
      expect(screen.getByLabelText('Add a description').textContent).toBe('');
    });
    expect(screen.getByRole('status')).toHaveTextContent('Task created. Ready to create another.');
    expect(document.activeElement).toBe(screen.getByLabelText('Task title'));

    fireEvent.click(createMore);
    expect(createMore).toHaveAttribute('aria-checked', 'false');
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Final task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(2);
    });
    expect(firstJson(taskPost.mock.calls.slice(1))).toMatchObject({
      title: 'Final task',
      projectId: APOLLO_ID,
      teamId: TEAM_ID,
    });
    expect(closeCreate).toHaveBeenCalledOnce();
  });

  it('uses Cmd or Ctrl+Shift+Enter to create another task once', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_shortcut', title: 'Shortcut' }));
    const { closeCreate } = renderGlobalTask({ teams: TEAMS });

    await waitFor(() => {
      expect(teamGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Shortcut' } });
    const description = screen.getByLabelText('Add a description');
    expect(screen.getByRole('switch', { name: 'Create more' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    fireEvent.keyDown(description, { key: 'Enter', ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(description, { key: 'Enter', ctrlKey: true, shiftKey: true, repeat: true });

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    expect(closeCreate).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByLabelText('Task title')).toHaveValue('');
    });
    expect(document.activeElement).toBe(screen.getByLabelText('Task title'));
    expect(screen.getByRole('switch', { name: 'Create more' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('uses Cmd or Ctrl+Shift+Enter from the title without changing Create more', async () => {
    taskPost.mockResolvedValue(
      jsonResponse(true, { id: 'task_title_shortcut', title: 'Title shortcut' }),
    );
    const { closeCreate } = renderGlobalTask({ teams: TEAMS });

    const title = screen.getByLabelText('Task title');
    fireEvent.change(title, { target: { value: 'Title shortcut' } });
    fireEvent.keyDown(title, { key: 'Enter', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
      expect(title).toHaveValue('');
    });
    expect(closeCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Create more' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('routes a normal cross-workspace Task without invoking the origin callback', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_cross', title: 'Cross task' }));
    const afterCreate = vi.fn();
    const { closeCreate, onCreated } = renderGlobalTask({
      teams: TEAMS,
      request: { afterCreate },
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: TARGET_ORG_ID },
    });
    await waitFor(() => {
      expect(teamGet).toHaveBeenCalledWith({
        param: { orgId: TARGET_ORG_ID, teamId: TARGET_TEAM_ID },
      });
    });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Cross task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith(`/orgs/${TARGET_ORG_ID}/tasks/task_cross`);
    });
    expect(closeCreate).toHaveBeenCalledOnce();
    expect(onCreated).not.toHaveBeenCalled();
    expect(afterCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task_cross', title: 'Cross task' }),
    );
  });

  it('awaits destination-independent work before cross-workspace routing', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_awaited', title: 'Awaited task' }));
    let finishContinuation: (() => void) | undefined;
    const afterCreate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishContinuation = resolve;
        }),
    );
    const { closeCreate } = renderGlobalTask({
      teams: TEAMS,
      request: { afterCreate },
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: TARGET_ORG_ID },
    });
    await waitFor(() => {
      expect(teamGet).toHaveBeenCalledWith({
        param: { orgId: TARGET_ORG_ID, teamId: TARGET_TEAM_ID },
      });
    });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Awaited task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(afterCreate).toHaveBeenCalledOnce();
    });
    expect(routerPush).not.toHaveBeenCalled();
    expect(closeCreate).not.toHaveBeenCalled();

    finishContinuation?.();
    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith(`/orgs/${TARGET_ORG_ID}/tasks/task_awaited`);
    });
    expect(closeCreate).toHaveBeenCalledOnce();
  });

  it('keeps a created Task visible when its destination-independent work fails', async () => {
    taskPost.mockResolvedValue(
      jsonResponse(true, {
        id: 'task_unlinked',
        organizationId: TARGET_ORG_ID,
        title: 'Unlinked task',
      }),
    );
    const afterCreate = vi.fn(() => {
      throw new UserFacingError(
        'The task was created, but we could not link it to this calendar item. Open the created task to copy its ID, then return to Calendar and use Link.',
      );
    });
    const { client, closeCreate } = renderGlobalTask({
      teams: TEAMS,
      request: { afterCreate },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: TARGET_ORG_ID },
    });
    await waitFor(() => {
      expect(teamGet).toHaveBeenCalledWith({
        param: { orgId: TARGET_ORG_ID, teamId: TARGET_TEAM_ID },
      });
    });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Unlinked task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    expect(
      await screen.findByText(
        'The task was created, but we could not link it to this calendar item. Open the created task to copy its ID, then return to Calendar and use Link.',
      ),
    ).toBeVisible();
    expect(routerPush).not.toHaveBeenCalled();
    expect(closeCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Create task' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open created task' })).toBeEnabled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks(TARGET_ORG_ID) });
    expect(screen.getByLabelText('Task title')).toBeDisabled();
    await waitFor(() => {
      expect(screen.getByLabelText('Add a description')).toHaveAttribute(
        'contenteditable',
        'false',
      );
    });

    const destination = screen.getByRole('combobox', { name: 'Workspace' });
    await act(async () => {
      fireEvent.change(destination, { target: { value: ORG_ID } });
    });
    expect(destination).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Discard this draft?')).not.toBeInTheDocument();
    expect(closeCreate).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Open created task' }));
    expect(routerPush).toHaveBeenCalledWith(`/orgs/${TARGET_ORG_ID}/tasks/task_unlinked`);
    expect(closeCreate).toHaveBeenCalledTimes(2);
  });

  it('keeps a cross-workspace repeat in the modal without invoking the origin callback', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_cross_more', title: 'Cross more' }));
    const afterCreate = vi.fn(() => Promise.resolve());
    const { client, closeCreate, onCreated } = renderGlobalTask({
      teams: TEAMS,
      request: { afterCreate },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: TARGET_ORG_ID },
    });
    await waitFor(() => {
      expect(teamGet).toHaveBeenCalledWith({
        param: { orgId: TARGET_ORG_ID, teamId: TARGET_TEAM_ID },
      });
    });
    fireEvent.click(screen.getByRole('switch', { name: 'Create more' }));
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Cross more' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    expect(closeCreate).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(afterCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task_cross_more', title: 'Cross more' }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks(TARGET_ORG_ID) });
  });

  it('invalidates target task, graph, project, and cycle caches for a repeated Task', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_invalidate', title: 'Invalidate' }));
    const { client } = renderGlobalTask({ teams: TEAMS });
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await waitFor(() => {
      expect(teamGet).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Project/ })).toBeEnabled();
    });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Invalidate' } });
    fireEvent.click(screen.getByRole('button', { name: /Project/ }));
    fireEvent.click(await screen.findByText('Apollo'));
    fireEvent.click(screen.getByRole('button', { name: /Cycle/ }));
    fireEvent.click(await screen.findByText('Cycle 1'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Cycle — Cycle 1/ })).toBeVisible();
    });
    const createMore = screen.getByRole('switch', { name: 'Create more' });
    fireEvent.click(createMore);
    expect(createMore).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Create task' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.tasks(ORG_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['org', ORG_ID, 'task-graph'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.projects(ORG_ID) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.cycles(ORG_ID) });
  });

  it('offers no summary line — a task title is already its one-liner', async () => {
    // Tasks deliberately capture title + description only. The other work entities are long-lived
    // containers whose names ("Atlas", "Q3 Reliability") say nothing alone, so a summary earns its
    // space there; a task title ("Dual-write the ingest path") is the summary by construction, and
    // a second one-line field under it just asked for the same sentence twice.
    renderComposer();

    await waitFor(() => {
      expect(teamGet).toHaveBeenCalled();
    });

    expect(screen.getByLabelText('Task title')).toBeTruthy();
    expect(screen.queryByLabelText('One-sentence summary')).toBeNull();
    expect(screen.queryByPlaceholderText('One-sentence summary')).toBeNull();
  });

  it('surfaces application-owned copy when the create fails', async () => {
    taskPost.mockResolvedValue(jsonResponse(false, { detail: 'Title is taken.' }));
    const { onCreated } = renderComposer();

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Could not create the task.')).toBeTruthy();
    expect(within(alert).queryByText('Title is taken.')).toBeNull();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

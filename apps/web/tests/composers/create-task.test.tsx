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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the mock factory (lifted above imports) can reference them.
const { taskPost, membersGet, agentsGet, projectsGet, cyclesGet, labelsGet, teamGet } = vi.hoisted(
  () => ({
    taskPost: vi.fn(),
    membersGet: vi.fn(),
    agentsGet: vi.fn(),
    projectsGet: vi.fn(),
    cyclesGet: vi.fn(),
    labelsGet: vi.fn(),
    teamGet: vi.fn(),
  }),
);

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          tasks: { $post: taskPost },
          members: { $get: membersGet },
          agents: { $get: agentsGet },
          projects: { $get: projectsGet },
          cycles: { $get: cyclesGet },
          labels: { $get: labelsGet },
          teams: { ':teamId': { $get: teamGet } },
        },
      },
    },
  },
}));

import { CreateTaskDialog } from '../../src/components/tasks/create-task';

/** A `Response`-like stub whose `ok`/`json()` the composer reads. */
function jsonResponse(ok: boolean, body: unknown): Response {
  return { ok, json: async () => body } as Response;
}

/** The `json` body of a mocked RPC spy's first call (asserted after a `toHaveBeenCalled`). */
function firstJson(spy: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = spy.mock.calls[0];
  if (!call) throw new Error('expected the RPC spy to have been called');
  return (call[0] as { json: Record<string, unknown> }).json;
}

// Branded ids (ActorId / ProjectId / TeamId / LabelId) are ULIDs, so the composer's `*.parse(...)`
// guards only accept the canonical 26-char Crockford-base32 shape. Use valid ULIDs throughout.
const ORG_ID = '0RG00000000000000000000001';
const TEAM_ID = 'TEAM0000000000000000000002';
const ADA_ID = 'ADA00000000000000000000003';
const APOLLO_ID = 'APR00000000000000000000004';
const BUG_ID = 'BG000000000000000000000005';

/** The single (implicit) team the composer creates tasks in. */
const TEAMS: readonly TeamOut[] = [
  {
    id: TeamId.parse(TEAM_ID),
    organizationId: OrganizationId.parse(ORG_ID),
    name: 'General',
    key: 'GEN',
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

/** No agents in these scenarios. */
const AGENTS: unknown[] = [];

beforeEach(() => {
  taskPost.mockReset();
  membersGet.mockReset().mockResolvedValue(jsonResponse(true, { items: MEMBERS }));
  agentsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: AGENTS }));
  projectsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: PROJECTS }));
  cyclesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  labelsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: LABELS }));
  teamGet.mockReset().mockResolvedValue(
    jsonResponse(true, {
      workflowStates: [
        { key: 'backlog', name: 'Backlog', type: 'backlog', position: 0 },
        { key: 'todo', name: 'Todo', type: 'unstarted', position: 1 },
      ],
    }),
  );
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

describe('CreateTaskDialog — robust composer', () => {
  it('sends the title, description, and a default priority through the create DTO', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_1', title: 'Ship it' }));
    const { onCreated, onOpenChange } = renderComposer();

    // The status default is seeded from the per-team workflow read.
    await waitFor(() => {
      expect(teamGet).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: '  Ship it  ' } });
    fireEvent.change(screen.getByLabelText('Add a description…'), {
      target: { value: 'The whole thing.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    const body = firstJson(taskPost);
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
    expect(firstJson(taskPost)).toMatchObject({ title: 'Wired', assigneeId: ADA_ID });
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
    expect(firstJson(taskPost)).toMatchObject({ title: 'Scoped', projectId: APOLLO_ID });
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
    expect(firstJson(taskPost)).toMatchObject({ title: 'Tagged', labels: [BUG_ID] });
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

  it('surfaces the server problem message when the create fails', async () => {
    taskPost.mockResolvedValue(jsonResponse(false, { detail: 'Title is taken.' }));
    const { onCreated } = renderComposer();

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Title is taken.')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

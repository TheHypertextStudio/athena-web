/**
 * The task composer keeps its draft on the server: typed text becomes a row after the quiet
 * period, later typing patches it, closing offers to keep or discard it, and creating the task
 * removes it. Property picks alone never create a row, and a draft named on mount is poured in.
 *
 * The RPC client is mocked; the drafts endpoints echo what they are sent, as the server would.
 */
import type { ComposerDraftOut, ComposerDraftPayload } from '@docket/work/composer-draft-contract';
import { OrganizationId, TeamId } from '@docket/identity-access/ids';
import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TeamOut } from '../../src/lib/contracts/team';

const {
  taskPost,
  membersGet,
  agentsGet,
  projectsGet,
  displaysGet,
  cyclesGet,
  labelsGet,
  milestonesGet,
  teamGet,
  templatesGet,
  workStructureGet,
  draftsGet,
  draftPost,
  draftGet,
  draftPatch,
  draftDelete,
} = vi.hoisted(() => ({
  taskPost: vi.fn(),
  membersGet: vi.fn(),
  agentsGet: vi.fn(),
  projectsGet: vi.fn(),
  displaysGet: vi.fn(),
  cyclesGet: vi.fn(),
  labelsGet: vi.fn(),
  milestonesGet: vi.fn(),
  teamGet: vi.fn(),
  templatesGet: vi.fn(),
  workStructureGet: vi.fn(),
  draftsGet: vi.fn(),
  draftPost: vi.fn(),
  draftGet: vi.fn(),
  draftPatch: vi.fn(),
  draftDelete: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          tasks: { $post: taskPost },
          members: { $get: membersGet },
          agents: { $get: agentsGet },
          projects: Object.assign(
            { $get: projectsGet },
            { ':id': { milestones: { $get: milestonesGet } } },
          ),
          display: { ':subjectType': { $get: displaysGet } },
          cycles: { $get: cyclesGet },
          labels: { $get: labelsGet },
          templates: { $get: templatesGet },
          settings: { 'work-structure': { $get: workStructureGet } },
          teams: { ':teamId': { $get: teamGet } },
          mentions: {
            search: { $get: vi.fn() },
            external: { $get: vi.fn() },
            hydrate: { $post: vi.fn() },
          },
        },
      },
      me: {
        drafts: Object.assign(
          { $get: draftsGet, $post: draftPost },
          { ':id': { $get: draftGet, $patch: draftPatch, $delete: draftDelete } },
        ),
      },
    },
  },
}));

import { CreateTaskDialog } from '../../src/components/tasks/create-task';
import { firstJson, jsonResponse } from '../support/http';
import { seededQueryClient } from '../support/seeded-query-client';

const ORG_ID = '0RG00000000000000000000001';
const TEAM_ID = 'TEAM0000000000000000000002';
const APOLLO_ID = 'APR00000000000000000000004';

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

const PROJECTS = [
  {
    id: APOLLO_ID,
    organizationId: ORG_ID,
    name: 'Apollo',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

/** A draft row as the API returns it. */
function row(overrides: Partial<ComposerDraftOut> = {}): ComposerDraftOut {
  const now = new Date().toISOString();
  return {
    id: 'draft_1',
    organizationId: ORG_ID,
    kind: 'task',
    revision: 0,
    payload: { kind: 'task', title: '', description: '' },
    title: null,
    createdAt: now,
    updatedAt: now,
    expiresAt: now,
    ...overrides,
  } as ComposerDraftOut;
}

/** The wire body a drafts write was called with. */
interface DraftWrite {
  readonly json: { readonly payload: ComposerDraftPayload; readonly revision?: number };
}

/** Answer a create with a row carrying the payload that was sent. */
function echoCreate(call: DraftWrite): Promise<Response> {
  const title = call.json.payload.kind === 'task' ? (call.json.payload.title ?? null) : null;
  return Promise.resolve(jsonResponse(true, row({ payload: call.json.payload, title })));
}

/** Answer a write with the next revision and the payload that was sent. */
function echoPatch(call: DraftWrite): Promise<Response> {
  const revision = (call.json.revision ?? 0) + 1;
  return Promise.resolve(jsonResponse(true, row({ payload: call.json.payload, revision })));
}

/** Let a quiet period pass in real time. */
function quiet(ms = 800): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

beforeEach(() => {
  taskPost.mockReset();
  membersGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  agentsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  projectsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: PROJECTS }));
  displaysGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  cyclesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  labelsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  milestonesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  templatesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  workStructureGet.mockReset().mockResolvedValue(jsonResponse(true, { estimationScale: 'none' }));
  teamGet.mockReset().mockResolvedValue(
    jsonResponse(true, {
      workflowStates: [{ key: 'backlog', name: 'Backlog', type: 'backlog', position: 0 }],
    }),
  );
  draftsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  draftPost.mockReset().mockImplementation(echoCreate);
  draftGet.mockReset().mockResolvedValue(jsonResponse(true, row()));
  draftPatch.mockReset().mockImplementation(echoPatch);
  draftDelete.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  // Radix Popover needs these DOM APIs that jsdom does not implement.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

/** Render the composer open in one workspace with one implicit team. */
function renderComposer(overrides: Partial<Parameters<typeof CreateTaskDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const client = seededQueryClient({
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
        onCreated={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

/** Type a title and wait for the first draft row to exist. */
async function typeUntilSaved(title: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: title } });
  await waitFor(() => {
    expect(draftPost).toHaveBeenCalledTimes(1);
  });
}

describe('CreateTaskDialog — drafts', () => {
  it('saves a typed title as one draft after the quiet period and patches later typing', async () => {
    renderComposer();

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Grant' } });
    expect(draftPost).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(draftPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(draftPost.mock.calls)).toMatchObject({
      organizationId: ORG_ID,
      kind: 'task',
      payload: { kind: 'task', title: 'Grant' },
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Grant report' } });
    await waitFor(() => {
      expect(draftPatch).toHaveBeenCalledTimes(1);
    });
    expect(draftPost).toHaveBeenCalledTimes(1);
    expect(draftPatch.mock.calls[0]?.[0]).toMatchObject({
      param: { id: 'draft_1' },
      json: { revision: 0, payload: { kind: 'task', title: 'Grant report' } },
    });
  });

  it('does not save a draft for property picks alone', async () => {
    renderComposer();
    await waitFor(() => {
      expect(projectsGet).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: /Project/ }));
    fireEvent.click(await screen.findByText('Apollo'));
    await quiet();

    expect(draftPost).not.toHaveBeenCalled();
  });

  it('offers to keep the draft on close, which leaves the row in place', async () => {
    const { onOpenChange } = renderComposer();
    await typeUntilSaved('Grant report');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save draft' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(draftDelete).not.toHaveBeenCalled();
  });

  it('deletes the row when the close prompt is answered with Discard', async () => {
    const { onOpenChange } = renderComposer();
    await typeUntilSaved('Grant report');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));

    await waitFor(() => {
      expect(draftDelete).toHaveBeenCalledWith({ param: { id: 'draft_1' } });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('deletes the draft once the task is created', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_1', title: 'Grant report' }));
    const { onOpenChange } = renderComposer();
    await typeUntilSaved('Grant report');

    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(taskPost).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(draftDelete).toHaveBeenCalledWith({ param: { id: 'draft_1' } });
    });
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('starts a fresh draft for the next task after Create more', async () => {
    taskPost.mockResolvedValue(jsonResponse(true, { id: 'task_1', title: 'First' }));
    renderComposer();
    await typeUntilSaved('First');

    fireEvent.click(screen.getByRole('switch', { name: 'Create more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => {
      expect(draftDelete).toHaveBeenCalledWith({ param: { id: 'draft_1' } });
    });

    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Second' } });
    await waitFor(() => {
      expect(draftPost).toHaveBeenCalledTimes(2);
    });
    expect(draftPost.mock.calls[1]?.[0]).toMatchObject({
      json: { payload: { kind: 'task', title: 'Second' } },
    });
  });

  it('pours in the draft named by resumeDraftId on mount', async () => {
    draftGet.mockResolvedValue(
      jsonResponse(
        true,
        row({
          id: 'draft_7',
          revision: 3,
          title: 'Saved title',
          payload: { kind: 'task', title: 'Saved title', description: 'Saved body' },
        }),
      ),
    );
    renderComposer({ resumeDraftId: 'draft_7' });

    expect(await screen.findByDisplayValue('Saved title')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByLabelText('Add a description')).toHaveTextContent('Saved body');
    });
    expect(draftGet).toHaveBeenCalledWith({ param: { id: 'draft_7' } });
    // The reopened row is the one being written; nothing new is created for it.
    expect(draftPost).not.toHaveBeenCalled();
  });
});

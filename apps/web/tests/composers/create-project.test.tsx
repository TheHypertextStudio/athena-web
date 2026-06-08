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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectPost, membersGet, agentsGet, initiativesGet } = vi.hoisted(() => ({
  projectPost: vi.fn(),
  membersGet: vi.fn(),
  agentsGet: vi.fn(),
  initiativesGet: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          projects: { $post: projectPost },
          members: { $get: membersGet },
          agents: { $get: agentsGet },
          initiatives: { $get: initiativesGet },
        },
      },
    },
  },
}));

import { CreateProjectDialog } from '../../src/components/projects/create-project';

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

// Valid ULID-shaped ids (no I/L/O/U) so the composer's `*.parse(...)` guards accept them.
const ORG_ID = '0RG00000000000000000000001';
const TEAM_ID = 'TEAM0000000000000000000002';
const GRACE_ID = 'GRC00000000000000000000003';
const Q3_ID = 'Q3000000000000000000000004';

/** The single (implicit) team the composer creates projects in. */
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

const INITIATIVES = [
  {
    id: Q3_ID,
    organizationId: ORG_ID,
    name: 'Q3 Reliability',
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

beforeEach(() => {
  projectPost.mockReset();
  membersGet.mockReset().mockResolvedValue(jsonResponse(true, { items: MEMBERS }));
  agentsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  initiativesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: INITIATIVES }));
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

/** Render the composer open with the standard rosters; returns the spy callbacks. */
function renderComposer() {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CreateProjectDialog
      orgId={ORG_ID}
      projectNoun="Project"
      teams={TEAMS}
      defaultTeamId={TEAM_ID}
      teamsLoading={false}
      open
      onOpenChange={onOpenChange}
      onCreated={onCreated}
    />,
  );
  return { onCreated, onOpenChange };
}

describe('CreateProjectDialog — robust composer', () => {
  it('sends the title, description, and default team through the create DTO', async () => {
    projectPost.mockResolvedValue(jsonResponse(true, { id: 'proj_1', name: 'Atlas' }));
    const { onCreated } = renderComposer();

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Atlas' } });
    fireEvent.change(screen.getByLabelText('Add a description…'), {
      target: { value: 'Re-platform.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    expect(firstJson(projectPost)).toMatchObject({
      name: 'Atlas',
      description: 'Re-platform.',
      teamId: TEAM_ID,
    });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'proj_1' }));
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
    expect(firstJson(projectPost)).toMatchObject({ name: 'Led', leadId: GRACE_ID });
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
    expect(firstJson(projectPost)).toMatchObject({
      name: 'Linked',
      initiativeIds: [Q3_ID],
    });
  });

  it('surfaces the server problem message when the create fails', async () => {
    projectPost.mockResolvedValue(jsonResponse(false, { detail: 'Name already used.' }));
    const { onCreated } = renderComposer();

    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Name already used.')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

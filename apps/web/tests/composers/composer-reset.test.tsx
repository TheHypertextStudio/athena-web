/**
 * Regression tests for composer draft lifetime: every open starts from a pristine form.
 *
 * @remarks
 * The create composers are *always mounted* by their host page (the page owns `open`, the dialog
 * renders nothing while closed), so their field state outlives any single open→close cycle. The
 * original composers tried to compensate by hand-resetting every field inside an `onOpenChange`
 * wrapper — but the successful-create path closed the dialog by calling the host's `onOpenChange`
 * prop *directly*, sailing straight past that wrapper. The result was the reported bug: create a
 * project, reopen the composer, and the previous title, summary, description, and property picks
 * were all still sitting there.
 *
 * These tests pin the invariant that replaced that fragile per-field bookkeeping: the composer
 * subtree is remounted on each open, so a fresh open is pristine no matter *how* the previous one
 * ended — success, server error, Esc, backdrop, or discard.
 *
 * @see {@link withComposerReset} for the mechanism under test.
 */
import { OrganizationId, TeamId, type TeamOut } from '@docket/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type JSX, useEffect, useState } from 'react';
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

import { withComposerReset } from '../../src/components/composer/reset-on-open';
import { CreateProjectDialog } from '../../src/components/projects/create-project';
import { jsonResponse } from '../support/http';

// Valid ULID-shaped ids (no I/L/O/U) so the composer's `*.parse(...)` guards accept them.
const ORG_ID = '0RG00000000000000000000001';
const TEAM_ID = 'TEAM0000000000000000000002';
const GRACE_ID = 'GRC00000000000000000000003';

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

beforeEach(() => {
  projectPost.mockReset();
  membersGet.mockReset().mockResolvedValue(jsonResponse(true, { items: MEMBERS }));
  agentsGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  initiativesGet.mockReset().mockResolvedValue(jsonResponse(true, { items: [] }));
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

/**
 * A host that owns `open` exactly the way the real Projects page does — the composer stays mounted
 * across close, and "New project" is the only way back in.
 */
function Host(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        New project
      </button>
      <CreateProjectDialog
        orgId={ORG_ID}
        projectNoun="Project"
        teams={TEAMS}
        defaultTeamId={TEAM_ID}
        teamsLoading={false}
        open={open}
        onOpenChange={setOpen}
        onCreated={() => {
          /* the real page prepends + routes; irrelevant here */
        }}
      />
    </>
  );
}

/** Render the host page harness under a retry-free query client. */
function renderHost(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
}

/** Props for the mount-counting probe used to pin the reset boundary's remount rule. */
interface ProbeProps {
  /** Whether the composer is open (what the boundary keys off). */
  open: boolean;
  /** An unrelated prop, changed to prove ordinary re-renders do not remount. */
  label?: string;
}

/** Click the host's "New project" button. */
function openComposer(): void {
  fireEvent.click(screen.getByRole('button', { name: 'New project' }));
}

/** The composer's title field, which must be empty on every fresh open. */
function titleField(): HTMLInputElement {
  return screen.getByLabelText('Project name');
}

/** The composer's one-line summary field. */
function summaryField(): HTMLInputElement {
  return screen.getByLabelText('One-sentence summary');
}

describe('withComposerReset', () => {
  it('remounts on open and leaves the closing instance alone', () => {
    const mounted = vi.fn();
    const Probe = withComposerReset(function ProbeComposer(): JSX.Element {
      useEffect(() => {
        mounted();
      }, []);
      return <div />;
    });

    const { rerender } = render(<Probe open={false} />);
    expect(mounted).toHaveBeenCalledTimes(1);

    rerender(<Probe open />);
    expect(mounted).toHaveBeenCalledTimes(2);

    // Closing must NOT remount: the dialog is animating out and its content should stay put until
    // Radix removes it. Remounting here would blank the panel mid-transition.
    rerender(<Probe open={false} />);
    expect(mounted).toHaveBeenCalledTimes(2);

    rerender(<Probe open />);
    expect(mounted).toHaveBeenCalledTimes(3);
  });

  it('does not remount on unrelated re-renders while open', () => {
    const mounted = vi.fn();
    const Probe = withComposerReset(function ProbeComposer({ label }: ProbeProps): JSX.Element {
      useEffect(() => {
        mounted();
      }, []);
      return <div>{label}</div>;
    });

    const { rerender } = render(<Probe open label="first" />);
    expect(mounted).toHaveBeenCalledTimes(1);

    // A prop change mid-draft (a roster resolving, a vocabulary noun loading) must not throw the
    // user's in-progress typing away.
    rerender(<Probe open label="second" />);
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(screen.getByText('second')).toBeTruthy();
  });
});

describe('Create composer draft lifetime', () => {
  it('reopens pristine after a successful create', async () => {
    projectPost.mockResolvedValue(jsonResponse(true, { id: 'proj_1', name: 'Atlas' }));
    renderHost();

    openComposer();
    fireEvent.change(titleField(), { target: { value: 'Atlas' } });
    fireEvent.change(summaryField(), { target: { value: 'Re-platform the ingest path' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    // The composer closed itself through the host's `onOpenChange`.
    await waitFor(() => {
      expect(screen.queryByLabelText('Project name')).toBeNull();
    });

    openComposer();
    expect(titleField().value).toBe('');
    expect(summaryField().value).toBe('');
  });

  it('reopens pristine after a failed create', async () => {
    projectPost.mockResolvedValue(jsonResponse(false, { detail: 'Name already used.' }));
    renderHost();

    openComposer();
    fireEvent.change(titleField(), { target: { value: 'Dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    // The failed create keeps the dialog open with the error, so the draft is not lost mid-flight.
    await screen.findByRole('alert');
    expect(titleField().value).toBe('Dup');

    // Dismissing a dirty draft asks first; discarding closes.
    fireEvent.keyDown(titleField(), { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => {
      expect(screen.queryByLabelText('Project name')).toBeNull();
    });

    openComposer();
    expect(titleField().value).toBe('');
    // The stale server error must not greet the next draft either.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reopens with pristine property pickers after a create', async () => {
    projectPost.mockResolvedValue(jsonResponse(true, { id: 'proj_2', name: 'Led' }));
    renderHost();

    openComposer();
    await waitFor(() => {
      expect(membersGet).toHaveBeenCalled();
    });
    fireEvent.change(titleField(), { target: { value: 'Led' } });
    fireEvent.click(screen.getByRole('button', { name: /Lead/ }));
    fireEvent.click(await screen.findByText('Grace Hopper'));
    // The lead pill now reads the chosen actor rather than its placeholder.
    await waitFor(() => {
      expect(screen.queryByText('Set lead')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));
    await waitFor(() => {
      expect(projectPost).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByLabelText('Project name')).toBeNull();
    });

    openComposer();
    // The pill is back to its placeholder — the previous draft's lead did not survive the create.
    expect(screen.getByText('Set lead')).toBeTruthy();
    expect(screen.queryByText('Grace Hopper')).toBeNull();
  });
});

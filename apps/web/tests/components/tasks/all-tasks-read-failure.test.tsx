/**
 * Behavior tests for the three outcomes of the cross-workspace task read.
 *
 * @remarks
 * `/tasks` fans one query out per workspace, so "nothing came back" and "nothing exists" are
 * different facts and the surface has to tell them apart. It used to not: with every read failing,
 * the pending flags settled, the composed list was empty, and the screen rendered
 * **"No tasks assigned to you"** — a confident claim about someone's workload made at the exact
 * moment we could not find out. That is the connector-reliability invariant ("never show success
 * when nothing happened") in a quieter costume, and it is the regression these pin.
 *
 * Three outcomes, three renders: every workspace answered and none had a task → empty state; none
 * answered → failure state with a way to retry; some answered → the rows we have, above a notice
 * that the list may be short.
 */
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { useQueries, useActiveOrg, useSession } = vi.hoisted(() => ({
  useQueries: vi.fn(),
  useActiveOrg: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQueries,
}));

// Imported after the mock factory above so the component and this file share one module instance.
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');

vi.mock('../../../src/components/active-org', () => ({
  useActiveOrg,
}));

// Both entry points the tree reaches for: the namespace object the surface uses, and the bare
// re-export `useOrgCapability` imports on behalf of each rendered row.
vi.mock('../../../src/lib/auth-client', () => ({
  authClient: { useSession },
  useSession,
}));

vi.mock('../../../src/components/athena/athena-context-action', () => ({
  AthenaContextAction: () => null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

import AllTasksClient from '../../../src/app/(app)/tasks/all-tasks-client';

const ORG_A = '01HZZZ00000000000000000RGA';
const ORG_B = '01HZZZ00000000000000000RGB';
const USER_ID = 'user_1';
const ACTOR_A = '01HZZZ000000000000000000AA';

/** A settled TanStack result: not pending, optionally errored, optionally carrying items. */
function result(over: {
  items?: unknown[] | undefined;
  error?: unknown;
  refetch?: (() => void) | undefined;
}): Record<string, unknown> {
  return {
    isPending: false,
    isError: over.error !== undefined,
    error: over.error ?? null,
    data: over.items ? { items: over.items } : undefined,
    refetch: over.refetch ?? vi.fn(),
  };
}

/** A task assigned to the caller in workspace A. */
const MY_TASK = {
  id: '01HZZZ0000000000000000T001',
  organizationId: ORG_A,
  title: 'Ship the launch checklist',
  assigneeId: ACTOR_A,
  state: 'in_progress',
  priority: 'high',
  dueDate: null,
  estimateMinutes: null,
};

/** The member row that maps the signed-in user to their actor id in workspace A. */
const MY_MEMBERSHIP = { userId: USER_ID, actorId: ACTOR_A };

/**
 * Render the surface with one `useQueries` answer for the task fan-out and one for the member
 * fan-out.
 *
 * @remarks
 * Dispatched on the query keys the component passes (`['org', id, 'tasks' | 'members']`) rather
 * than on call order, so a re-render — which React does freely — gets the same answers instead of
 * falling off the end of a `mockReturnValueOnce` queue.
 */
function renderTasks(taskReads: unknown[], memberReads: unknown[]): void {
  useSession.mockReturnValue({ data: { user: { id: USER_ID } } });
  useActiveOrg.mockReturnValue({
    orgs: [
      { id: ORG_A, name: 'Workspace A' },
      { id: ORG_B, name: 'Workspace B' },
    ],
    orgName: (id: string) => (id === ORG_A ? 'Workspace A' : 'Workspace B'),
  });
  useQueries.mockImplementation((arg: { queries: { queryKey: readonly unknown[] }[] }) =>
    arg.queries[0]?.queryKey.includes('members') ? memberReads : taskReads,
  );
  // `TaskRow` reads its own per-org capability through the shared query layer, so a rendered row
  // needs the provider the app mounts in `providers.tsx`.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AllTasksClient />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the cross-workspace task read', () => {
  it('says the list is empty only when every workspace actually answered', () => {
    renderTasks(
      [result({ items: [] }), result({ items: [] })],
      [result({ items: [MY_MEMBERSHIP] }), result({ items: [] })],
    );

    expect(screen.getByText('No tasks assigned to you')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a failure instead of claiming the person has no tasks', () => {
    const failure = new Error('fetch failed');
    renderTasks(
      [result({ error: failure }), result({ error: failure })],
      [result({ error: failure }), result({ error: failure })],
    );

    // The regression: this sentence must not appear when nobody was successfully asked.
    expect(screen.queryByText('No tasks assigned to you')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Your tasks are still there');
    // Application-owned copy only — the provider's own text never reaches the screen.
    expect(alert.textContent).not.toContain('fetch failed');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('retries every read, not just the one that happened to be inspected', () => {
    const failure = new Error('fetch failed');
    const refetches = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    renderTasks(
      [
        result({ error: failure, refetch: refetches[0] }),
        result({ error: failure, refetch: refetches[1] }),
      ],
      [
        result({ error: failure, refetch: refetches[2] }),
        result({ error: failure, refetch: refetches[3] }),
      ],
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    for (const refetch of refetches) expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the rows it has, and says so, when only some workspaces answered', () => {
    renderTasks(
      [result({ items: [MY_TASK] }), result({ error: new Error('fetch failed') })],
      [result({ items: [MY_MEMBERSHIP] }), result({ error: new Error('fetch failed') })],
    );

    // The real row is not hidden behind the failure — partial data is still data.
    expect(screen.getByText('Ship the launch checklist')).toBeInTheDocument();
    // But a short list must not read as a complete one.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Some workspaces did not answer, so this list may be incomplete.',
    );
  });
});

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetcher = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: { v1: { orgs: { ':orgId': { statuses: { $get: fetcher } } } } },
}));

import {
  StatusRegistryProvider,
  useStatusRegistry,
} from '../../../src/components/statuses/status-registry';
import { makeQueryWrapper } from '../../support/query';

/**
 * Unit tests for the workspace status registry.
 *
 * @remarks
 * The property worth pinning is that N consumers cost one request. The registry exists because the
 * alternative — each picker fetching for itself — put a round trip behind every menu open, and a
 * regression there would be invisible in the interface and expensive everywhere.
 */

/** One set in the shape the statuses endpoint returns. */
function set(
  statuses: { key: string; name: string; category: string }[],
  teamId: string | null = null,
) {
  return {
    entityType: 'task',
    teamId,
    forked: teamId !== null,
    statuses: statuses.map((status, index) => ({
      id: `id-${teamId ?? 'ws'}-${status.key}`,
      organizationId: 'org1',
      entityType: 'task',
      teamId,
      key: status.key,
      name: status.name,
      description: null,
      category: status.category,
      position: index,
      isDefault: index === 0,
    })),
  };
}

/** A response shaped like the statuses endpoint's. */
function response(statuses: { key: string; name: string; category: string }[]) {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        items: [
          {
            entityType: 'task',
            teamId: null,
            forked: false,
            statuses: statuses.map((status, index) => ({
              id: `id-${status.key}`,
              organizationId: 'org1',
              entityType: 'task',
              teamId: null,
              key: status.key,
              name: status.name,
              description: null,
              category: status.category,
              position: index,
              isDefault: index === 0,
            })),
          },
        ],
      }),
  };
}

/** A consumer that publishes what the registry told it. */
function Probe({ label }: { label: string }) {
  const statuses = useStatusRegistry();
  return (
    <div>
      <span data-testid={`${label}-count`}>{statuses.statusesFor('task').length}</span>
      <span data-testid={`${label}-first`}>{statuses.statusesFor('task')[0]?.name ?? ''}</span>
      <span data-testid={`${label}-category`}>{statuses.categoryOf('task', 'shipped')}</span>
      <span data-testid={`${label}-unknown`}>{statuses.categoryOf('task', 'nonsense')}</span>
    </div>
  );
}

afterEach(() => {
  cleanup();
  fetcher.mockReset();
});

describe('StatusRegistryProvider', () => {
  it('costs one request however many consumers read it', async () => {
    fetcher.mockResolvedValue(
      response([
        { key: 'icebox', name: 'Icebox', category: 'backlog' },
        { key: 'shipped', name: 'Shipped', category: 'completed' },
      ]),
    );
    const { wrapper: Wrapper } = makeQueryWrapper();

    render(
      <Wrapper>
        <StatusRegistryProvider orgId="org1">
          <Probe label="a" />
          <Probe label="b" />
          <Probe label="c" />
        </StatusRegistryProvider>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('a-first')).toHaveTextContent('Icebox');
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('c-first')).toHaveTextContent('Icebox');
  });

  it('answers from the seeded defaults before the workspace’s own arrive', () => {
    fetcher.mockReturnValue(new Promise(() => undefined));
    const { wrapper: Wrapper } = makeQueryWrapper();

    render(
      <Wrapper>
        <StatusRegistryProvider orgId="org1">
          <Probe label="a" />
        </StatusRegistryProvider>
      </Wrapper>,
    );

    // Five seeded task statuses stand in, so a picker is never empty on first paint.
    expect(screen.getByTestId('a-count')).toHaveTextContent('5');
  });

  it('resolves a renamed status the hardcoded mapping would have got wrong', async () => {
    fetcher.mockResolvedValue(
      response([
        { key: 'icebox', name: 'Icebox', category: 'backlog' },
        { key: 'shipped', name: 'Shipped', category: 'completed' },
      ]),
    );
    const { wrapper: Wrapper } = makeQueryWrapper();

    render(
      <Wrapper>
        <StatusRegistryProvider orgId="org1">
          <Probe label="a" />
        </StatusRegistryProvider>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('a-category')).toHaveTextContent('completed');
    });
  });

  it('reads a key nobody kept as the neutral not-started category', async () => {
    fetcher.mockResolvedValue(response([{ key: 'icebox', name: 'Icebox', category: 'backlog' }]));
    const { wrapper: Wrapper } = makeQueryWrapper();

    render(
      <Wrapper>
        <StatusRegistryProvider orgId="org1">
          <Probe label="a" />
        </StatusRegistryProvider>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('a-unknown')).toHaveTextContent('backlog');
    });
  });

  it('resolves a forked team against its own set rather than the workspace’s', async () => {
    fetcher.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          items: [
            set([
              { key: 'backlog', name: 'Backlog', category: 'backlog' },
              { key: 'done', name: 'Done', category: 'completed' },
            ]),
            set(
              [
                { key: 'doing', name: 'Doing', category: 'started' },
                { key: 'shipped', name: 'Shipped', category: 'completed' },
              ],
              'team1',
            ),
          ],
        }),
    });
    const { wrapper: Wrapper } = makeQueryWrapper();

    function TeamProbe() {
      const statuses = useStatusRegistry();
      return (
        <div>
          <span data-testid="team-doing">{statuses.categoryOf('task', 'doing', 'team1')}</span>
          <span data-testid="ws-doing">{statuses.categoryOf('task', 'doing')}</span>
          <span data-testid="forked">{String(statuses.isForked('team1'))}</span>
          <span data-testid="other">{String(statuses.isForked('team2'))}</span>
        </div>
      );
    }

    render(
      <Wrapper>
        <StatusRegistryProvider orgId="org1">
          <TeamProbe />
        </StatusRegistryProvider>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('team-doing')).toHaveTextContent('started');
    });
    // The same key against the workspace set is a key nobody kept, so it reads as backlog.
    expect(screen.getByTestId('ws-doing')).toHaveTextContent('backlog');
    expect(screen.getByTestId('forked')).toHaveTextContent('true');
    expect(screen.getByTestId('other')).toHaveTextContent('false');
  });

  it('fetches nothing when no workspace is bound', () => {
    const { wrapper: Wrapper } = makeQueryWrapper();

    render(
      <Wrapper>
        <StatusRegistryProvider orgId={null}>
          <Probe label="a" />
        </StatusRegistryProvider>
      </Wrapper>,
    );

    expect(fetcher).not.toHaveBeenCalled();
    expect(screen.getByTestId('a-count')).toHaveTextContent('5');
  });
});

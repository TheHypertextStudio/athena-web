import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';

import { ApiRequestError } from '../../src/lib/query-core';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { graphState, queryState, refetch } = vi.hoisted(() => ({
  graphState: { rendered: 0 },
  queryState: {
    data: undefined as undefined | { items: readonly unknown[] },
    isPending: false,
    isError: false,
    isFetching: false,
    error: undefined as Error | undefined,
  },
  refetch: vi.fn(() => Promise.resolve({ data: { items: [] } })),
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    (() => {
      graphState.rendered += 1;
      return <div>Project graph</div>;
    }) as ComponentType<Record<string, unknown>>,
}));

vi.mock('../../src/lib/fetch-project-overview', () => ({
  projectOverviewDef: (organizationId: string) => ({ queryKey: ['projects', organizationId] }),
}));

vi.mock('../../src/lib/query', () => ({
  useApiQuery: () => ({ ...queryState, refetch }),
}));

import { ProjectDependencyLens } from '../../src/components/work-views/project-dependency-lens';

function renderLens(onRetry = vi.fn()): { readonly onRetry: ReturnType<typeof vi.fn> } {
  render(<ProjectDependencyLens organizationId="org_alpha" title="Projects" onRetry={onRetry} />);
  return { onRetry };
}

beforeEach(() => {
  graphState.rendered = 0;
  queryState.data = undefined;
  queryState.isPending = false;
  queryState.isError = false;
  queryState.isFetching = false;
  queryState.error = undefined;
  refetch.mockClear();
});

describe('ProjectDependencyLens failure states', () => {
  it('yields the content area to a recoverable state when the lens has nothing to show', () => {
    queryState.isError = true;
    queryState.error = new ApiRequestError({ message: 'x', status: 0 });

    const { onRetry } = renderLens();

    const recovery = screen.getByRole('alert');
    expect(recovery).toBeInTheDocument();
    expect(graphState.rendered).toBe(0);

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button'));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('routes recovery through the host so every failed read on the surface is repaired', () => {
    queryState.isError = true;
    queryState.error = new ApiRequestError({ message: 'x', status: 0 });

    const { onRetry } = renderLens();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button'));

    // The lens must not quietly repair only its own query: the reads behind this surface fail
    // together, and a local refetch would leave the rest broken behind a recovered-looking page.
    expect(onRetry).toHaveBeenCalledOnce();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('keeps a readable graph on screen when a refresh fails', () => {
    queryState.data = { items: [] };
    queryState.isError = true;
    queryState.error = new ApiRequestError({ message: 'x', status: 0 });

    renderLens();

    expect(graphState.rendered).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a placeholder rather than a failure while the first load is still running', () => {
    queryState.isPending = true;

    renderLens();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(graphState.rendered).toBe(0);
  });
});

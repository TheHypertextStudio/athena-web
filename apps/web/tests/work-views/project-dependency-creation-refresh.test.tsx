import '@testing-library/jest-dom/vitest';

import { render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { graphState, refetch } = vi.hoisted(() => ({
  graphState: { props: null as null | Record<string, unknown> },
  refetch: vi.fn(() => Promise.resolve({ data: { items: [] } })),
}));

vi.mock('next/dynamic', () => ({
  default: () =>
    ((props: Record<string, unknown>) => {
      graphState.props = props;
      return <div>Project graph</div>;
    }) as ComponentType<Record<string, unknown>>,
}));

vi.mock('../../src/lib/fetch-project-overview', () => ({
  projectOverviewDef: (organizationId: string) => ({ queryKey: ['projects', organizationId] }),
}));

vi.mock('../../src/lib/query', () => ({
  useApiQuery: () => ({
    data: { items: [] },
    isPending: false,
    isError: false,
    refetch,
  }),
}));

import { ProjectDependencyLens } from '../../src/components/work-views/project-dependency-lens';

const PROJECT_ID = '01K3CQWKHQ3GXESM7K1YS55P9C';

beforeEach(() => {
  graphState.props = null;
  refetch.mockClear();
});

describe('ProjectDependencyLens creation refresh', () => {
  it('refetches the same created id again when the host advances its retry attempt', async () => {
    const rendered = render(
      <ProjectDependencyLens
        organizationId="org_alpha"
        requestedSelectionId={PROJECT_ID}
        requestedSelectionAttempt={0}
      />,
    );

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(1);
      expect(graphState.props).toMatchObject({
        requestedSelectionId: PROJECT_ID,
        requestedSelectionSettled: true,
      });
    });

    rendered.rerender(
      <ProjectDependencyLens
        organizationId="org_alpha"
        requestedSelectionId={PROJECT_ID}
        requestedSelectionAttempt={1}
      />,
    );

    await waitFor(() => {
      expect(refetch).toHaveBeenCalledTimes(2);
      expect(graphState.props).toMatchObject({
        requestedSelectionId: PROJECT_ID,
        requestedSelectionSettled: true,
      });
    });
  });
});

import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonConsolidationControl } from '@/components/people/person-consolidation-control';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), merge: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          members: {
            ':actorId': {
              'consolidation-preview': { $post: mocks.preview },
              consolidate: { $post: mocks.merge },
            },
          },
        },
      },
    },
  },
}));
vi.mock('@/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ replace: mocks.navigate }),
}));
vi.mock('@/components/people/people-queries', () => ({ peopleQuery: () => ({}) }));
vi.mock('@/lib/query', async () => {
  const { useState } = await import('react');
  return {
    useApiListQuery: () => ({
      data: {
        items: [
          { actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', displayName: 'Sam duplicate', userId: null },
          { actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAW', displayName: 'Sam Rivera', userId: 'account' },
        ],
      },
    }),
    unwrap: (read: () => Promise<unknown>) => read(),
    useApiMutation: ({ mutationFn }: { mutationFn: (value: string) => Promise<unknown> }) => {
      const [data, setData] = useState<unknown>();
      return {
        data,
        isPending: false,
        reset: () => {
          setData(undefined);
        },
        mutateAsync: async (value: string) => {
          const result = await mutationFn(value);
          setData(result);
          return result;
        },
      };
    },
  };
});

describe('person consolidation review', () => {
  it('requires a preview before confirmation and submits that preview token', async () => {
    mocks.preview.mockResolvedValue({
      sourceName: 'Sam duplicate',
      survivorName: 'Sam Rivera',
      assignments: 3,
      projects: 1,
      initiatives: 0,
      programs: 0,
      linkedIdentities: [],
      previewRevision: 'reviewed-version',
    });
    mocks.merge.mockResolvedValue({});
    render(<PersonConsolidationControl orgId="org" actorId="01ARZ3NDEKTSV4RRFFQ69G5FAV" />);
    fireEvent.click(screen.getByRole('button', { name: 'Combine duplicate person' }));
    expect(screen.queryByRole('button', { name: 'Confirm combination' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Person to keep' }), {
      target: { value: '01ARZ3NDEKTSV4RRFFQ69G5FAW' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review combination' }));
    expect(mocks.merge).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm combination' }));
    await waitFor(() => {
      expect(mocks.merge).toHaveBeenCalledWith({
        param: { orgId: 'org', actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        json: {
          survivorActorId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
          previewRevision: 'reviewed-version',
        },
      });
    });
    expect(mocks.navigate).toHaveBeenCalledWith('/orgs/org/people/01ARZ3NDEKTSV4RRFFQ69G5FAW');
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { TemplateTailoringPanel } from '@/components/templates/gallery/template-tailoring-panel';
const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  request: vi.fn(),
  replace: vi.fn(),
  retry: vi.fn(),
}));
vi.mock('@/lib/app-location', () => ({ useAppSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('@/lib/query', () => ({
  useApiQuery: () => ({
    data: {
      availability: 'available',
      conversations: [{ id: 'conversation', label: 'Neighborhood planning' }],
      importedWork: [{ id: 'import', label: 'Volunteer welcome' }],
    },
    isError: false,
    refetch: vi.fn(),
  }),
  useLiveApiQuery: () => ({
    data: { sessionId: 'saved-request', status: 'pending', proposalIds: [] },
    isError: false,
  }),
}));
vi.mock('@/components/templates/gallery/template-tailoring-queries', () => ({
  tailoringSourcesDef: () => ({}),
  tailoringStatusDef: () => ({}),
  useTailoringPreview: () => useMutation({ mutationFn: mocks.preview }),
  useTailoringRequest: () => useMutation({ mutationFn: mocks.request }),
  useTailoringRetry: () => useMutation({ mutationFn: mocks.retry }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockResolvedValue({
    fingerprint: 'checked-context',
    conversationCount: 0,
    importedWorkCount: 1,
  });
  mocks.request.mockResolvedValue({
    sessionId: 'saved-request',
    status: 'pending',
    proposalIds: [],
  });
});
function open() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TemplateTailoringPanel orgId="org" fork="nonprofit" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ask Athena to tailor this' }));
}
it('reviews actual selected context before generation and invalidates that checkpoint when selection changes', async () => {
  open();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Neighborhood planning' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected context' }));
  await screen.findByRole('button', { name: 'Ask Athena' });
  expect(mocks.preview).toHaveBeenCalledWith(
    { fork: 'nonprofit', sessionIds: ['conversation'], importedTaskIds: [] },
    expect.anything(),
  );
  expect(mocks.request).not.toHaveBeenCalled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Change selection' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Neighborhood planning' }));
  expect(screen.queryByRole('button', { name: 'Ask Athena' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Volunteer welcome' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected context' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Athena' }));
  await waitFor(() => {
    expect(mocks.request).toHaveBeenCalledWith(
      {
        fork: 'nonprofit',
        sessionIds: [],
        importedTaskIds: ['import'],
        fingerprint: 'checked-context',
      },
      expect.anything(),
    );
  });
  await screen.findByText('Athena is preparing a proposal from your selected saved context.');
  expect(mocks.replace).toHaveBeenCalledWith(
    '/orgs/org/work-templates/gallery?fork=nonprofit&tailoring=saved-request',
    { scroll: false },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose other context' }));
  expect(mocks.replace).toHaveBeenLastCalledWith(
    '/orgs/org/work-templates/gallery?fork=nonprofit',
    { scroll: false },
  );
});
it('keeps a failed generation request honest and retryable without inventing a ready proposal', async () => {
  mocks.request.mockRejectedValue(new Error('provider diagnostic must stay private'));
  open();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Neighborhood planning' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected context' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Athena' }));
  await screen.findByText(
    'This request could not be started. Try again; the saved request will be reused.',
  );
  expect(screen.getByRole('region', { name: 'Review needed' })).toHaveFocus();
  expect(screen.queryByText('provider diagnostic must stay private')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Review proposed template' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review selected context' })).toBeVisible();
});

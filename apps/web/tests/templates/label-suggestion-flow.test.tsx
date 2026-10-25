import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { ContextProvider } from '@docket/ui/components';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LabelSuggestionPage } from '@/components/templates/label-suggestions/page';
const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  request: vi.fn(),
  replace: vi.fn(),
  retry: vi.fn(),
  user: 'person',
  sourceAvailable: true,
  availability: 'available',
  reads: vi.fn(),
}));
const id = (last: string) => `01ARZ3NDEKTSV4RRFFQ69G5FA${last}`;
const orgId = id('V'),
  groupId = id('W'),
  labelId = id('X'),
  workId = id('Y'),
  requestId = id('Z');
vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/components/active-org', () => ({ useOptionalActiveOrg: () => ({ orgs: [] }) }));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: mocks.user }, session: { id: 'session' } } }),
}));
vi.mock('@/lib/interactions/navigation', () => ({
  useAppRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('@/components/templates/label-suggestions/queries', () => ({
  labelSuggestionSourcesDef: () => ({ queryKey: ['label-suggestion-sources'] }),
  useLabelSuggestionPreview: () => useMutation({ mutationFn: mocks.preview }),
  useLabelSuggestionRequest: () => useMutation({ mutationFn: mocks.request }),
}));
vi.mock('@/components/templates/gallery/template-tailoring-queries', () => ({
  tailoringStatusDef: (_org: string, request: string) => ({ queryKey: ['tailoring', request] }),
  useTailoringRetry: () => useMutation({ mutationFn: mocks.retry }),
}));
vi.mock('@/lib/query', async (original) => ({
  ...(await original<object>()),
  useApiQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    mocks.reads(queryKey);
    const data = queryKey.includes('label-suggestion-sources')
      ? {
          availability: mocks.availability,
          groups: [{ id: mocks.sourceAvailable ? groupId : id('T'), name: 'Work kind' }],
          labels: mocks.sourceAvailable ? [{ id: labelId, groupId, name: 'Event' }] : [],
        }
      : {
          rows: [{ id: workId, target: 'task', title: 'Welcome volunteers', isContext: false }],
          nextCursor: null,
        };
    return { data, isPending: false, isError: false, refetch: vi.fn() };
  },
  useLiveApiQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data: { sessionId: queryKey.at(-1), status: 'pending', proposalIds: [] },
    isError: false,
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = 'person';
  mocks.sourceAvailable = true;
  mocks.availability = 'available';
  mocks.preview.mockResolvedValue({
    fingerprint: 'a'.repeat(64),
    labelGroup: { id: groupId, name: 'Work kind' },
    label: { id: labelId, name: 'Event' },
    work: [{ id: workId, kind: 'task', name: 'Welcome volunteers' }],
  });
  mocks.request.mockResolvedValue({ sessionId: requestId, status: 'pending', proposalIds: [] });
});
afterEach(cleanup);
function page() {
  return (
    <ContextProvider>
      <QueryClientProvider client={new QueryClient()}>
        <LabelSuggestionPage orgId={orgId} requestId="" />
      </QueryClientProvider>
    </ContextProvider>
  );
}
function choose(): void {
  fireEvent.change(screen.getByLabelText('Label group'), { target: { value: groupId } });
  fireEvent.change(screen.getByLabelText('Label'), { target: { value: labelId } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Welcome volunteers' }));
}
it('reviews only explicit examples before generation and resumes the real saved request', async () => {
  render(page());
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  choose();
  expect(mocks.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Review selected examples' }));
  const ask = await screen.findByRole('button', { name: 'Ask Athena' });
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByText(/Your existing work and labels stay as they are/)).toBeVisible();
  expect(mocks.preview).toHaveBeenCalledWith(
    { labelGroupId: groupId, labelId, kind: 'task', workIds: [workId] },
    expect.anything(),
  );
  fireEvent.click(ask);
  await waitFor(() => {
    expect(mocks.request).toHaveBeenCalledWith(
      {
        labelGroupId: groupId,
        labelId,
        kind: 'task',
        workIds: [workId],
        fingerprint: 'a'.repeat(64),
      },
      expect.anything(),
    );
  });
  expect(mocks.replace).toHaveBeenCalledWith(
    `/orgs/${orgId}/work-templates/suggest-from-labels?requestId=${requestId}`,
    { scroll: false },
  );
  await screen.findByText('Athena is preparing a proposal from your selected saved context.');
});
it('invalidates the reviewed checkpoint when the person changes examples', async () => {
  render(page());
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Review selected examples' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Change examples' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Welcome volunteers' }));
  expect(screen.queryByRole('button', { name: 'Ask Athena' })).not.toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalled();
});
it('keeps failure copy owned and focused without inventing a completed proposal', async () => {
  mocks.request.mockRejectedValue(new Error('private provider diagnostic'));
  render(page());
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Review selected examples' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Ask Athena' }));
  await screen.findByText(
    'This request could not be started. Try again; the saved request will be reused.',
  );
  expect(screen.getByRole('region', { name: 'Review needed' })).toHaveFocus();
  expect(screen.queryByText('private provider diagnostic')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Review proposed template' })).not.toBeInTheDocument();
});
it('discards the reviewed checkpoint when its label access is revoked', async () => {
  const view = render(page());
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Review selected examples' }));
  await screen.findByRole('button', { name: 'Ask Athena' });
  mocks.sourceAvailable = false;
  view.rerender(page());
  expect(screen.queryByRole('checkbox', { name: 'Welcome volunteers' })).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Review selected examples' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText('That label is no longer available. Choose another label to continue.'),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Ask Athena' })).not.toBeInTheDocument();
  mocks.sourceAvailable = true;
  view.rerender(page());
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Ask Athena' })).not.toBeInTheDocument();
});
it('resets private choices on an account change and keeps the manual gallery available on Free', () => {
  const view = render(page());
  choose();
  mocks.user = 'another-person';
  view.rerender(page());
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  mocks.availability = 'requires_pro';
  view.rerender(page());
  expect(screen.getByText(/Docket Pro/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Browse starting points' })).toBeVisible();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

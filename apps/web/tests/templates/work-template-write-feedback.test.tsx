import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkTemplateCreate } from '@docket/work/work-template-contract';
import { useWorkTemplateWrites } from '@/components/templates/work-template-queries';

const mocks = vi.hoisted(() => ({ create: vi.fn(), archive: vi.fn(), present: vi.fn() }));
vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          templates: {
            definitions: {
              $post: mocks.create,
              ':id': { archive: { $post: mocks.archive } },
            },
          },
        },
      },
    },
  },
}));
vi.mock('@/components/feedback/failure-toast', () => ({ presentFailure: mocks.present }));

const input = WorkTemplateCreate.parse({
  targetType: 'project',
  scope: 'personal',
  definition: {
    name: 'Accounts review',
    payload: { targetType: 'project' },
  },
});
function Probe({ inline }: { inline: boolean }) {
  const writes = useWorkTemplateWrites('workspace', inline ? 'silent' : undefined);
  const [failed, setFailed] = useState(false);
  return (
    <>
      <button
        onClick={() => {
          void (
            inline ? writes.create.mutateAsync(input) : writes.archive.mutateAsync('template')
          ).catch(() => {
            setFailed(true);
          });
        }}
      >
        Save
      </button>
      {failed ? <p role="alert">The draft is still here.</p> : null}
    </>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  const failure = () =>
    Promise.resolve(
      new Response(JSON.stringify({ type: 'about:blank', status: 503 }), {
        status: 503,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
  mocks.create.mockImplementation(failure);
  mocks.archive.mockImplementation(failure);
});
afterEach(cleanup);
function renderProbe(inline: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe inline={inline} />
    </QueryClientProvider>,
  );
}
it('lets the draft owner present a failed write without a second retry notice', async () => {
  renderProbe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await expect(screen.findByRole('alert')).resolves.toHaveTextContent('The draft is still here.');
  expect(mocks.present).not.toHaveBeenCalled();
});
it('keeps the shared failure notice for callers without an inline owner', async () => {
  renderProbe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(mocks.present).toHaveBeenCalledTimes(1);
  });
});

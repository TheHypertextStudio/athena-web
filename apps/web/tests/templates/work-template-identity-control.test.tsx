import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkTemplateIdentityControl } from '@/components/templates/work-template-identity-control';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  invalidate: vi.fn(),
  isError: false,
  fetchNext: vi.fn(),
  hasNext: false,
  previewError: false,
  previewPending: false,
}));
const event = {
  id: 'event',
  name: 'Event',
  icon: null,
  isBase: false,
  archived: false,
  versionNumber: 1,
  latestVersionNumber: 2,
};
const choice = {
  ...event,
  id: 'meeting',
  name: 'Meeting',
  versionId: 'meeting-v2',
  versionNumber: 2,
};
vi.mock('@/components/templates/work-template-identity-queries', () => ({
  workTemplateIdentityDef: () => ({ identity: true }),
  workTemplateChoicesDef: () => ({ choices: true }),
  workTemplateChangePreviewDef: () => ({ preview: true }),
  useWorkTemplateAssignment: () => ({
    mutate: mocks.mutate,
    reset: mocks.reset,
    isPending: false,
    isError: mocks.isError,
  }),
}));
vi.mock('@/lib/query', () => ({
  useInfiniteApiQuery: () => ({
    data: { pages: [{ items: [choice] }] },
    isPending: false,
    isError: false,
    hasNextPage: mocks.hasNext,
    isFetchingNextPage: false,
    fetchNextPage: mocks.fetchNext,
    refetch: vi.fn(),
  }),
  useApiQuery: (def: { identity?: boolean; preview?: boolean }) => ({
    data: def.identity
      ? event
      : def.preview
        ? {
            workTypeId: 'meeting',
            workTypeVersionId: 'meeting-v2',
            previewToken: 'sha256:reviewed',
            changes: [
              {
                field: 'description',
                label: 'Starting document',
                before: 'My existing notes',
                after: '## Meeting outline',
              },
              { field: 'health', label: 'Health', before: null, after: 'on_track' },
            ],
          }
        : { items: [choice] },
    isPending: def.preview ? mocks.previewPending : false,
    isError: def.preview ? mocks.previewError : false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
const props = {
  orgId: 'org',
  kind: 'project' as const,
  workId: 'project',
  teamId: null,
  workTypeId: 'event',
  workTypeVersionId: 'event-v1',
};
beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.isError = false;
  mocks.hasNext = false;
  mocks.fetchNext.mockReset();
  mocks.previewError = false;
  mocks.previewPending = false;
});

describe('existing work template header', () => {
  it('shows the pinned name/version to viewers without a change action', () => {
    render(<WorkTemplateIdentityControl {...props} canEdit={false} />);
    expect(screen.getByText('Event')).toBeVisible();
    expect(screen.getByText('Version 1')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Change template' })).not.toBeInTheDocument();
  });

  it('previews identity-only changes before submitting exactly the chosen publication', async () => {
    render(<WorkTemplateIdentityControl {...props} canEdit />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Change template:/ }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Meeting/ }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Your description, dates and child work stay unchanged.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change template' }));
    await waitFor(() => {
      expect(mocks.mutate).toHaveBeenCalledWith(
        {
          workTypeId: 'meeting',
          workTypeVersionId: 'meeting-v2',
          previewToken: 'sha256:reviewed',
          applyFields: [],
        },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      );
    });
  });

  it('offers the next metadata page without losing loaded choices', async () => {
    mocks.hasNext = true;
    render(<WorkTemplateIdentityControl {...props} canEdit />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Change template:/ }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'More templates…' }));
    expect(mocks.fetchNext).toHaveBeenCalledOnce();
    expect(screen.getByRole('menuitem', { name: /Meeting/ })).toBeVisible();
  });

  it('keeps a failed preview and offers application-owned retry copy', async () => {
    mocks.isError = true;
    render(<WorkTemplateIdentityControl {...props} canEdit />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Change template:/ }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Meeting/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not change the template. Try again.',
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('Meeting');
  });
  it('keeps starting differences off and submits only individually selected changes', async () => {
    render(<WorkTemplateIdentityControl {...props} canEdit />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Change template:/ }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Meeting/ }));
    const document = screen.getByRole('checkbox', { name: 'Starting document' });
    expect(document).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Health' })).not.toBeChecked();
    expect(screen.getByText('My existing notes')).toBeVisible();
    expect(screen.getByText('Meeting outline')).toBeVisible();
    fireEvent.click(document);
    fireEvent.click(screen.getByRole('button', { name: 'Change template' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      {
        workTypeId: 'meeting',
        workTypeVersionId: 'meeting-v2',
        previewToken: 'sha256:reviewed',
        applyFields: ['description'],
      },
      expect.any(Object),
    );
  });

  it('disables acceptance when the publication preview cannot be loaded', async () => {
    mocks.previewError = true;
    render(<WorkTemplateIdentityControl {...props} canEdit />);
    fireEvent.pointerDown(screen.getByRole('button', { name: /^Change template:/ }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Meeting/ }));
    expect(screen.getByRole('button', { name: 'Change template' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry preview' })).toBeVisible();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});

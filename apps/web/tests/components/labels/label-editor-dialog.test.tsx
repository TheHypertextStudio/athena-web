import '@testing-library/jest-dom/vitest';

import { Toaster, dismissAllNotices } from '@docket/ui/components';
import { LabelOut } from '@docket/work/label-contract';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse, problemResponse } from '../../support/query';

const { labelsPost, labelsPatch } = vi.hoisted(() => ({
  labelsPost: vi.fn(),
  labelsPatch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          labels: {
            $post: labelsPost,
            ':id': { $patch: labelsPatch },
          },
        },
      },
    },
  },
}));

import { LabelEditorDialog } from '@/components/labels/label-editor-dialog';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

const BUG = LabelOut.parse({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FB8',
  organizationId: ORG_ID,
  name: 'Bug',
  color: 'red',
  group: null,
  teamId: null,
  createdAt: '2026-07-06T00:00:00.000Z',
});

afterEach(() => {
  dismissAllNotices();
  cleanup();
  labelsPost.mockReset();
  labelsPatch.mockReset();
});

/** The dialog open on a new label, with the notice stack mounted beside it. */
function renderNewLabel(labels: readonly LabelOut[], onOpenChange = vi.fn()): JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <LabelEditorDialog
        orgId={ORG_ID}
        label={null}
        labels={labels}
        open
        onOpenChange={onOpenChange}
      />
      <Toaster />
    </QueryClientProvider>
  );
}

describe('LabelEditorDialog', () => {
  it('asks for a name under the control and marks the control invalid', () => {
    render(renderNewLabel([]));

    fireEvent.click(screen.getByRole('button', { name: 'Create label' }));

    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(labelsPost).not.toHaveBeenCalled();
  });

  it('points out a duplicate name before any request is made', () => {
    render(renderNewLabel([BUG]));

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'bug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create label' }));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
    expect(labelsPost).not.toHaveBeenCalled();
  });

  it('clears the field error once a valid name is submitted', async () => {
    labelsPost.mockResolvedValue(okResponse(BUG));
    render(renderNewLabel([]));

    fireEvent.click(screen.getByRole('button', { name: 'Create label' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Needs review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create label' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'false');
    await waitFor(() => {
      expect(labelsPost).toHaveBeenCalledTimes(1);
    });
  });

  it('presents a refused create as a notice and keeps the dialog open', async () => {
    labelsPost.mockResolvedValue(problemResponse('server detail', 500, 'internal'));
    const onOpenChange = vi.fn();
    render(renderNewLabel([], onOpenChange));

    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Needs review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create label' }));

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/server detail/);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'false');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

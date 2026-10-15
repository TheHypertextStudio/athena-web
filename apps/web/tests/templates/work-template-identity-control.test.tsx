import userEvent from '@testing-library/user-event';
import { UserFacingError } from '@/lib/problem';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WorkTemplateChildChange,
  type WorkTemplateChangeRequest,
} from '@docket/work/work-template-reference';
import type { BlueprintPreviewWarning } from '@docket/work/work-template-blueprint';
import { WorkTemplateIdentityControl } from '@/components/templates/work-template-identity-control';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  invalidate: vi.fn(),
  isError: false,
  error: undefined as UserFacingError | undefined,
  fetchNext: vi.fn(),
  hasNext: false,
  previewError: false,
  previewPending: false,
  previewToken: 'sha256:reviewed',
  versionNumber: 2,
  children: [] as WorkTemplateChildChange[],
  warnings: [] as BlueprintPreviewWarning[],
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
  workTemplateChangePreviewDef: (
    _org: unknown,
    _kind: unknown,
    _id: unknown,
    selection: WorkTemplateChangeRequest | null,
  ) => ({ preview: true, mode: selection?.mode }),
  useWorkTemplateAssignment: () => ({
    mutate: mocks.mutate,
    reset: mocks.reset,
    isPending: false,
    isError: mocks.isError,
    error: mocks.error,
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
  useApiQuery: (def: { identity?: boolean; preview?: boolean; mode?: string }) => ({
    data: def.identity
      ? event
      : def.preview
        ? {
            workTypeId: 'meeting',
            workTypeVersionId: 'meeting-v2',
            previewToken: mocks.previewToken,
            versionNumber: mocks.versionNumber,
            mode: def.mode ?? 'change',
            childChanges: mocks.children,
            warnings: mocks.warnings,
            changes:
              def.mode === 'update'
                ? []
                : [
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
  mocks.error = undefined;
  mocks.hasNext = false;
  mocks.fetchNext.mockReset();
  mocks.previewError = false;
  mocks.previewPending = false;
  mocks.previewToken = 'sha256:reviewed';
  mocks.versionNumber = 2;
  mocks.children = [];
  mocks.warnings = [];
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
  it('offers an explicit update review and submits individually chosen child changes', () => {
    mocks.children = [
      WorkTemplateChildChange.parse({
        changeId: 'bp_1111111111111111',
        kind: 'set_derived_date',
        path: ['prep'],
        title: 'Preparation',
        field: 'dueDate',
        previous: '2027-02-09',
        value: '2027-02-07',
        rule: { kind: 'none' },
        selectedByDefault: false,
      }),
      WorkTemplateChildChange.parse({
        changeId: 'bp_2222222222222222',
        kind: 'cancel_removed_child',
        path: ['old'],
        title: 'Old preparation',
        selectedByDefault: false,
      }),
    ];
    render(<WorkTemplateIdentityControl {...props} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Update template' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Update template');
    expect(screen.getByRole('checkbox', { name: 'Due date for Preparation' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Cancel Old preparation' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Due date for Preparation' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Update template' }),
    );
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'update',
        applyFields: [],
        acceptChildChanges: ['bp_1111111111111111'],
      }),
      expect.any(Object),
    );
  });

  it('explains omitted reusable defaults before accepting newly added work', () => {
    mocks.warnings = [{ code: 'label_unavailable', paths: [['review']], count: 1 }];
    render(<WorkTemplateIdentityControl {...props} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Update template' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Unavailable labels are omitted from newly added work.',
    );
  });

  it('shows the exact reviewed publication when the catalog advanced beyond the cached header', () => {
    mocks.versionNumber = 3;
    render(<WorkTemplateIdentityControl {...props} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Update template' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Version 3');
  });

  it('retains a reviewed date choice when a failed review is refreshed with a new token', async () => {
    mocks.children = [
      WorkTemplateChildChange.parse({
        changeId: 'bp_1111111111111111',
        kind: 'set_derived_date',
        path: ['prep'],
        title: 'Preparation',
        field: 'dueDate',
        previous: '2027-02-09',
        value: '2027-02-07',
        rule: { kind: 'none' },
        selectedByDefault: false,
      }),
    ];
    const rendered = render(<WorkTemplateIdentityControl {...props} canEdit />);
    fireEvent.click(screen.getByRole('button', { name: 'Update template' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Due date for Preparation' }));
    mocks.isError = true;
    mocks.error = new UserFacingError('Provider-private diagnostic', {
      status: 409,
      code: 'blueprint_preview_stale',
    });
    rendered.rerender(<WorkTemplateIdentityControl {...props} canEdit />);
    expect(screen.getByRole('alert')).toHaveTextContent('your choices are kept');
    expect(screen.queryByText('Provider-private diagnostic')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Update template' }),
    ).toBeDisabled();
    mocks.isError = false;
    mocks.previewToken = 'sha256:refreshed';
    mocks.children = mocks.children.map((change) => ({
      ...change,
      changeId: 'bp_3333333333333333',
    }));
    rendered.rerender(<WorkTemplateIdentityControl {...props} canEdit />);
    expect(screen.getByRole('checkbox', { name: 'Due date for Preparation' })).toBeChecked();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Update template' }),
    );
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        previewToken: 'sha256:refreshed',
        acceptChildChanges: ['bp_3333333333333333'],
      }),
      expect.any(Object),
    );
  });
  it('lets keyboard users decline a default addition while optional work starts unchecked', async () => {
    const addition = (key: string, selected: boolean, changeId: string) =>
      WorkTemplateChildChange.parse({
        changeId,
        kind: 'add_child',
        path: [key],
        count: 1,
        selectedByDefault: selected,
        children: [
          {
            path: [key],
            parentPath: [],
            kind: 'task',
            title: key,
            workTypeId: null,
            workTypeVersionId: null,
            dates: {},
            unresolvedReasons: {},
            optional: !selected,
            selectedByDefault: selected,
            selected,
            prerequisites: [],
          },
        ],
      });
    mocks.children = [
      addition('review', true, 'bp_1111111111111111'),
      addition('optional', false, 'bp_2222222222222222'),
    ];
    const parent = mocks.children[0];
    if (parent?.kind !== 'add_child') throw new Error('Addition fixture missing');
    parent.children.push({
      ...parent.children[0],
      path: ['review', 'optional'],
      parentPath: ['review'],
      kind: 'task',
      title: 'Nested optional',
      workTypeId: null,
      workTypeVersionId: null,
      dates: {},
      unresolvedReasons: {},
      optional: true,
      selectedByDefault: false,
      selected: false,
      prerequisites: [],
    });
    const user = userEvent.setup();
    render(<WorkTemplateIdentityControl {...props} canEdit />);
    await user.click(screen.getByRole('button', { name: 'Update template' }));
    const added = screen.getByRole('checkbox', { name: 'Add review (1 item)' });
    expect(added).toBeChecked();
    expect(screen.getByText('Optional · Not included')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Add optional (1 item)' })).not.toBeChecked();
    added.focus();
    await user.keyboard('[Space]');
    expect(added).not.toBeChecked();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Update template' }),
    );
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'update', applyFields: [] }),
      expect.any(Object),
    );
    expect(mocks.mutate.mock.calls[0]?.[0]).not.toHaveProperty('acceptChildChanges');
  });
});

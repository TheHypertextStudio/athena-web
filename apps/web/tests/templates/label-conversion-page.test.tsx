import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextProvider } from '@docket/ui/components';
import type { ComponentProps } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import {
  WorkTemplateOut,
  WorkTemplateVersionOut,
  LabelTemplateConversionReview,
  LabelTemplateConversionChoices,
} from '@docket/work/work-template-contract';
import { LabelConversionPage } from '@/components/templates/label-conversion/page';
const mocks = vi.hoisted(() => ({
  reads: vi.fn(),
  review: null as LabelTemplateConversionReview | null,
  phase: 'ready',
  receipt: null as null | { changeSetId: string; state: 'converted'; itemCount: number },
  prepare: vi.fn(),
  confirm: vi.fn(),
  back: vi.fn(),
  sourceAvailable: true,
  choices: null as LabelTemplateConversionChoices | null,
}));
vi.mock('@/components/docket-link', () => ({
  default: ({
    navigation: _navigation,
    ...props
  }: ComponentProps<'a'> & { navigation?: string }) => <a {...props} />,
}));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'person' }, session: { id: 'session' } } }),
}));
vi.mock('@/components/active-org', () => ({ useOptionalActiveOrg: () => ({ orgs: [] }) }));
vi.mock('@/components/templates/label-conversion/use-command', () => ({
  useConversionCommand: () => ({
    owner: 'person',
    phase: mocks.phase,
    ready: mocks.phase === 'ready',
    pending: false,
    error: null,
    receipt: mocks.receipt,
    review: mocks.review,
    choices: mocks.choices,
    prepareReview: mocks.prepare,
    confirm: mocks.confirm,
    back: mocks.back,
    reset: vi.fn(),
    undo: vi.fn(),
  }),
}));
const id = (last: string) => `01ARZ3NDEKTSV4RRFFQ69G5FA${last}`;
const orgId = id('V'),
  templateId = id('W'),
  versionId = id('X'),
  groupId = id('Y'),
  labelId = id('Z'),
  workId = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const version = WorkTemplateVersionOut.parse({
  id: versionId,
  workTypeId: templateId,
  organizationId: orgId,
  number: 1,
  definition: { name: 'Event', payload: { targetType: 'project' } },
  publishedAt: '2026-10-25T12:00:00Z',
  publishedByActorId: null,
});
const template = WorkTemplateOut.parse({
  id: templateId,
  organizationId: orgId,
  targetType: 'project',
  scope: 'personal',
  ownerActorId: null,
  teamId: null,
  status: 'published',
  isBase: false,
  revision: 2,
  definition: { name: 'New name in the draft', payload: { targetType: 'project' } },
  latestVersion: version,
  offeredTeamIds: [],
  canEdit: true,
  createdAt: '2026-10-25T12:00:00Z',
  updatedAt: '2026-10-25T12:00:00Z',
});
vi.mock('@/lib/query', async (original) => ({
  ...(await original<object>()),
  useApiQuery: (definition: { queryKey: readonly unknown[] }) => {
    const key = definition.queryKey;
    mocks.reads(key);
    let data: unknown;
    if (key.includes('label-suggestion-sources'))
      data = {
        availability: 'available',
        groups: mocks.sourceAvailable
          ? [
              { id: groupId, name: 'Type' },
              { id: orgId, name: 'Original type' },
            ]
          : [],
        labels: mocks.sourceAvailable
          ? [
              { id: labelId, groupId, name: 'Event label' },
              { id: templateId, groupId: orgId, name: 'Original label' },
            ]
          : [],
      };
    else if (key.includes('versions')) data = { items: [version] };
    else if (key.includes('definition')) data = template;
    else if (key.includes('label-groups')) data = { items: [{ id: groupId, name: 'Type' }] };
    else if (key.includes('labels'))
      data = { items: [{ id: labelId, groupId, name: 'Event label' }] };
    else
      data = {
        rows: [
          { id: workId, target: 'project', name: 'Community dinner', isContext: false },
          { id: 'context', target: 'project', name: 'Ancestor context', isContext: true },
        ],
        nextCursor: null,
      };
    return {
      data,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
      error: null,
    };
  },
}));
const page = () => (
  <ContextProvider>
    <LabelConversionPage orgId={orgId} templateId={templateId} versionId={versionId} />
  </ContextProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.phase = 'ready';
  mocks.review = null;
  mocks.receipt = null;
  mocks.sourceAvailable = true;
  mocks.choices = null;
});
afterEach(cleanup);
it('uses the selected publication name and loads matching work only after a label is chosen', () => {
  render(page());
  expect(screen.getByRole('heading', { name: 'Apply Event to existing work' })).toBeVisible();
  expect(screen.queryByText('New name in the draft')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Label group'), { target: { value: groupId } });
  fireEvent.change(screen.getByLabelText('Label to replace'), { target: { value: labelId } });
  expect(screen.getByRole('checkbox', { name: 'Community dinner' })).not.toBeChecked();
  expect(screen.queryByText('Ancestor context')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review selection' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Community dinner' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review 1 item' }));
  expect(mocks.prepare).toHaveBeenCalledWith({
    labelGroupId: groupId,
    items: [
      {
        kind: 'project',
        id: workId,
        removeLabelIds: [labelId],
        workTypeId: templateId,
        workTypeVersionId: versionId,
      },
    ],
  });
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it('preserves the selected label and checked work when returning from the exact server review', () => {
  const view = render(page());
  fireEvent.change(screen.getByLabelText('Label group'), { target: { value: groupId } });
  fireEvent.change(screen.getByLabelText('Label to replace'), { target: { value: labelId } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Community dinner' }));
  mocks.review = LabelTemplateConversionReview.parse({
    labelGroupId: groupId,
    labelGroupName: 'Type',
    reviewFingerprint: `sha256:${'1'.repeat(64)}`,
    items: [
      {
        kind: 'project',
        id: workId,
        name: 'Community dinner',
        templateName: 'Event',
        workTypeId: templateId,
        workTypeVersionId: versionId,
        removeLabels: [{ id: labelId, name: 'Event label' }],
      },
    ],
  });
  view.rerender(page());
  expect(screen.getByRole('heading', { name: 'Apply Event to 1 project?' })).toBeVisible();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply template' }));
  expect(mocks.confirm).toHaveBeenCalledOnce();
  mocks.review = null;
  view.rerender(page());
  expect(screen.getByLabelText('Label to replace')).toHaveValue(labelId);
  expect(screen.getByRole('checkbox', { name: 'Community dinner' })).toBeChecked();
});
it.each(['checking', 'unknown'])(
  'does not read any private source while the command is %s',
  (phase) => {
    mocks.phase = phase;
    render(page());
    expect(mocks.reads).not.toHaveBeenCalled();
  },
);
it('shows a reconciled receipt without requiring its former template or labels', () => {
  mocks.receipt = { changeSetId: 'receipt', state: 'converted', itemCount: 2 };
  render(page());
  expect(screen.getByRole('heading', { name: 'Template applied to 2 items' })).toBeVisible();
  expect(mocks.reads).not.toHaveBeenCalled();
});
it('validates a retained label before loading work and never preselects examples for conversion', () => {
  render(
    <ContextProvider>
      <LabelConversionPage
        orgId={orgId}
        templateId={templateId}
        versionId={versionId}
        labelGroupId={groupId}
        labelId={labelId}
      />
    </ContextProvider>,
  );
  expect(screen.getByLabelText('Label group')).toHaveValue(groupId);
  expect(screen.getByLabelText('Label to replace')).toHaveValue(labelId);
  expect(screen.getByRole('checkbox', { name: 'Community dinner' })).not.toBeChecked();
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it('does not query source work when the retained label is no longer an authorized choice', () => {
  mocks.sourceAvailable = false;
  render(
    <ContextProvider>
      <LabelConversionPage
        orgId={orgId}
        templateId={templateId}
        versionId={versionId}
        labelGroupId={groupId}
        labelId={labelId}
      />
    </ContextProvider>,
  );
  expect(
    screen.getByText('The original label is unavailable. Choose a label to continue.'),
  ).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(mocks.reads.mock.calls.some(([key]) => key.includes('work'))).toBe(false);
});
it('invalidates selected work when the checked retained label disappears during selection', () => {
  const rendered = () => (
    <ContextProvider>
      <LabelConversionPage
        orgId={orgId}
        templateId={templateId}
        versionId={versionId}
        labelGroupId={groupId}
        labelId={labelId}
      />
    </ContextProvider>
  );
  const view = render(rendered());
  fireEvent.click(screen.getByRole('checkbox', { name: 'Community dinner' }));
  mocks.sourceAvailable = false;
  view.rerender(rendered());
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Review 1 item' })).not.toBeInTheDocument();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it('restores reviewed request IDs only after checking the actual current label and keeps actions outside scrolling work', () => {
  mocks.choices = LabelTemplateConversionChoices.parse({
    labelGroupId: groupId,
    items: [
      {
        kind: 'project',
        id: workId,
        removeLabelIds: [labelId],
        workTypeId: templateId,
        workTypeVersionId: versionId,
      },
    ],
  });
  render(page());
  expect(screen.getByLabelText('Label to replace')).toHaveValue(labelId);
  expect(screen.getByRole('checkbox', { name: 'Community dinner' })).toBeChecked();
  const action = screen.getByRole('button', { name: 'Review 1 item' });
  expect(action.closest('footer')).not.toBeNull();
  expect(screen.getByRole('main')).not.toContainElement(action);
  expect(mocks.prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.getByRole('checkbox', { name: 'Community dinner' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Review selection' })).toBeDisabled();
});
it('does not restore selected IDs into a missing label or a different published target', () => {
  mocks.choices = LabelTemplateConversionChoices.parse({
    labelGroupId: groupId,
    items: [
      {
        kind: 'project',
        id: workId,
        removeLabelIds: [labelId],
        workTypeId: templateId,
        workTypeVersionId: versionId,
      },
    ],
  });
  mocks.sourceAvailable = false;
  const view = render(page());
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review selection' })).toBeDisabled();
  view.unmount();
  mocks.sourceAvailable = true;
  mocks.choices = {
    ...mocks.choices,
    items: mocks.choices.items.map((item) => ({
      ...item,
      workTypeVersionId: WorkTemplateVersionOut.parse({ ...version, id: workId }).id,
    })),
  };
  render(page());
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Label group')).toHaveValue('');
});
it('restores the saved explicit selection ahead of original navigation hints', () => {
  mocks.choices = LabelTemplateConversionChoices.parse({
    labelGroupId: groupId,
    items: [
      {
        kind: 'project',
        id: workId,
        removeLabelIds: [labelId],
        workTypeId: templateId,
        workTypeVersionId: versionId,
      },
    ],
  });
  render(
    <ContextProvider>
      <LabelConversionPage
        orgId={orgId}
        templateId={templateId}
        versionId={versionId}
        labelGroupId={orgId}
        labelId={templateId}
      />
    </ContextProvider>,
  );
  expect(screen.getByLabelText('Label to replace')).toHaveValue(labelId);
  expect(screen.getByRole('checkbox', { name: 'Community dinner' })).toBeChecked();
});
it('offers the template exit while an interrupted reviewed submission still has an unknown outcome', () => {
  mocks.phase = 'unknown';
  mocks.review = LabelTemplateConversionReview.parse({
    labelGroupId: groupId,
    labelGroupName: 'Type',
    reviewFingerprint: `sha256:${'1'.repeat(64)}`,
    items: [
      {
        kind: 'project',
        id: workId,
        name: 'Community dinner',
        templateName: 'Event',
        workTypeId: templateId,
        workTypeVersionId: versionId,
        removeLabels: [{ id: labelId, name: 'Event label' }],
      },
    ],
  });
  render(page());
  expect(screen.queryByRole('button', { name: 'Choose work' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Template' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Check again' })).toBeVisible();
});

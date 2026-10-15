import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkSchedulePreviewOut } from '@docket/work/work-schedule-management';
import { ScheduleEditor } from '../../src/components/work-schedules/schedule-editor';
import { scheduleFixture } from './schedule-fixtures';

const state = vi.hoisted(() => ({ previewPending: false, previewError: false }));
const fixture = scheduleFixture();
const preview = WorkSchedulePreviewOut.parse({
  scheduledFor: '2026-11-12',
  title: 'November Dinner',
  workTypeId: fixture.template.id,
  workTypeVersionId: fixture.template.latestVersion?.id,
  previewToken: `sha256:${'a'.repeat(64)}`,
  resolvedManifest: [],
  descendants: [
    {
      path: ['venue'],
      parentPath: [],
      kind: 'task',
      title: 'Book venue',
      workTypeId: null,
      workTypeVersionId: null,
      dates: { startDate: null, dueDate: '2026-10-01', targetDate: null },
      unresolvedReasons: {},
      optional: true,
      selectedByDefault: true,
      selected: true,
      prerequisites: [],
    },
  ],
  descendantCount: 1,
  selectedCount: 2,
  additionalMilestoneCount: 0,
  summaryOffset: 0,
  nextSummaryOffset: null,
  warnings: [],
});
vi.mock('../../src/lib/query', () => ({
  useApiListQuery: () => ({
    data: state.previewPending || state.previewError ? undefined : preview,
    isPending: state.previewPending,
    isFetching: state.previewPending,
    isError: state.previewError,
    refetch: vi.fn(),
  }),
  useApiQuery: (def: { queryKey: readonly unknown[] }) =>
    def.queryKey.includes('identity')
      ? { data: { name: 'Retained Event', versionNumber: 1 }, isError: false, isPending: false }
      : def.queryKey.includes('preview')
        ? {
            data: state.previewPending || state.previewError ? undefined : preview,
            isPending: state.previewPending,
            isFetching: state.previewPending,
            isError: state.previewError,
            refetch: vi.fn(),
          }
        : { data: { items: [fixture.template] }, isError: false, isPending: false },
}));
vi.mock('../../src/components/work-schedules/work-schedule-queries', () => ({
  schedulePreviewDef: (_orgId: string, input: unknown) => ({ queryKey: ['preview', input] }),
}));
vi.mock('../../src/components/templates/work-template-queries', () => ({
  workTemplatesDef: () => ({ queryKey: ['templates'] }),
}));
vi.mock('../../src/components/templates/work-template-identity-queries', () => ({
  workTemplateIdentityDef: () => ({ queryKey: ['identity'] }),
}));
vi.mock('../../src/components/pickers/use-composer-options', () => ({
  useComposerOptions: () => ({
    actorOptions: [],
    memberOptions: [],
    teamOptions: [],
    teams: [],
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}));
vi.mock('../../src/components/composer/work-template-picker', () => ({
  WorkTemplatePicker: ({ onSelect }: { onSelect: (template: typeof fixture.template) => void }) => (
    <button
      type="button"
      onClick={() => {
        onSelect(fixture.template);
      }}
    >
      Choose Event
    </button>
  ),
}));
vi.mock('../../src/components/people/workspace-actor-picker', () => ({
  WorkspaceActorPicker: () => <span>Responsibility choices</span>,
}));
afterEach(cleanup);
beforeEach(() => {
  state.previewPending = false;
  state.previewError = false;
});
function renderEditor(onSubmit = vi.fn().mockResolvedValue(undefined), existing = false) {
  const onOpenChange = vi.fn();
  render(
    <ScheduleEditor
      orgId={fixture.orgId}
      programId={fixture.programId}
      programName="Community"
      open
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      schedule={existing ? fixture.schedule : undefined}
    />,
  );
  return { onSubmit, onOpenChange };
}
function chooseWork(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Choose Event' }));
}

describe('schedule definition', () => {
  it('keeps the exact archived identity and included structure while responsibility stays editable', () => {
    const archived = {
      ...fixture.schedule,
      templateArchived: true,
      retainedTemplate: {
        workTypeId: fixture.template.id,
        workTypeVersionId: preview.workTypeVersionId,
      },
    };
    render(
      <ScheduleEditor
        orgId={fixture.orgId}
        programId={fixture.programId}
        programName="Community"
        schedule={archived}
        open
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('Retained Event')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Include Book venue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Responsibility for Book venue' })).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByText('This template is archived')).toBeVisible();
  });
  it('re-enters sections without losing its title, cadence or child choices', async () => {
    const { onSubmit } = renderEditor();
    chooseWork();
    fireEvent.change(screen.getByLabelText('Title of each new item'), {
      target: { value: '{month} Dinner' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Repeat' }));
    fireEvent.change(screen.getByLabelText('Monthly repeat pattern'), {
      target: { value: 'nth_weekday' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByRole('heading', { name: 'Ready for the next run' })).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Work' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Book venue' }));
    expect(screen.getByLabelText('Title of each new item')).toHaveValue('{month} Dinner');
    fireEvent.click(screen.getByRole('tab', { name: 'Repeat' }));
    expect(screen.getByLabelText('Monthly weekday position')).toHaveValue('2');
    expect(screen.getByLabelText('Monthly weekday')).toHaveValue('thursday');
    fireEvent.click(screen.getByRole('tab', { name: 'Work' }));
    expect(screen.getByRole('checkbox', { name: 'Include Book venue' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start schedule' }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      document: {
        titlePattern: '{month} Dinner',
        optionalChoices: [{ path: ['venue'], selected: false }],
      },
      trigger: { schedule: { pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' } } },
    });
  });
  it('keeps the edited draft visible after a failed save and never leaks an exception', async () => {
    const { onOpenChange } = renderEditor(
      vi.fn().mockRejectedValue(new Error('private provider dump')),
    );
    chooseWork();
    fireEvent.change(screen.getByLabelText('Schedule name'), {
      target: { value: 'Monthly neighbors dinner' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start schedule' }));
    await screen.findByText('Schedule was not saved');
    expect(screen.queryByText('private provider dump')).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Work' }));
    expect(screen.getByLabelText('Schedule name')).toHaveValue('Monthly neighbors dinner');
  });
  it('requires a completed canonical preview before saving a future revision', () => {
    state.previewPending = true;
    const { onSubmit } = renderEditor(undefined, true);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByRole('button', { name: 'Save future runs' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole('tabpanel', { name: 'Review' })).getByText(
        'Reviewing included work and dates…',
      ),
    ).toBeVisible();
  });
});

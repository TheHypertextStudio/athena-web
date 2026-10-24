import {
  section,
  mocks,
  template,
  nestedId,
  versionId,
  change,
} from './work-template-authoring-fixture';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { ProgramDefaultSchedule } from '@docket/work/work-schedule-defaults';
import { VocabularyProvider } from '@docket/ui/hooks';
import { BlueprintDefaultScheduleReview } from '@/components/composer/blueprint-default-schedule-review';
import { ProgramDefaultSchedulePreview } from '@docket/work/work-template-blueprint';
import { WorkTemplateForm } from '@/components/templates/work-template-authoring';

vi.mock('@/components/composer/work-template-picker', () => ({
  WorkTemplatePicker: ({
    onSelect,
    disabled,
  }: {
    onSelect: (value: WorkTemplateOut) => void;
    disabled: boolean;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onSelect(
          WorkTemplateOut.parse({
            ...template('task'),
            id: nestedId,
            status: 'published',
            scope: 'organization',
            latestVersion: {
              id: versionId,
              number: 2,
              workTypeId: nestedId,
              organizationId: template('task').organizationId,
              definition: template('task').definition,
              publishedAt: '2026-10-15T00:00:00Z',
              publishedByActorId: null,
            },
            definition: { ...template('task').definition, name: 'Vendor booking' },
          }),
        );
      }}
    >
      Choose Vendor booking
    </button>
  ),
}));
function routine(key: string, name: string): ProgramDefaultSchedule {
  return ProgramDefaultSchedule.parse({
    key,
    name,
    template: { targetType: 'task', workTypeId: nestedId, selection: { kind: 'latest' } },
    titlePattern: '{month} booking',
    cadence: {
      kind: 'monthly',
      interval: 1,
      startOffsetDays: 0,
      end: { kind: 'never' },
      pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
    },
    teamRule: 'parent_team',
    actorRule: 'parent_responsible',
  });
}
function initial(values: ProgramDefaultSchedule[] = []) {
  const saved = template('program');
  return WorkTemplateOut.parse({
    ...saved,
    definition: { ...saved.definition, defaultSchedules: values },
  });
}
describe('Program reusable recurring work authoring', () => {
  it('keeps a new Program kind while it owns a routine so hidden schedules cannot invalidate saving', () => {
    render(
      <WorkTemplateForm orgId={template().organizationId} initial={null} onCreated={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('Kind of work'), { target: { value: 'program' } });
    change('Template name', 'Community gatherings');
    section('Included work');
    fireEvent.click(screen.getByRole('button', { name: 'Add repeating work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose Vendor booking' }));
    section('Purpose');
    expect(screen.getByLabelText('Kind of work')).toBeDisabled();
    expect(
      screen.getByText('Remove included and repeating work before changing the kind.'),
    ).toBeVisible();
    section('Included work');
    fireEvent.click(screen.getByRole('button', { name: 'Remove repeating work' }));
    section('Purpose');
    expect(screen.getByLabelText('Kind of work')).toBeEnabled();
  });

  it('authors a relative routine, retains parent content, and reads its independent consequences', async () => {
    render(
      <WorkTemplateForm
        orgId={template().organizationId}
        initial={initial()}
        onCreated={vi.fn()}
      />,
    );
    change('Document', 'Program welcome and orientation');
    section('Included work');
    fireEvent.click(screen.getByRole('button', { name: 'Add repeating work' }));
    fireEvent.change(screen.getByLabelText('Work kind for repeating work'), {
      target: { value: 'task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose Vendor booking' }));
    const user = userEvent.setup();
    const nameInput = screen.getByLabelText('Repeating work name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Monthly vendor check-in');
    expect(nameInput).toHaveFocus();
    change('Title for each new item', '{month} vendor check-in');
    change('Monthly repeat pattern', 'nth_weekday');
    change('Monthly weekday position', '2');
    change('Monthly weekday', 'thursday');
    change('First occurrence', 'after');
    change('Days before or after creation', '7');
    change('Stops repeating', 'after_count');
    change('Number of times', '6');
    fireEvent.click(screen.getByRole('button', { name: 'Responsibility' }));
    change('Responsible person', 'creator');
    fireEvent.click(screen.getByRole('button', { name: 'Template version' }));
    change('Template updates for repeating work', 'pinned');
    section('Review');
    const review = screen.getByRole('region', { name: 'Repeating work review' });
    expect(within(review).getByText('Monthly vendor check-in')).toBeVisible();
    expect(within(review).getByText('Every month on the second Thursday')).toBeVisible();
    expect(
      within(review).getByText('Begins 7 days after Program creation · 6 times'),
    ).toBeVisible();
    section('Included work');
    expect(screen.getByLabelText('Repeating work name')).toHaveValue('Monthly vendor check-in');
    fireEvent.click(screen.getByRole('button', { name: 'Back to included work' }));
    section('Starting work');
    expect(screen.getByLabelText('Document')).toHaveValue('Program welcome and orientation');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mocks.draft).toHaveBeenCalled();
    });
    const saved = mocks.draft.mock.calls[0]?.[0].definition.defaultSchedules[0];
    expect(saved).toMatchObject({
      name: 'Monthly vendor check-in',
      template: { selection: { kind: 'pinned', workTypeVersionId: versionId } },
      cadence: { kind: 'monthly', startOffsetDays: 7, end: { kind: 'after_count', count: 6 } },
      actorRule: 'creator',
    });
    expect(saved.cadence).not.toHaveProperty('startDate');
    expect(saved.cadence).not.toHaveProperty('timezone');
  });
  it('expresses relative starts without signed arithmetic and restores them on re-entry', async () => {
    render(
      <WorkTemplateForm
        orgId={template().organizationId}
        initial={initial([routine('routine', 'Routine')])}
        onCreated={vi.fn()}
      />,
    );
    section('Included work');
    fireEvent.click(screen.getByRole('button', { name: 'Edit repeating work Routine' }));
    expect(screen.getByLabelText('First occurrence')).toHaveValue('on_creation');
    expect(screen.queryByLabelText('Days before or after creation')).not.toBeInTheDocument();
    change('First occurrence', 'before');
    change('Days before or after creation', '3');
    section('Review');
    expect(
      screen.getByText('Begins 3 days before Program creation · Repeats until stopped'),
    ).toBeVisible();
    section('Included work');
    expect(screen.getByLabelText('First occurrence')).toHaveValue('before');
    expect(screen.getByLabelText('Days before or after creation')).toHaveValue(3);
    change('First occurrence', 'after');
    expect(screen.getByLabelText('Days before or after creation')).toHaveValue(3);
    change('First occurrence', 'on_creation');
    change('Repeating work name', 'Routine beginning on creation');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mocks.draft).toHaveBeenCalled();
    });
    expect(
      mocks.draft.mock.calls[0]?.[0].definition.defaultSchedules[0].cadence.startOffsetDays,
    ).toBe(0);
  });
  it('collapses included work while keeping its count and recurring work reachable', async () => {
    render(
      <WorkTemplateForm
        orgId={template().organizationId}
        initial={initial([routine('routine', 'Monthly dinner')])}
        onCreated={vi.fn()}
      />,
    );
    section('Included work');
    const branch = screen.getByRole('button', { name: 'Created together' });
    expect(branch).toHaveAttribute('aria-expanded', 'true');
    branch.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(branch).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('No included work yet')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Edit repeating work Monthly dinner' }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit repeating work Monthly dinner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to included work' }));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Edit repeating work Monthly dinner' }),
      ).toHaveFocus();
    });
    expect(branch).toHaveAttribute('aria-expanded', 'false');
  });
  it('reorders stable keys and removes only the reusable definition entry', async () => {
    render(
      <WorkTemplateForm
        orgId={template().organizationId}
        initial={initial([routine('dinner', 'Dinner'), routine('check-in', 'Check-in')])}
        onCreated={vi.fn()}
      />,
    );
    section('Included work');
    fireEvent.click(screen.getByRole('button', { name: 'Edit repeating work Check-in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move earlier' }));
    expect(screen.queryByRole('list', { name: 'Repeating work outline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Child work outline' })).not.toBeInTheDocument();
    expect(screen.getByText(/Programs already created keep their schedules/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to included work' }));
    const outline = screen.getByRole('list', { name: 'Repeating work outline' });
    expect(
      within(outline)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Edit repeating work Check-in', 'Edit repeating work Dinner']);
    fireEvent.click(screen.getByRole('button', { name: 'Edit repeating work Check-in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove repeating work' }));
    expect(
      screen.queryByRole('button', { name: 'Edit repeating work Check-in' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mocks.draft).toHaveBeenCalled();
    });
    expect(
      mocks.draft.mock.calls[0]?.[0].definition.defaultSchedules.map(
        (value: ProgramDefaultSchedule) => value.key,
      ),
    ).toEqual(['dinner']);
  });
  it('keeps invalid relative input through a rejected write and section re-entry', async () => {
    mocks.draft.mockRejectedValue(new Error('private provider detail'));
    render(
      <WorkTemplateForm
        orgId={template().organizationId}
        initial={initial([routine('routine', 'Routine')])}
        onCreated={vi.fn()}
      />,
    );
    section('Included work');
    fireEvent.click(screen.getByRole('button', { name: 'Edit repeating work Routine' }));
    change('Repeat interval', '0');
    expect(screen.getByText('Check repeating work')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(mocks.draft).not.toHaveBeenCalled();
    change('Repeat interval', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        screen.getByText('Could not save the template draft. Your changes are still here.'),
      ).toBeVisible(),
    );
    expect(screen.queryByText('private provider detail')).not.toBeInTheDocument();
    change('Repeat interval', '0');
    section('Review');
    section('Included work');
    expect(screen.getByLabelText('Repeat interval')).toHaveValue(0);
  });
  it('uses workspace vocabulary in recurring-work authoring, review and creation consequences', () => {
    const skin = {
      preset: 'startup' as const,
      overrides: {
        program: { singular: 'Practice', plural: 'Practices' },
        project: { singular: 'Gathering', plural: 'Gatherings' },
        task: { singular: 'Action', plural: 'Actions' },
        team: { singular: 'Circle', plural: 'Circles' },
      },
    };
    const view = render(
      <VocabularyProvider skin={skin}>
        <WorkTemplateForm
          orgId={template().organizationId}
          initial={initial([routine('dinner', 'Monthly dinner')])}
          onCreated={vi.fn()}
        />
      </VocabularyProvider>,
    );
    section('Included work');
    fireEvent.click(screen.getByRole('button', { name: 'Edit repeating work Monthly dinner' }));
    expect(screen.getByRole('option', { name: 'Action' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'When this Practice is created' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Template version' }));
    expect(
      screen.getByText('Each new item uses the latest version available to its Practice.'),
    ).toBeVisible();
    section('Review');
    expect(
      screen.getByText('Begins when the Practice is created · Repeats until stopped'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Practice owner · Same circle as the Practice, or the circle chosen for new work',
      ),
    ).toBeVisible();
    view.unmount();
    render(
      <VocabularyProvider skin={skin}>
        <BlueprintDefaultScheduleReview
          schedules={[
            ProgramDefaultSchedulePreview.parse({
              programPath: [],
              programName: 'Community',
              key: 'dinner',
              name: 'Dinner',
              targetType: 'project',
              workTypeId: nestedId,
              selection: 'latest',
              workTypeVersionId: null,
              titlePattern: 'Dinner',
              cadenceKind: 'monthly',
              interval: 1,
              firstRunDate: '2026-11-12',
              timezone: 'UTC',
            }),
          ]}
        />
      </VocabularyProvider>,
    );
    expect(screen.getByText(/Each Practice keeps its own editable copy/)).toBeVisible();
    expect(screen.getByText('Community · Gathering · Every month')).toBeVisible();
  });
  it('bounds the outline at twenty routines and preserves reader inspection', () => {
    const value = initial(
      Array.from({ length: 20 }, (_, index) => routine(`routine-${index}`, `Routine ${index + 1}`)),
    );
    render(
      <WorkTemplateForm
        orgId={template().organizationId}
        initial={{ ...value, canEdit: false }}
        onCreated={vi.fn()}
      />,
    );
    section('Included work');
    expect(screen.getByRole('button', { name: 'Add repeating work' })).toBeDisabled();
    expect(screen.getByText('A template can include up to 20 repeating items.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit repeating work Routine 1' }));
    expect(screen.getByLabelText('Repeating work name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove repeating work' })).toBeDisabled();
  });
});

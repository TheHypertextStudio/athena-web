import { mocks, template, nestedId, versionId, change } from './work-template-authoring-fixture';
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
  it('authors a relative routine, retains parent content, and reads its independent consequences', async () => {
    render(<WorkTemplateForm orgId="org" initial={initial()} onCreated={vi.fn()} />);
    change('Starting document', 'Program welcome and orientation');
    fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }));
    fireEvent.change(screen.getByLabelText('Reusable schedule work kind'), {
      target: { value: 'task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose Vendor booking' }));
    const user = userEvent.setup();
    const nameInput = screen.getByLabelText('Reusable schedule name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Monthly vendor check-in');
    expect(nameInput).toHaveFocus();
    change('Reusable schedule title pattern', '{month} vendor check-in');
    change('Monthly repeat pattern', 'nth_weekday');
    change('Monthly weekday position', '2');
    change('Monthly weekday', 'thursday');
    change('Default schedule begins', 'after');
    change('Default schedule start offset days', '7');
    change('Default schedule ends', 'after_count');
    change('Default schedule run count', '6');
    fireEvent.click(screen.getByRole('button', { name: 'Responsibility' }));
    change('Responsible person', 'creator');
    fireEvent.click(screen.getByRole('button', { name: 'Template version' }));
    change('Reusable schedule template updates', 'pinned');
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    const review = screen.getByRole('region', { name: 'Recurring work review' });
    expect(within(review).getByText('Monthly vendor check-in')).toBeVisible();
    expect(within(review).getByText('Every month on the second Thursday')).toBeVisible();
    expect(within(review).getByText('Begins 7 days after Program creation · 6 runs')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Work' }));
    expect(screen.getByLabelText('Reusable schedule name')).toHaveValue('Monthly vendor check-in');
    fireEvent.click(screen.getByRole('button', { name: 'Edit parent Community dinner' }));
    expect(screen.getByLabelText('Starting document')).toHaveValue(
      'Program welcome and orientation',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
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
        orgId="org"
        initial={initial([routine('routine', 'Routine')])}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit routine Routine' }));
    expect(screen.getByLabelText('Default schedule begins')).toHaveValue('on_creation');
    expect(screen.queryByLabelText('Default schedule start offset days')).not.toBeInTheDocument();
    change('Default schedule begins', 'before');
    change('Default schedule start offset days', '3');
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByText('Begins 3 days before Program creation · No end')).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Work' }));
    expect(screen.getByLabelText('Default schedule begins')).toHaveValue('before');
    expect(screen.getByLabelText('Default schedule start offset days')).toHaveValue(3);
    change('Default schedule begins', 'after');
    expect(screen.getByLabelText('Default schedule start offset days')).toHaveValue(3);
    change('Default schedule begins', 'on_creation');
    change('Reusable schedule name', 'Routine beginning on creation');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
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
        orgId="org"
        initial={initial([routine('routine', 'Monthly dinner')])}
        onCreated={vi.fn()}
      />,
    );
    const branch = screen.getByRole('button', { name: 'Included work' });
    expect(branch).toHaveAttribute('aria-expanded', 'true');
    branch.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(branch).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Blueprint summary')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit routine Monthly dinner' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit routine Monthly dinner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to outline' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit routine Monthly dinner' })).toHaveFocus();
    });
    expect(branch).toHaveAttribute('aria-expanded', 'false');
  });
  it('reorders stable keys and removes only the reusable definition entry', async () => {
    render(
      <WorkTemplateForm
        orgId="org"
        initial={initial([routine('dinner', 'Dinner'), routine('check-in', 'Check-in')])}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit routine Check-in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move earlier' }));
    const outline = screen.getByRole('list', { name: 'Recurring work outline' });
    expect(
      within(outline)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Edit routine Check-in', 'Edit routine Dinner']);
    expect(screen.getByText(/Existing Program copies keep their schedules/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove routine' }));
    expect(screen.queryByRole('button', { name: 'Edit routine Check-in' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
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
        orgId="org"
        initial={initial([routine('routine', 'Routine')])}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit routine Routine' }));
    change('Default schedule interval', '0');
    expect(screen.getByText('Review this routine')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(
        screen.getByText('Could not save the template draft. Your changes are still here.'),
      ).toBeVisible(),
    );
    expect(screen.queryByText('private provider detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Work' }));
    expect(screen.getByLabelText('Default schedule interval')).toHaveValue(0);
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
          orgId="org"
          initial={initial([routine('dinner', 'Monthly dinner')])}
          onCreated={vi.fn()}
        />
      </VocabularyProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit routine Monthly dinner' }));
    expect(screen.getByRole('option', { name: 'Action' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'When the Practice is created' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Template version' }));
    expect(
      screen.getByText('Each new run uses the latest publication available to its Practice.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByText('Begins when the Practice is created · No end')).toBeVisible();
    expect(
      screen.getByText('Practice owner · Practice circle, otherwise selected circle'),
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
      <WorkTemplateForm orgId="org" initial={{ ...value, canEdit: false }} onCreated={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Add schedule' })).toBeDisabled();
    expect(screen.getByText('This definition has the maximum of 20 routines.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Edit routine Routine 1' }));
    expect(screen.getByLabelText('Reusable schedule name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove routine' })).toBeDisabled();
  });
});

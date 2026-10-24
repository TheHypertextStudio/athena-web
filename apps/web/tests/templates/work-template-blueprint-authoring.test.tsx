import {
  mocks,
  section,
  template,
  change,
  add,
  nestedId,
  versionId,
} from './work-template-authoring-fixture';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VocabularyProvider } from '@docket/ui/hooks';
import { ContextProvider } from '@docket/ui/components';
import { describe, expect, it, vi } from 'vitest';
import { WorkTemplateOut, type WorkTemplateDraftUpdate } from '@docket/work/work-template-contract';
import {
  WorkTemplateAuthoring,
  WorkTemplateForm,
} from '@/components/templates/work-template-authoring';
describe('blueprint sample authoring', () => {
  it('waits for the canonical session owner before accepting new definition input', () => {
    mocks.sessionPending = true;
    const content = (
      <ContextProvider>
        <WorkTemplateAuthoring orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX" id={null} />
      </ContextProvider>
    );
    const view = render(content);
    expect(screen.queryByLabelText('Template name')).not.toBeInTheDocument();
    mocks.sessionPending = false;
    view.rerender(
      <ContextProvider>
        <WorkTemplateAuthoring orgId="01ARZ3NDEKTSV4RRFFQ69G5FAX" id={null} />
      </ContextProvider>,
    );
    change('Template name', 'Event');
    change('When to use it', 'Community gatherings');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to starting work' }));
    expect(screen.getByRole('heading', { name: 'Event' })).toBeVisible();
    change('Name for new work', 'Community dinner');
    expect(screen.getByRole('heading', { name: 'Event' })).toBeVisible();
  });
  it('keeps populated purpose text accessible and editable by its visible label', () => {
    const initial = template();
    initial.definition.description = 'For neighborhood events.';
    render(<WorkTemplateForm orgId="org" initial={initial} onCreated={vi.fn()} />);
    section('Purpose');
    const purpose = screen.getByRole('textbox', { name: 'When to use it' });
    expect(purpose).toHaveValue('For neighborhood events.');
    fireEvent.change(purpose, { target: { value: 'For community meals.' } });
    section('Starting work');
    section('Purpose');
    expect(screen.getByRole('textbox', { name: 'When to use it' })).toHaveValue(
      'For community meals.',
    );
  });
  it('describes nested responsibility from the immediate parent and omits milestone assignment', () => {
    render(<WorkTemplateForm orgId="org" initial={template('task')} onCreated={vi.fn()} />);
    const parent = add('subtask');
    change('Title', 'Vendor booking', parent);
    fireEvent.click(within(parent).getByRole('button', { name: 'Add subtask' }));
    const child = screen.getByRole('group', { name: 'Child work: New task' });
    change('Title', 'Confirm delivery', child);
    change('Responsible person', 'parent_responsible', child);
    section('Review');
    expect(
      screen.getByText(
        'Vendor booking assignee · Same team as Vendor booking, or the team chosen for new work',
      ),
    ).toBeVisible();
  });
  it('inherits responsibility through milestones while keeping their date context', () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const milestone = add('milestone');
    change('Name', 'Dinner day', milestone);
    fireEvent.click(within(milestone).getByRole('button', { name: 'Add task' }));
    const child = screen.getByRole('group', { name: 'Child work: New task' });
    change('Title', 'Welcome guests', child);
    change('Responsible person', 'parent_responsible', child);
    change('Is due', 'parent', child);
    section('Review');
    const review = screen.getByRole('region', { name: 'Work definition review' });
    expect(
      within(review).getByText(
        'Project lead · Same team as Project, or the team chosen for new work',
      ),
    ).toBeVisible();
    expect(within(review).getByText('Due on Dinner day')).toBeVisible();
    expect(within(review).queryByText('Unassigned')).not.toBeInTheDocument();
  });
  it('guides a new work definition and preserves child selection when revisiting sections', () => {
    render(<WorkTemplateForm orgId="org" initial={null} onCreated={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Purpose' })).toHaveAttribute('aria-current', 'step');
    change('Template name', 'Event');
    change('When to use it', 'Community events with preparation and follow-up');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to starting work' }));
    const child = add('task');
    change('Title', 'Book venue', child);
    section('Review');
    expect(
      within(screen.getByRole('region', { name: 'Work definition review' })).getByRole('heading', {
        name: 'Starting work',
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Review and publish' })).getByText(
        'Community events with preparation and follow-up',
      ),
    ).toBeVisible();
    section('Purpose');
    expect(screen.getByLabelText('When to use it')).toHaveValue(
      'Community events with preparation and follow-up',
    );
    section('Included work');
    expect(screen.getByLabelText('Title')).toHaveValue('Book venue');
  });
  it('allows standalone work and keeps the starting document out of included-work decisions', () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    expect(screen.getByLabelText('Document')).toBeVisible();
    section('Included work');
    expect(screen.getByLabelText('Document')).not.toBeVisible();
    expect(screen.getByText('No included work yet')).toBeVisible();
    expect(screen.getByText(/A new project can stand on its own/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Edit parent/ })).not.toBeInTheDocument();
    section('Review');
    expect(screen.getByRole('button', { name: 'Publish to workspace' })).toBeEnabled();
  });
  it('replaces the overview with one child editor and restores its row on return', async () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    expect(screen.getByLabelText('Document')).toBeVisible();
    expect(screen.queryByLabelText('Starting priority')).not.toBeInTheDocument();
    const first = add('task');
    change('Title', 'Book venue', first);
    expect(screen.queryByLabelText('Team')).not.toBeInTheDocument();
    const second = add('task');
    change('Title', 'Send invitations', second);
    expect(screen.getAllByLabelText('Title')).toHaveLength(1);
    expect(screen.queryByRole('list', { name: 'Child work outline' })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText('Document')[0]).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to included work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Book venue' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Book venue');
    expect(screen.getAllByLabelText('Title')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dates' }));
    change('Is due', 'parent');
    change('Due: days before (−) or after (+)', '-21');
    fireEvent.click(screen.getByRole('button', { name: 'Back to included work' }));
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.getByText('Due 21 days before Community dinner date')).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit Book venue' })).toHaveFocus();
    });
  });
  it('uses custom child, team and cycle nouns with compact disclosure actions', () => {
    render(
      <VocabularyProvider
        skin={{
          preset: 'startup',
          overrides: {
            task: { singular: 'Action', plural: 'Actions' },
            team: { singular: 'Squad', plural: 'Squads' },
            cycle: { singular: 'Sprint', plural: 'Sprints' },
          },
        }}
      >
        <WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />
      </VocabularyProvider>,
    );
    const child = add('action');
    expect(within(child).getByLabelText('Title')).toHaveValue('New action');
    fireEvent.click(within(child).getByRole('button', { name: 'Responsibility' }));
    expect(within(child).getByLabelText('Squad')).toBeVisible();
    expect(within(child).getByLabelText('Sprint')).toBeVisible();
    expect(within(child).getByRole('button', { name: 'Back to included work' })).toBeVisible();
    fireEvent.click(within(child).getByRole('button', { name: 'Back to included work' }));
    expect(
      within(screen.getByRole('list', { name: 'Child work outline' })).getByText('Action'),
    ).toBeVisible();
  });
  it.each(['task', 'project'] as const)(
    'roundtrips canonical %s starting fields while editing children',
    async (kind) => {
      render(<WorkTemplateForm orgId="org" initial={template(kind)} onCreated={vi.fn()} />);
      change('Starting summary', 'Keep the canonical summary');
      change('Starting priority', 'high');
      if (kind === 'task') {
        change('Starting point estimate', '3');
        change('Starting time estimate (minutes)', '45');
      }
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => {
        expect(mocks.draft).toHaveBeenCalled();
      });
      expect(mocks.draft.mock.calls[0]?.[0].definition.payload).toMatchObject({
        targetType: kind,
        summary: 'Keep the canonical summary',
        priority: 'high',
        ...(kind === 'task' ? { estimate: 3, estimateMinutes: 45 } : {}),
      });
    },
  );
  it('preserves saved Program recurring-work defaults while editing its parent document', async () => {
    const initial = template('program');
    const defaults = [
      {
        key: 'monthly-dinner',
        name: 'Community dinner',
        template: { targetType: 'task', workTypeId: nestedId, selection: { kind: 'latest' } },
        titlePattern: '{month} Dinner',
        cadence: {
          kind: 'monthly',
          interval: 1,
          startOffsetDays: 0,
          end: { kind: 'never' },
          pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
        },
        teamRule: 'parent_team',
        actorRule: 'creator',
      },
    ];
    const saved = { ...initial, definition: { ...initial.definition, defaultSchedules: defaults } };
    render(
      <WorkTemplateForm orgId="org" initial={WorkTemplateOut.parse(saved)} onCreated={vi.fn()} />,
    );
    change('Name for new work', 'Community gatherings');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mocks.draft).toHaveBeenCalled();
    });
    expect(mocks.draft.mock.calls[0]?.[0].definition.defaultSchedules).toEqual(defaults);
  });
  it('saves and reopens hierarchy, optional choices, rules and relative working dates with the root outline', async () => {
    const initial = template();
    let saved = initial;
    mocks.draft.mockImplementation(async (input: WorkTemplateDraftUpdate) => {
      saved = {
        ...initial,
        revision: 4,
        definition: input.definition ?? initial.definition,
        draftDefinition: input.definition,
      };
      return saved;
    });
    const view = render(<WorkTemplateForm orgId="org" initial={initial} onCreated={vi.fn()} />);
    const task = add('task');
    change('Title', 'Book venue', task);
    fireEvent.click(within(task).getByLabelText('Make optional'));
    fireEvent.click(within(task).getByLabelText('Include by default'));
    change('Responsible person', 'creator', task);
    change('Team', 'creation_team', task);
    change('Cycle', 'current_cycle', task);
    change('Is due', 'parent', task);
    change('Due: days before (−) or after (+)', '-21', task);
    change('Due: count days as', 'working', task);
    change('Due: move to a weekday', 'next', task);
    change('Due: weekday', '1', task);
    fireEvent.click(within(task).getByLabelText('Due: allow the same day'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mocks.draft).toHaveBeenCalled();
    });
    expect(saved.definition.payload.description).toBe('## Preparation');
    expect(saved.definition.blueprint.steps[0]).toMatchObject({
      kind: 'task',
      fields: { title: 'Book venue' },
      optional: { enabled: true, selectedByDefault: false },
      teamRule: 'creation_team',
      actorRule: 'creator',
      cycleRule: 'current_cycle',
      dates: {
        dueDate: {
          kind: 'anchor',
          anchor: { kind: 'parent' },
          offset: { days: -21, unit: 'working' },
          snap: { direction: 'next', weekday: 1, inclusive: true },
        },
      },
    });
    view.unmount();
    render(<WorkTemplateForm orgId="org" initial={saved} onCreated={vi.fn()} />);
    section('Included work');
    fireEvent.click(screen.getByRole('button', { name: /Edit Book venue/ }));
    expect(screen.getByLabelText('Title')).toHaveValue('Book venue');
    fireEvent.click(screen.getByRole('button', { name: 'Dates' }));
    expect(screen.getByLabelText('Due: days before (−) or after (+)')).toHaveValue(-21);
    expect(screen.getByLabelText('Include by default')).not.toBeChecked();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('supports nested exact publications, sibling dependencies and completion-relative timing', async () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const first = add('task');
    change('Title', 'Gather quotes', first);
    change('Start from template', nestedId, first);
    change('Template version', 'pinned', first);
    change('Version to keep', versionId, first);
    const second = add('task');
    change('Title', 'Pay deposit', second);
    fireEvent.click(within(second).getByRole('button', { name: 'Dates' }));
    fireEvent.click(within(second).getByLabelText('Wait for Gather quotes'));
    change('Is due', 'after_completion', second);
    fireEvent.click(within(second).getByLabelText('Due: after Gather quotes finishes'));
    change('Due: days after finishing', '2', second);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mocks.draft).toHaveBeenCalled();
    });
    const definition = mocks.draft.mock.calls[0]?.[0].definition;
    expect(definition.blueprint.steps[0].template).toEqual({
      workTypeId: nestedId,
      selection: { kind: 'pinned', workTypeVersionId: versionId },
    });
    expect(definition.blueprint.dependencies).toEqual([
      {
        blockerStepKey: definition.blueprint.steps[0].key,
        blockedStepKey: definition.blueprint.steps[1].key,
      },
    ]);
    expect(definition.blueprint.steps[1].dates.dueDate).toMatchObject({
      kind: 'after_completion',
      stepKeys: [definition.blueprint.steps[0].key],
      offset: { days: 2, unit: 'calendar' },
    });
  });
  it('allows only valid child kinds and removes a child branch with its stale references', async () => {
    render(<WorkTemplateForm orgId="org" initial={template('task')} onCreated={vi.fn()} />);
    section('Included work');
    expect(screen.queryByRole('button', { name: 'Add project' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add subtask' }));
    const first = screen.getByRole('group', { name: /Child work:/ });
    change('Title', 'Parent task', first);
    fireEvent.click(within(first).getByRole('button', { name: 'Add subtask' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to included work' }));
    expect(
      within(screen.getByRole('list', { name: 'Child work outline' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Included work' })).toBeVisible();
    const descendants = screen.getByRole('list', { name: 'Included under Parent task' });
    expect(within(descendants).getByRole('button', { name: 'Edit New task' })).toBeVisible();
    fireEvent.click(within(descendants).getByRole('button', { name: 'Edit New task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to included work' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit New task' })).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Parent task' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Child work: Parent task' })).getByRole('button', {
        name: 'Remove work and its included items',
      }),
    );
    expect(screen.queryByRole('group', { name: /Child work:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Included work' })).toHaveFocus();
  });
  it('clears stale sibling timing when a Task moves under its Milestone', async () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const milestone = add('milestone');
    change('Name', 'Dinner day', milestone);
    const task = add('task');
    change('Title', 'Prepare venue', task);
    fireEvent.click(within(task).getByRole('button', { name: 'Template and location' }));
    const milestoneKey = within(task)
      .getByRole('option', { name: 'Dinner day' })
      .getAttribute('value');
    if (!milestoneKey) throw new Error('Missing Milestone parent');
    change('Is due', `milestone:${milestoneKey}`, task);
    change('Included under', milestoneKey, task);
    expect(within(task).getByLabelText('Is due')).toHaveValue('none');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mocks.draft).toHaveBeenCalled();
    });
    expect(mocks.draft.mock.calls[0]?.[0].definition.blueprint.steps[1]).toMatchObject({
      parentStepKey: milestoneKey,
      dates: { dueDate: { kind: 'none' } },
    });
  });
  it('accepts a signed offset typed with the keyboard', async () => {
    const user = userEvent.setup();
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const task = add('task');
    change('Is due', 'parent', task);
    const days = within(task).getByLabelText('Due: days before (−) or after (+)');
    await user.clear(days);
    await user.type(days, '-21');
    expect(days).toHaveValue(-21);
  });
  it('retains unsaved children on navigation and protects the chosen root kind', () => {
    const view = render(<WorkTemplateForm orgId="org" initial={null} onCreated={vi.fn()} />);
    const child = add('task');
    change('Title', 'Keep unsaved child', child);
    expect(screen.getByLabelText('Kind of work')).toBeDisabled();
    view.unmount();
    render(<WorkTemplateForm orgId="org" initial={null} onCreated={vi.fn()} />);
    section('Included work');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Keep unsaved child' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Keep unsaved child');
  });
  it('refuses to save incomplete child names instead of submitting a broken draft', () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const child = add('task');
    change('Title', '', child);
    expect(screen.getByText('Review child work')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
  it('keeps child edits after a failed save and disables editing for publication-only readers', async () => {
    mocks.draft.mockRejectedValueOnce(new Error('private provider failure'));
    const view = render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const child = add('task');
    change('Title', 'Keep my child', child);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Your changes are still here/);
    expect(
      within(screen.getByRole('banner')).getByText("Couldn't update the template"),
    ).toBeVisible();
    expect(screen.getByLabelText('Title')).toHaveValue('Keep my child');
    expect(screen.queryByText('private provider failure')).not.toBeInTheDocument();
    view.unmount();
    render(
      <WorkTemplateForm
        orgId="org"
        initial={{ ...template(), canEdit: false }}
        onCreated={vi.fn()}
      />,
    );
    section('Included work');
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled();
  });
});

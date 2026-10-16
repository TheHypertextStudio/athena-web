import {
  mocks,
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
    change('Starting name', 'Community dinner');
    expect(screen.getByRole('heading', { name: 'Event' })).toBeVisible();
  });
  it('describes nested responsibility from the immediate parent and omits milestone assignment', () => {
    render(<WorkTemplateForm orgId="org" initial={template('task')} onCreated={vi.fn()} />);
    const parent = add('subtask');
    change('Child title', 'Vendor booking', parent);
    fireEvent.click(within(parent).getByRole('button', { name: 'Add subtask' }));
    const child = screen.getByRole('group', { name: 'Child work: New task' });
    change('Child title', 'Confirm delivery', child);
    change('Responsible person', 'parent_responsible', child);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(
      screen.getByText('Parent assignee · Parent team, otherwise selected team'),
    ).toBeVisible();
  });
  it('inherits responsibility through milestones while keeping their date context', () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const milestone = add('milestone');
    change('Child name', 'Dinner day', milestone);
    fireEvent.click(within(milestone).getByRole('button', { name: 'Add task' }));
    const child = screen.getByRole('group', { name: 'Child work: New task' });
    change('Child title', 'Welcome guests', child);
    change('Responsible person', 'parent_responsible', child);
    change('Due date rule', 'parent', child);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    const review = screen.getByRole('region', { name: 'Work definition review' });
    expect(
      within(review).getByText('Project lead · Project team, otherwise selected team'),
    ).toBeVisible();
    expect(within(review).getByText('Due on Dinner day')).toBeVisible();
    expect(within(review).queryByText('Unassigned')).not.toBeInTheDocument();
  });
  it('guides a new work definition and preserves child selection when revisiting sections', () => {
    render(<WorkTemplateForm orgId="org" initial={null} onCreated={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Purpose' })).toHaveAttribute('aria-selected', 'true');
    change('Template name', 'Event');
    change('When to use it', 'Community events with preparation and follow-up');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to starting work' }));
    const child = add('task');
    change('Child title', 'Book venue', child);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(
      within(screen.getByRole('region', { name: 'Work definition review' })).getByRole('heading', {
        name: 'Starting work',
      }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Work definition review' })).getByText(
        'Community events with preparation and follow-up',
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('tab', { name: 'Purpose' }));
    expect(screen.getByLabelText('When to use it')).toHaveValue(
      'Community events with preparation and follow-up',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Included work' }));
    expect(screen.getByLabelText('Child title')).toHaveValue('Book venue');
  });
  it('allows standalone work and keeps the starting document out of included-work decisions', () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    expect(screen.getByLabelText('Starting document')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to included work' }));
    expect(screen.getByLabelText('Starting document')).not.toBeVisible();
    expect(screen.getByText('No included work yet')).toBeVisible();
    expect(screen.getByText(/A new project can stand on its own/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Edit parent/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review this definition' }));
    expect(screen.getByRole('button', { name: 'Publish to workspace' })).toBeEnabled();
  });
  it('replaces the overview with one child editor and restores its row on return', async () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    expect(screen.getByLabelText('Starting document')).toBeVisible();
    expect(screen.queryByLabelText('Starting priority')).not.toBeInTheDocument();
    const first = add('task');
    change('Child title', 'Book venue', first);
    expect(screen.queryByLabelText('Team rule')).not.toBeInTheDocument();
    const second = add('task');
    change('Child title', 'Send invitations', second);
    expect(screen.getAllByLabelText('Child title')).toHaveLength(1);
    expect(screen.queryByRole('list', { name: 'Child work outline' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Starting document')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to included work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Book venue' }));
    expect(screen.getByLabelText('Child title')).toHaveValue('Book venue');
    expect(screen.getAllByLabelText('Child title')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dates' }));
    change('Due date rule', 'parent');
    change('Due offset days', '-21');
    fireEvent.click(screen.getByRole('button', { name: 'Back to included work' }));
    expect(screen.queryByLabelText('Child title')).not.toBeInTheDocument();
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
    expect(within(child).getByLabelText('Child title')).toHaveValue('New action');
    fireEvent.click(within(child).getByRole('button', { name: 'Responsibility' }));
    expect(within(child).getByLabelText('Squad rule')).toBeVisible();
    expect(within(child).getByLabelText('Sprint rule')).toBeVisible();
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
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
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
    change('Starting name', 'Community gatherings');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
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
    change('Child title', 'Book venue', task);
    fireEvent.click(within(task).getByLabelText('Optional child'));
    fireEvent.click(within(task).getByLabelText('Selected by default'));
    change('Responsible person', 'creator', task);
    change('Team rule', 'creation_team', task);
    change('Cycle rule', 'current_cycle', task);
    change('Due date rule', 'parent', task);
    change('Due offset days', '-21', task);
    change('Due offset unit', 'working', task);
    change('Due weekday adjustment', 'next', task);
    change('Due weekday', '1', task);
    fireEvent.click(within(task).getByLabelText('Due include anchor weekday'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
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
    fireEvent.click(screen.getByRole('tab', { name: 'Included work' }));
    fireEvent.click(screen.getByRole('button', { name: /Edit Book venue/ }));
    expect(screen.getByLabelText('Child title')).toHaveValue('Book venue');
    fireEvent.click(screen.getByRole('button', { name: 'Dates' }));
    expect(screen.getByLabelText('Due offset days')).toHaveValue(-21);
    expect(screen.getByLabelText('Selected by default')).not.toBeChecked();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('supports nested exact publications, sibling dependencies and completion-relative timing', async () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const first = add('task');
    change('Child title', 'Gather quotes', first);
    change('Nested template', nestedId, first);
    change('Template version', 'pinned', first);
    change('Pinned version', versionId, first);
    const second = add('task');
    change('Child title', 'Pay deposit', second);
    fireEvent.click(within(second).getByRole('button', { name: 'Dates' }));
    fireEvent.click(within(second).getByLabelText('Blocked by Gather quotes'));
    change('Due date rule', 'after_completion', second);
    fireEvent.click(within(second).getByLabelText('Due after Gather quotes completes'));
    change('Due offset days', '2', second);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
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
    fireEvent.click(screen.getByRole('tab', { name: 'Included work' }));
    expect(screen.queryByRole('button', { name: 'Add project' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add subtask' }));
    const first = screen.getByRole('group', { name: /Child work:/ });
    change('Child title', 'Parent task', first);
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
        name: 'Remove child and descendants',
      }),
    );
    expect(screen.queryByRole('group', { name: /Child work:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Included work' })).toHaveFocus();
  });
  it('clears stale sibling timing when a Task moves under its Milestone', async () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const milestone = add('milestone');
    change('Child name', 'Dinner day', milestone);
    const task = add('task');
    change('Child title', 'Prepare venue', task);
    fireEvent.click(within(task).getByRole('button', { name: 'Template and placement' }));
    const milestoneKey = within(task)
      .getByRole('option', { name: 'Dinner day' })
      .getAttribute('value');
    if (!milestoneKey) throw new Error('Missing Milestone parent');
    change('Due date rule', `milestone:${milestoneKey}`, task);
    change('Child parent', milestoneKey, task);
    expect(within(task).getByLabelText('Due date rule')).toHaveValue('none');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
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
    change('Due date rule', 'parent', task);
    const days = within(task).getByLabelText('Due offset days');
    await user.clear(days);
    await user.type(days, '-21');
    expect(days).toHaveValue(-21);
  });
  it('retains unsaved children on navigation and protects the chosen root kind', () => {
    const view = render(<WorkTemplateForm orgId="org" initial={null} onCreated={vi.fn()} />);
    const child = add('task');
    change('Child title', 'Keep unsaved child', child);
    expect(screen.getByLabelText('Kind of work')).toBeDisabled();
    view.unmount();
    render(<WorkTemplateForm orgId="org" initial={null} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Included work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Keep unsaved child' }));
    expect(screen.getByLabelText('Child title')).toHaveValue('Keep unsaved child');
  });
  it('refuses to save incomplete child names instead of submitting a broken draft', () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const child = add('task');
    change('Child title', '', child);
    expect(screen.getByText('Review child work')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });
  it('keeps child edits after a failed save and disables editing for publication-only readers', async () => {
    mocks.draft.mockRejectedValueOnce(new Error('private provider failure'));
    const view = render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    const child = add('task');
    change('Child title', 'Keep my child', child);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Your changes are still here/);
    expect(
      within(screen.getByRole('banner')).getByText('Template could not be saved'),
    ).toBeVisible();
    expect(screen.getByLabelText('Child title')).toHaveValue('Keep my child');
    expect(screen.queryByText('private provider failure')).not.toBeInTheDocument();
    view.unmount();
    render(
      <WorkTemplateForm
        orgId="org"
        initial={{ ...template(), canEdit: false }}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Included work' }));
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled();
  });
});

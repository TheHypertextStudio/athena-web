import { mocks, template, change, add } from './work-template-authoring-fixture';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { WorkTemplateCreate, WorkTemplateOut } from '@docket/work/work-template-contract';
import { expect, it, vi } from 'vitest';
import { WorkTemplateForm } from '@/components/templates/work-template-authoring';

it('shows every creation step and validates purpose before advancing', async () => {
  render(<WorkTemplateForm orgId="org" initial={null} onCreated={vi.fn()} />);
  const navigation = screen.getByRole('navigation', { name: 'Create template' });
  expect(within(navigation).getAllByRole('listitem')).toHaveLength(4);
  expect(within(navigation).getByRole('button', { name: /Starting work/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Continue to starting work' }));
  expect(screen.getByLabelText('Template name')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a template name');
  await waitFor(() =>
    expect(screen.getByRole('group', { name: 'Section needs attention' })).toHaveFocus(),
  );
  change('Template name', 'Event');
  fireEvent.click(screen.getByRole('button', { name: 'Continue to starting work' }));
  expect(screen.getByLabelText('Document')).toBeVisible();
  fireEvent.click(within(navigation).getByRole('button', { name: /Purpose/ }));
  expect(screen.getByLabelText('Template name')).toHaveValue('Event');
});

it('edits saved templates directly without review shortcuts or a creation footer', () => {
  render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /Continue to/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Review definition' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  change('Document', 'Updated');
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
  expect(screen.queryByRole('button', { name: 'Publish to workspace' })).not.toBeInTheDocument();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it('keeps guided creation after the first save and offers explicit private completion', () => {
  render(
    <WorkTemplateForm
      orgId="org"
      initial={template()}
      mode="create"
      initialSection="review"
      onCreated={vi.fn()}
    />,
  );
  expect(screen.getByRole('navigation', { name: 'Create template' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Publish to workspace' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Finish with private draft' })).toBeEnabled();
});

it.each(['create', 'edit'] as const)(
  'ends guided creation after publishing while %s uses its own destination',
  async (mode) => {
    const onFinish = vi.fn();
    mocks.publish.mockResolvedValueOnce({ ...template(), revision: 4, status: 'published' });
    render(
      <WorkTemplateForm
        orgId="org"
        initial={template()}
        mode={mode}
        initialSection="review"
        onCreated={vi.fn()}
        onFinish={onFinish}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish to workspace' }));
    await screen.findByText('Saved');
    expect(onFinish).toHaveBeenCalledTimes(mode === 'create' ? 1 : 0);
  },
);

it('retains Review and offers publication retry after a failed publication', async () => {
  mocks.publish.mockRejectedValueOnce(new Error('private provider diagnostic'));
  const onFinish = vi.fn();
  render(
    <WorkTemplateForm
      orgId="org"
      initial={template()}
      mode="create"
      initialSection="review"
      onCreated={vi.fn()}
      onFinish={onFinish}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Publish to workspace' }));
  await screen.findByText('Could not publish the template.');
  expect(screen.getByRole('button', { name: 'Publish to workspace' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Review' })).toHaveAttribute('aria-current', 'step');
  expect(onFinish).not.toHaveBeenCalled();
  expect(screen.queryByText('private provider diagnostic')).not.toBeInTheDocument();
});

it('requires a team before advancing a team-private draft', () => {
  render(<WorkTemplateForm orgId="org" initial={null} onCreated={vi.fn()} />);
  change('Template name', 'Team event');
  fireEvent.click(screen.getByRole('button', { name: 'Draft privacy · Only you' }));
  fireEvent.change(screen.getByLabelText('Draft visible to'), { target: { value: 'team' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue to starting work' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose the team');
  expect(screen.getByLabelText('Template name')).toBeVisible();
});

function FirstSaveHarness() {
  const [saved, setSaved] = useState<WorkTemplateOut | null>(null);
  return (
    <WorkTemplateForm
      key={saved?.id ?? 'new'}
      orgId="org"
      initial={saved}
      mode="create"
      initialSection={saved ? 'structure' : 'purpose'}
      onCreated={(_id, _section, result) => {
        if (result) setSaved(result);
      }}
    />
  );
}
it('keeps the selected included-work editor through the first save', async () => {
  mocks.create.mockImplementationOnce(async (input: WorkTemplateCreate) => ({
    ...template(),
    definition: input.definition,
  }));
  render(<FirstSaveHarness />);
  const child = add('task');
  change('Title', 'Prepare dinner', child);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Saved draft');
  expect(screen.getByLabelText('Title')).toHaveValue('Prepare dinner');
});

it('keeps creation navigation disabled until a publication settles', async () => {
  let complete: ((value: WorkTemplateOut) => void) | undefined;
  mocks.publish.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  render(
    <WorkTemplateForm
      orgId="org"
      initial={template()}
      mode="create"
      initialSection="review"
      onCreated={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Publish to workspace' }));
  const nav = screen.getByRole('navigation', { name: 'Create template' });
  expect(within(nav).getByRole('button', { name: 'Purpose' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Publishing…' })).toBeDisabled();
  complete?.({ ...template(), revision: 4, status: 'published' });
  await screen.findByText('Saved');
});

it('validates recurring Program work before leaving Included work', () => {
  const initial = template('program');
  initial.definition.defaultSchedules = [
    {
      key: 'weekly',
      name: '',
      template: { targetType: 'task', workTypeId: initial.id, selection: { kind: 'latest' } },
      titlePattern: 'Weekly review',
      cadence: { kind: 'daily', interval: 1, startOffsetDays: 0, end: { kind: 'never' } },
      teamRule: 'parent_team',
      actorRule: 'creator',
    },
  ];
  render(
    <WorkTemplateForm
      orgId="org"
      initial={initial}
      mode="create"
      initialSection="structure"
      onCreated={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue to review' }));
  expect(screen.getByRole('button', { name: 'Included work' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Check the included work');
});

it('offers direct read-only navigation when permission changes during creation', () => {
  render(
    <WorkTemplateForm
      orgId="org"
      initial={{ ...template(), canEdit: false }}
      mode="create"
      onCreated={vi.fn()}
    />,
  );
  expect(screen.getByRole('tab', { name: 'Review' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Continue to/ })).not.toBeInTheDocument();
});

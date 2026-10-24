import { mocks, template, nestedId, versionId, change } from './work-template-authoring-fixture';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkTemplateOut } from '@docket/work/work-template-contract';
import { ProgramDefaultSchedule } from '@docket/work/work-schedule-defaults';
import { WorkTemplateForm } from '@/components/templates/work-template-authoring';

vi.mock('@/components/composer/work-template-picker', () => ({
  WorkTemplatePicker: ({ selectedLabel }: { selectedLabel?: string }) => (
    <button type="button">{selectedLabel ?? 'Template unavailable'}</button>
  ),
}));
function copiedProgram(canEdit = true) {
  const saved = template('program');
  const draft = WorkTemplateOut.parse({
    ...template('task'),
    id: nestedId,
    canEdit,
    pendingPublication: { reservedFirstVersionId: versionId },
    definition: { ...template('task').definition, name: 'Vendor booking' },
  });
  const routine = ProgramDefaultSchedule.parse({
    key: 'vendor',
    name: 'Monthly vendor review',
    template: {
      targetType: 'task',
      workTypeId: nestedId,
      selection: { kind: 'pinned', workTypeVersionId: versionId },
    },
    titlePattern: 'Vendor review',
    cadence: { kind: 'monthly', interval: 1, pattern: { kind: 'day_of_month', day: 1 } },
    teamRule: 'parent_team',
    actorRule: 'parent_responsible',
  });
  mocks.catalog = [draft];
  return WorkTemplateOut.parse({
    ...saved,
    definition: { ...saved.definition, defaultSchedules: [routine] },
  });
}
describe('honest copied Program routine pins', () => {
  it('preserves an actual pending pin while editing rhythm and links to its authorized draft', async () => {
    const saved = copiedProgram();
    render(<WorkTemplateForm orgId={saved.organizationId} initial={saved} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Included work' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit repeating work Monthly vendor review' }),
    );
    expect(screen.getByRole('button', { name: 'Unpublished Vendor booking' })).toBeVisible();
    expect(screen.queryByText('Template unavailable')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Template updates for repeating work')).not.toBeInTheDocument();
    expect(screen.queryByText(/Keep the selected version/)).not.toBeInTheDocument();
    const review = screen.getByRole('link', { name: 'Review Vendor booking' });
    expect(review).toHaveAttribute(
      'href',
      `/orgs/${saved.organizationId}/work-templates/${nestedId}?section=review&returnTo=${saved.id}`,
    );
    change('Repeat interval', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => {
      expect(mocks.draft).toHaveBeenCalled();
    });
    expect(mocks.draft.mock.calls[0]?.[0].definition.defaultSchedules[0]).toMatchObject({
      template: { selection: { kind: 'pinned', workTypeVersionId: versionId } },
      cadence: { interval: 2 },
    });
  });
  it('shows an authorized read-only draft honestly without offering an authoring review action', () => {
    const saved = copiedProgram(false);
    render(<WorkTemplateForm orgId={saved.organizationId} initial={saved} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Included work' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit repeating work Monthly vendor review' }),
    );
    expect(screen.getByText(/first published version/)).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Review Vendor booking' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Template updates for repeating work')).not.toBeInTheDocument();
  });
});

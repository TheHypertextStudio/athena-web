import {
  template,
  change,
  add,
  nestedId,
  versionId,
  mocks,
} from './work-template-authoring-fixture';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkTemplateForm } from '@/components/templates/work-template-authoring';
describe('work definition publication review', () => {
  it('offers review for a saved draft and deliberate publication with its sharing consequence', () => {
    render(<WorkTemplateForm orgId="org" initial={template()} onCreated={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review definition' }));
    expect(screen.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true');
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('button', { name: 'Publish to workspace' })).toBeEnabled();
    expect(
      within(header).getByText(/Publishing shares this definition with everyone/),
    ).toBeVisible();
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each(['archived', 'read-only'] as const)(
    'keeps saved status without a redundant action when %s work is already in Review',
    (state) => {
      const initial = template();
      if (state === 'archived') initial.status = 'archived';
      else initial.canEdit = false;
      render(<WorkTemplateForm orgId="org" initial={initial} onCreated={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Review definition' }));
      const header = screen.getByRole('banner');
      expect(within(header).queryByRole('button')).not.toBeInTheDocument();
      expect(within(header).getByRole('status')).toHaveTextContent('Saved draft');
      expect(screen.getByRole('tab', { name: 'Review' })).toHaveAttribute('aria-selected', 'true');
      fireEvent.click(screen.getByRole('tab', { name: 'Work' }));
      expect(within(header).getByRole('button', { name: 'Review definition' })).toBeEnabled();
    },
  );
  it.each([
    ['initiative', 'program', 'Program instructions'],
    ['program', 'project', 'Project instructions'],
    ['project', 'milestone', 'Milestone instructions'],
  ] as const)('reads %s child %s documents in the publication review', (root, kind, body) => {
    render(<WorkTemplateForm orgId="org" initial={template(root)} onCreated={vi.fn()} />);
    const child = add(kind);
    change('Child name', `Sample ${kind}`, child);
    change('Child document', body, child);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    const review = screen.getByRole('region', { name: 'Work definition review' });
    expect(
      within(review).getByText(
        `${kind[0]?.toLocaleUpperCase()}${kind.slice(1)} · Under Community dinner`,
      ),
    ).toBeVisible();
    fireEvent.click(
      within(review).getByRole('button', { name: `Starting details for Sample ${kind}` }),
    );
    expect(within(review).getByText(body)).toBeVisible();
  });

  it('reviews actual starting values, blockers, cycles and pinned nested publications', () => {
    const initial = template();
    initial.definition.payload = {
      targetType: 'project',
      name: 'Community dinner sample',
      summary: 'An accessible neighborhood meal',
      priority: 'high',
      health: 'at_risk',
    };
    initial.definition.defaultStatusKey = 'backlog';
    render(<WorkTemplateForm orgId="org" initial={initial} onCreated={vi.fn()} />);
    const first = add('task');
    change('Child title', 'Book venue', first);
    change('Child summary', 'Confirm capacity and access', first);
    change('Child document', '## Venue terms', first);
    fireEvent.click(within(first).getByRole('button', { name: 'Child properties' }));
    change('Child priority', 'high', first);
    const second = add('task');
    change('Child title', 'Confirm accessibility', second);
    change('Cycle rule', 'current_cycle', second);
    fireEvent.click(within(second).getByLabelText('Blocked by Book venue'));
    change('Nested template', nestedId, second);
    change('Template version', 'pinned', second);
    change('Pinned version', versionId, second);
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    const review = screen.getByRole('region', { name: 'Work definition review' });
    expect(within(review).getByText('Community dinner sample')).toBeVisible();
    expect(within(review).getByText('An accessible neighborhood meal')).toBeVisible();
    expect(within(review).getByText(/High priority.*At risk.*Backlog/)).toBeVisible();
    expect(within(review).getByText('Blocked by Book venue')).toBeVisible();
    fireEvent.click(
      within(review).getByRole('button', { name: 'Starting details for Book venue' }),
    );
    expect(within(review).getByText('Confirm capacity and access')).toBeVisible();
    expect(within(review).getByRole('heading', { name: 'Venue terms' })).toBeVisible();
    expect(within(review).getByText('High priority')).toBeVisible();
    expect(within(review).getByText('Current cycle for the selected team')).toBeVisible();
    expect(within(review).getByText('Vendor booking · Fixed at Version 2')).toBeVisible();
  });
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkTemplatePicker } from '@/components/composer/work-template-picker';

const mocks = vi.hoisted(() => ({
  query: { data: { items: [] as unknown[] }, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/lib/query', () => ({ useApiQuery: () => mocks.query }));
vi.mock('@/components/statuses/queries', () => ({ statusSetsDef: () => ({}) }));
vi.mock('@/components/templates/work-template-queries', () => ({ workTemplatesDef: () => ({}) }));
const base = {
  id: 'base',
  targetType: 'project',
  isBase: true,
  status: 'published',
  offeredTeamIds: [],
  definition: { name: 'Blank project', payload: { targetType: 'project' } },
  latestVersion: { id: 'base-v1', number: 1 },
};
const event = {
  ...base,
  id: 'event',
  isBase: false,
  definition: { name: 'Event', payload: { targetType: 'project', description: 'Preparation' } },
  latestVersion: { id: 'event-v2', number: 2 },
};
afterEach(() => {
  cleanup();
  mocks.query.isPending = false;
});
describe('persistent work-template picker', () => {
  it('waits for discovery before calling a selected template unavailable', () => {
    mocks.query.data.items = [];
    mocks.query.isPending = true;
    const view = render(
      <WorkTemplatePicker
        orgId="01J00000000000000000000000"
        kind="project"
        teamId={null}
        selectedId="event"
        onSelect={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Loading template/ })).toBeDisabled();
    expect(screen.queryByText('Template unavailable')).not.toBeInTheDocument();
    mocks.query.isPending = false;
    mocks.query.data.items = [base, event];
    view.rerender(
      <WorkTemplatePicker
        orgId="01J00000000000000000000000"
        kind="project"
        teamId={null}
        selectedId="event"
        onSelect={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Event/ })).toBeEnabled();
  });

  it('shows the selected publication after authored prose exists and offers the base', async () => {
    mocks.query.data.items = [base, event];
    const onSelect = vi.fn();
    render(
      <WorkTemplatePicker
        orgId="01J00000000000000000000000"
        kind="project"
        teamId={null}
        selectedId="event"
        selectedVersionId="event-v2"
        onSelect={onSelect}
        disabled={false}
      />,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: /Event/ }), {
      button: 0,
      ctrlKey: false,
      pointerType: 'mouse',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Blank project/ }));
    expect(onSelect).toHaveBeenCalledWith(base);
  });
  it('retains an unavailable identity visibly instead of silently swapping its template', () => {
    mocks.query.data.items = [base];
    render(
      <WorkTemplatePicker
        orgId="01J00000000000000000000000"
        kind="project"
        teamId={null}
        selectedId="removed"
        selectedVersionId="old"
        onSelect={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByRole('button', { name: /Template unavailable/ })).toBeVisible();
  });
});

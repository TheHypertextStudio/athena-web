import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { WorkViewTabs } from '@/components/work-views/work-view-tabs';
vi.mock('@/components/docket-link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
it('keeps view filtering, favorites, and destination navigation as separate actions', () => {
  const onSelect = vi.fn();
  const onToggleFavorite = vi.fn();
  render(
    <WorkViewTabs
      title="Projects"
      selectedViewId={null}
      savedViews={[{ id: 'v1', name: 'Upcoming' }]}
      favoriteViewIds={new Set()}
      dependenciesHref="/projects/dependencies"
      savedViewsError={null}
      contentFailed={false}
      onSelect={onSelect}
      onToggleFavorite={onToggleFavorite}
      onRetrySavedViews={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
  expect(onSelect).toHaveBeenCalledWith('v1');
  fireEvent.click(screen.getByRole('button', { name: 'Add Upcoming to favorites' }));
  expect(onToggleFavorite).toHaveBeenCalledWith('v1');
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: 'Dependencies' })).toHaveAttribute(
    'href',
    '/projects/dependencies',
  );
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
});

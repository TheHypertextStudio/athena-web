import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';
import { LibraryDefineEntry } from '@/components/templates/gallery/work-template-library-entry';
vi.mock('@/components/docket-link', () => ({
  default: ({
    navigation: _navigation,
    ...props
  }: ComponentProps<'a'> & { navigation?: string }) => <a {...props} />,
}));
it('offers an explicit label-example suggestion activity without replacing manual starting points', () => {
  const orgId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  render(<LibraryDefineEntry orgId={orgId} />);
  expect(screen.getByRole('link', { name: 'Suggest from labels' })).toHaveAttribute(
    'href',
    `/orgs/${orgId}/work-templates/suggest-from-labels`,
  );
  expect(screen.getByRole('link', { name: 'Browse starting points' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Define work' })).toBeVisible();
});

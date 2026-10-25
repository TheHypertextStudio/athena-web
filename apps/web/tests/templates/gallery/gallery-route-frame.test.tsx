import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactElement } from 'react';
import { ContextProvider } from '@docket/ui/components';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GalleryPage from '@/app/(activity)/orgs/[orgId]/work-templates/gallery/page';
import { useGalleryWorkspace } from '@/components/templates/gallery/gallery-workspace';
vi.mock('@/components/docket-link', () => ({
  default: ({
    navigation: _navigation,
    ...props
  }: ComponentProps<'a'> & { navigation?: string }) => <a {...props} />,
}));
const location = vi.hoisted(() => ({ search: '' }));
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'signed-in-viewer' } } }),
}));
vi.mock('@/lib/app-location', () => ({
  useTypedRoute: () => ({ params: { orgId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' } }),
  useAppSearchParams: () => new URLSearchParams(location.search),
  shellScrollPosition: () => ({ top: 0, left: 0 }),
  restoreShellScroll: vi.fn(),
}));
vi.mock('@/components/templates/gallery/gallery-browse-page', () => ({
  GalleryBrowsePage: () => {
    const state = useGalleryWorkspace();
    return (
      <p>
        {state.scope.userId} in {state.scope.orgId}
        <span data-testid="fork">{state.memory.filters.fork ?? 'none'}</span>
        <span data-testid="selection">{state.memory.choices.roots.join(',')}</span>
      </p>
    );
  },
}));
function renderGallery(ui: ReactElement) {
  return render(<ContextProvider>{ui}</ContextProvider>);
}
afterEach(cleanup);
beforeEach(() => {
  location.search = '';
  window.sessionStorage.clear();
});
it('owns its authenticated frame when the existing local route outlet mounts the page without Next layouts', () => {
  renderGallery(<GalleryPage />);
  expect(screen.getByText('signed-in-viewer in 01ARZ3NDEKTSV4RRFFQ69G5FAX')).toBeVisible();
});

it.each(['startup', 'nonprofit', 'agency', 'personal'])(
  'opens the ordinary gallery in the explicit %s starter context with no implicit installation',
  (fork) => {
    location.search = `fork=${fork}`;
    renderGallery(<GalleryPage />);
    expect(screen.getByTestId('fork')).toHaveTextContent(fork);
    expect(screen.getByTestId('selection')).toBeEmptyDOMElement();
  },
);
it('ignores an invalid audience URL instead of trusting it as catalog membership', () => {
  location.search = 'fork=unknown';
  renderGallery(<GalleryPage />);
  expect(screen.getByTestId('fork')).toHaveTextContent('none');
});

it('provides a focused activity with one exit to ordinary work outside its single scroll owner', () => {
  renderGallery(<GalleryPage />);
  const exit = screen.getByRole('link', { name: 'Back to Work templates' });
  expect(exit).toHaveAttribute('href', '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FAX/work-templates');
  expect(screen.getByRole('main')).not.toContainElement(exit);
  expect(screen.getByRole('main').closest('[data-navigation-context]')).toHaveAttribute(
    'data-navigation-context',
    'activity',
  );
  expect(screen.getAllByRole('navigation')).toHaveLength(1);
});

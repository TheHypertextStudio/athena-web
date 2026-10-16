import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import GalleryPage from '@/app/(app)/orgs/[orgId]/settings/templates/gallery/page';
import { useGalleryWorkspace } from '@/components/templates/gallery/gallery-workspace';
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'signed-in-viewer' } } }),
}));
vi.mock('@/lib/app-location', () => ({
  useTypedRoute: () => ({ params: { orgId: 'actual-workspace' } }),
  shellScrollPosition: () => ({ top: 0, left: 0 }),
  restoreShellScroll: vi.fn(),
}));
vi.mock('@/components/templates/gallery/gallery-browse-page', () => ({
  GalleryBrowsePage: () => {
    const state = useGalleryWorkspace();
    return (
      <p>
        {state.scope.userId} in {state.scope.orgId}
      </p>
    );
  },
}));
afterEach(cleanup);
it('owns its authenticated frame when the existing local route outlet mounts the page without Next layouts', () => {
  render(<GalleryPage />);
  expect(screen.getByText('signed-in-viewer in actual-workspace')).toBeVisible();
});

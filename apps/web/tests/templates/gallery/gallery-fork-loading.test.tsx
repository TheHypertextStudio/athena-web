import type { ComponentProps } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  WorkTemplateGalleryForkSet,
  WorkTemplateGalleryItem,
} from '@docket/work/template-gallery-contract';
import type { GalleryWorkspaceState } from '@/components/templates/gallery/gallery-workspace';
import { GalleryBrowsePage } from '@/components/templates/gallery/gallery-browse-page';
import { galleryItems } from './gallery-fixture';
const read = vi.hoisted(() => ({
  data: undefined as WorkTemplateGalleryForkSet | undefined,
  isPending: true,
  isError: false,
  error: null,
  isFetching: true,
  refetch: vi.fn(),
}));
const state = vi.hoisted(() => ({
  scope: { userId: 'viewer', orgId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
  memory: {
    filters: { fork: 'nonprofit' as const },
    view: 'suggested' as const,
    choices: {
      roots: ['community-event'],
      release: 1 as const,
      mode: 'private_drafts' as const,
      labels: [],
      offerings: [],
    },
  },
  browseReturn: { restore: vi.fn(), remember: vi.fn() },
  change: vi.fn(),
}));
vi.mock('@/lib/query', () => ({ useApiQuery: () => read }));
vi.mock('@/lib/interactions/navigation', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/components/templates/work-template-gallery-queries', () => ({
  templateGalleryForkDef: () => ({}),
}));
vi.mock('@/components/templates/gallery/use-gallery-catalog', () => ({
  useGalleryCatalog: () => ({ items: galleryItems, pending: false, failed: false }),
}));
vi.mock('@/components/templates/gallery/gallery-workspace', () => ({
  useGalleryWorkspace: () => state,
  gallerySelectedItems: (
    current: GalleryWorkspaceState,
    items: readonly WorkTemplateGalleryItem[],
  ) => items.filter((item) => current.memory.choices.roots.includes(item.slug)),
}));
afterEach(cleanup);
beforeEach(() => {
  read.data = undefined;
  read.isPending = true;
  read.isError = false;
  read.error = null;
  read.isFetching = true;
  state.change.mockClear();
});
it('waits for complete fork facts without a false empty result or zero count, then retains the selection', () => {
  const page = render(<GalleryBrowsePage />);
  expect(screen.getByRole('status', { name: 'Loading' })).toBeVisible();
  expect(screen.queryByText('No templates match these filters.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'All nonprofit work (0)' })).not.toBeInTheDocument();
  expect(state.change).not.toHaveBeenCalled();
  read.data = {
    release: 1,
    fork: 'nonprofit',
    items: galleryItems.filter((item) => item.forks.includes('nonprofit')),
  };
  read.isPending = false;
  read.isFetching = false;
  page.rerender(<GalleryBrowsePage />);
  expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All nonprofit work (47)' })).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Select Community event' })).toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('1 selected');
});
it.each([
  undefined,
  { release: 1, fork: 'startup', items: [] } satisfies WorkTemplateGalleryForkSet,
])(
  'does not turn missing or wrong-fork response %j into empty authoritative membership',
  (data) => {
    read.isPending = false;
    read.isFetching = false;
    read.data = data;
    render(<GalleryBrowsePage />);
    expect(screen.queryByRole('button', { name: /All nonprofit work/ })).not.toBeInTheDocument();
    expect(screen.queryByText('No templates match these filters.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload starting points' })).toBeVisible();
  },
);

import { useState, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkTemplateGalleryItem,
  WorkTemplateGalleryQuery,
} from '@docket/work/template-gallery-contract';
import { GALLERY_OUTCOMES } from '@/components/templates/gallery/gallery-metadata';
import { GalleryBrowse } from '@/components/templates/gallery/gallery-browse';
import { GalleryEntry } from '@/components/templates/gallery/gallery-entry';
import { GalleryReview } from '@/components/templates/gallery/gallery-review';
import {
  galleryFixture,
  galleryItems,
  galleryPreview,
  fullStartupPreview,
} from './gallery-fixture';
vi.mock('@/components/docket-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/components/editor/static-markdown', () => ({
  StaticMarkdown: ({ value }: { value: string }) => <p>{value}</p>,
}));
afterEach(cleanup);
function Browse({ onReview }: { onReview: (items: readonly WorkTemplateGalleryItem[]) => void }) {
  const [selected, onSelect] = useState<readonly WorkTemplateGalleryItem[]>([]);
  const [filters, onFilters] = useState<WorkTemplateGalleryQuery>({ fork: 'startup' });
  return (
    <GalleryBrowse
      items={galleryItems.slice(0, 50)}
      forkItems={galleryItems.filter((item) => item.forks.includes('startup'))}
      filters={filters}
      selected={selected}
      baseHref="/gallery"
      onFilters={onFilters}
      onSelect={onSelect}
      onReview={() => {
        onReview(selected);
      }}
    />
  );
}
describe('gallery organization choices', () => {
  it('starts with no implicit selection and selects the complete60-entry fork beyond browse paging', () => {
    const onReview = vi.fn();
    render(<Browse onReview={onReview} />);
    expect(screen.getByRole('heading', { name: 'Ship a product' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Review selection' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All startup work (60)' }));
    expect(screen.getByRole('status')).toHaveTextContent('60 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Review selection' }));
    expect(onReview.mock.calls[0]?.[0]).toHaveLength(60);
    expect(
      new Set(onReview.mock.calls[0]?.[0].map((item: WorkTemplateGalleryItem) => item.slug)).size,
    ).toBe(60);
  });
  it('keeps explicit selection through search changes and links independently from its checkbox', async () => {
    const user = userEvent.setup();
    render(<Browse onReview={vi.fn()} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Select Product launch' });
    checkbox.focus();
    await user.keyboard(' ');
    expect(checkbox).toBeChecked();
    expect(checkbox.closest('a')).toBeNull();
    expect(screen.getByRole('link', { name: 'Product launch' })).toHaveAttribute(
      'href',
      '/gallery/product-launch',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Find specific work' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search templates' }), {
      target: { value: 'missing' },
    });
    expect(screen.getByRole('status')).toHaveTextContent('1 selected');
  });
  it('keeps applied audience filtering visible while filter controls are collapsed', () => {
    render(<Browse onReview={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Starting points for' })).toHaveValue('startup');
  });
  it('displays actual nested instructions and keeps routines reachable when included work is collapsed', () => {
    const source = galleryFixture('client-engagement');
    render(
      <GalleryEntry
        detail={{
          ...source,
          references: [galleryFixture('kickoff'), galleryFixture('monthly-client-report')],
        }}
        selected={false}
        onSelect={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    const recurring = screen.getByRole('region', { name: 'Recurring work' });
    expect(within(recurring).getByRole('heading', { name: 'Monthly client report' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Included work/ }));
    expect(within(recurring).getByRole('heading', { name: 'Monthly client report' })).toBeVisible();
    expect(screen.getByText(/These routines begin when you create/)).toBeVisible();
  });
});
describe('real callback gallery review', () => {
  it('reads the actual rewritten document and required dependency without accepting on open', () => {
    const preview = galleryPreview(),
      onAccept = vi.fn();
    render(
      <GalleryReview
        preview={preview}
        workspaceName="Neighborhood association"
        selectedItems={[galleryFixture('event')]}
        state={{ pending: false, updating: false, error: null }}
        onMode={vi.fn()}
        onAccept={onAccept}
        onBack={vi.fn()}
      />,
    );
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Your starting work' })).getByRole('button', {
        name: 'Inspect Event',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Read starting instructions' }));
    expect(screen.getByText('Reviewed destination instructions.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to review' }));
    fireEvent.click(screen.getByRole('button', { name: '1 required template' }));
    expect(
      within(screen.getByRole('region', { name: 'Required templates' })).getByRole('button', {
        name: 'Vendor booking',
      }),
    ).toBeVisible();
    expect(onAccept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep private drafts' }));
    expect(onAccept).toHaveBeenCalledExactlyOnceWith(preview);
    expect(screen.queryByText(/drafts kept/)).not.toBeInTheDocument();
  });
  it('groups the full approved fork without mounting60 outlines and restores a focused group', async () => {
    const preview = await fullStartupPreview();
    render(
      <GalleryReview
        preview={preview}
        outcomes={GALLERY_OUTCOMES.startup}
        selectedItems={galleryItems.filter((item) => item.forks.includes('startup'))}
        workspaceName="Studio"
        state={{ pending: false, updating: false, error: null }}
        onMode={vi.fn()}
        onAccept={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(
      screen
        .getByRole('region', { name: 'Your starting work' })
        .compareDocumentPosition(
          screen.getByRole('region', { name: 'Destination and visibility' }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Starting work' })).not.toBeInTheDocument();
    expect(screen.getByText(/60 selected/)).toBeVisible();
    expect(screen.getByRole('heading', { name: /Ship a product/ })).toBeVisible();
    const launch = screen.getByRole('button', { name: 'Inspect Product launch' });
    launch.focus();
    fireEvent.click(launch);
    expect(screen.getByRole('heading', { name: 'Starting work' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Back to review' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Inspect Product launch' })).toHaveFocus();
    });
  });
  it('requires a newly checked visibility preview and blocks acceptance while it is updating', () => {
    const preview = galleryPreview(),
      onMode = vi.fn(),
      onAccept = vi.fn();
    const props = {
      preview,
      workspaceName: 'Neighborhood association',
      selectedItems: [galleryFixture('event')],
      onMode,
      onAccept,
      onBack: vi.fn(),
    };
    const view = render(
      <GalleryReview {...props} state={{ pending: false, updating: false, error: null }} />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Who can see these templates' }), {
      target: { value: 'published' },
    });
    expect(onMode).toHaveBeenCalledExactlyOnceWith('published');
    expect(onAccept).not.toHaveBeenCalled();
    view.rerender(
      <GalleryReview {...props} state={{ pending: false, updating: true, error: null }} />,
    );
    expect(screen.getByRole('button', { name: 'Keep private drafts' })).toBeDisabled();
    view.rerender(
      <GalleryReview
        {...props}
        preview={{ ...preview, mode: 'published' }}
        state={{ pending: false, updating: false, error: 'Review the updated selection.' }}
      />,
    );
    expect(screen.getByText(/Members of Neighborhood association can see/)).toBeVisible();
    expect(screen.getByText('Review the updated selection.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to workspace' }));
    expect(onAccept).toHaveBeenCalledExactlyOnceWith({ ...preview, mode: 'published' });
  });
});

it('starts with organization context before an explicit all-work browse', () => {
  render(
    <GalleryBrowse
      items={galleryItems}
      forkItems={[]}
      filters={{}}
      selected={[]}
      baseHref="/gallery"
      onFilters={vi.fn()}
      onSelect={vi.fn()}
      onReview={vi.fn()}
    />,
  );
  expect(screen.queryByRole('checkbox', { name: 'Select Event' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Browse all starting points' }));
  expect(screen.getByRole('tab', { name: 'All templates' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
it('restores the chosen all-work view instead of replacing it with suggestions after detail return', () => {
  render(
    <GalleryBrowse
      view="all"
      items={galleryItems}
      forkItems={galleryItems.filter((item) => item.forks.includes('startup'))}
      filters={{ fork: 'startup' }}
      selected={[]}
      baseHref="/gallery"
      onFilters={vi.fn()}
      onSelect={vi.fn()}
      onReview={vi.fn()}
    />,
  );
  expect(screen.getByRole('tab', { name: 'All templates' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.queryByRole('heading', { name: 'Ship a product' })).not.toBeInTheDocument();
});

it('keeps a bounded selection recoverable when another full fork would exceed the review limit', () => {
  const excluded = galleryItems.find((item) => item.forks.includes('startup'));
  const selected = galleryItems.filter((item) => item !== excluded).slice(0, 100);
  const onSelect = vi.fn();
  render(
    <GalleryBrowse
      items={galleryItems}
      forkItems={galleryItems.filter((item) => item.forks.includes('startup'))}
      filters={{ fork: 'startup' }}
      selected={selected}
      baseHref="/gallery"
      onFilters={vi.fn()}
      onSelect={onSelect}
      onReview={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'All startup work (60)' }));
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByText('100 selected')).toBeVisible();
  expect(screen.getByText(/Choose up to 100 starting points/)).toBeVisible();
});

it('leads composed work with its actual structure and discloses the starting document on demand', () => {
  const source = galleryFixture('client-engagement');
  render(
    <GalleryEntry
      detail={{
        ...source,
        references: [galleryFixture('kickoff'), galleryFixture('monthly-client-report')],
      }}
      selected={false}
      onSelect={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  const included = screen.getByRole('button', { name: /Included work/ });
  const instructions = screen.getByRole('button', { name: 'Read starting instructions' });
  expect(
    included.compareDocumentPosition(instructions) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    within(screen.getByRole('region', { name: 'Starting work' })).queryByText(/## Purpose/),
  ).not.toBeInTheDocument();
  fireEvent.click(instructions);
  expect(
    within(screen.getByRole('region', { name: 'Starting work' })).getByText(/## Purpose/),
  ).toBeVisible();
});

it('keeps gallery view controls before the outcome groups', () => {
  render(<Browse onReview={vi.fn()} />);
  expect(
    screen
      .getByRole('button', { name: 'All startup work (60)' })
      .compareDocumentPosition(screen.getByRole('heading', { name: 'Ship a product' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
it('reviews one chosen work directly without category and kind heading wrappers', () => {
  render(
    <GalleryReview
      preview={galleryPreview()}
      workspaceName="Studio"
      selectedItems={[galleryFixture('event')]}
      state={{ pending: false, updating: false, error: null }}
      onMode={vi.fn()}
      onAccept={vi.fn()}
      onBack={vi.fn()}
    />,
  );
  const work = within(screen.getByRole('region', { name: 'Your starting work' }));
  expect(work.queryByRole('heading', { name: 'Your starting work' })).not.toBeInTheDocument();
  expect(work.queryByRole('heading', { name: /Events|Projects/ })).not.toBeInTheDocument();
  expect(work.getByRole('button', { name: 'Inspect Event' })).toBeVisible();
});

it('offers the next review step from a selected template detail', () => {
  const onReview = vi.fn();
  render(
    <GalleryEntry
      detail={{ ...galleryFixture('event'), references: [galleryFixture('vendor-booking')] }}
      selected
      onSelect={vi.fn()}
      onBack={vi.fn()}
      onReview={onReview}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review selection' }));
  expect(onReview).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Remove from selection' })).toBeVisible();
});

import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  EntityDetailLayout,
  EntityMetadataItem,
  EntityMetadataRow,
} from '../../src/components/views/entity-detail-layout';

describe('EntityDetailLayout', () => {
  it('keeps object context on a masthead that cannot be dragged', () => {
    const { container } = render(
      <EntityDetailLayout
        object={{
          kind: 'project',
          id: 'project-1',
          organizationId: 'org-1',
          title: 'Launch',
        }}
        icon={<span>icon</span>}
        title="Launch"
        actions={<button type="button">Publish</button>}
        tabs={<div>tabs</div>}
      >
        <div>body</div>
      </EntityDetailLayout>,
    );

    const header = container.querySelector('header');
    expect(header).toHaveAttribute('data-object-kind', 'project');
    expect(header).toHaveAttribute('draggable', 'false');
    expect(header).not.toHaveClass('cursor-grab');

    const primary = header?.querySelector('.detail-primary');
    expect(primary).not.toBeNull();
    expect(within(primary as HTMLElement).getByRole('button', { name: 'Publish' })).toBeVisible();
    expect(primary?.querySelector('.detail-identity')).not.toBeNull();
  });

  it('bleeds the cover to the header/main edges rather than the gutter-inset measure track', () => {
    render(
      <EntityDetailLayout
        icon={<span>icon</span>}
        title="Launch"
        tabs={<div>tabs</div>}
        cover={<div data-testid="cover-content" />}
      >
        <div>body</div>
      </EntityDetailLayout>,
    );

    const coverWrapper = screen.getByTestId('cover-content').parentElement;
    // Every other direct child of a `.page-grid` element defaults to the gutter-inset `measure`
    // track (see `.page-grid > *` in globals.css); an absolutely-positioned cover is no exception,
    // so without `page-bleed` its `inset-0` was flush with that inset track, not with the header —
    // the gap this test guards against actually shipped once already.
    expect(coverWrapper).toHaveClass('page-bleed', 'absolute', 'inset-0');
    // Matches `<main>`'s own `lg:rounded-xl` on purpose: the cover's rect now coincides exactly
    // with `<main>`'s, so an unmatched radius here would make `<main>` clip it unpredictably.
    expect(coverWrapper).toHaveClass('rounded-t-xl');
  });

  it('keeps the eyebrow/title indent off the cover, so the cover reaches the band without a gap', () => {
    render(
      <EntityDetailLayout
        icon={<span>icon</span>}
        title="Launch"
        tabs={<div>tabs</div>}
        cover={<div data-testid="cover-content" />}
      >
        <div>body</div>
      </EntityDetailLayout>,
    );

    const coverWrapper = screen.getByTestId('cover-content').parentElement;
    const band = coverWrapper?.closest('.masthead-band');
    const paddedContent = band?.querySelector('.masthead-content');
    // `.masthead-content` (which carries the indent that used to sit on `.detail-header`) must be
    // the cover's *sibling*, not its ancestor — padding on an ancestor of an `inset-0` cover pushes
    // the cover down with it and reopens the exact top gap this test guards against, which shipped
    // once already the moment the padding moved one level too high.
    expect(paddedContent?.contains(coverWrapper ?? null)).toBe(false);
    expect(coverWrapper?.contains(paddedContent ?? null)).toBe(false);
  });

  it('structurally excludes the tab row from the cover, rather than painting over it', () => {
    render(
      <EntityDetailLayout
        icon={<span>icon</span>}
        title="Launch"
        tabs={<div>tabs</div>}
        cover={<div data-testid="cover-content" />}
      >
        <div>body</div>
      </EntityDetailLayout>,
    );

    const coverWrapper = screen.getByTestId('cover-content').parentElement;
    const tabsRow = screen.getByText('tabs').closest('.detail-tabs');
    // Not a z-index bet, not an opaque backing standing in for a boundary: the cover's positioned
    // ancestor (`.masthead-band`) simply does not contain `.detail-tabs` at all, so there is no
    // lower edge for the cover to cross in the first place, in any scroll or collapse state.
    expect(coverWrapper?.closest('.masthead-band')?.contains(tabsRow)).toBe(false);
    expect(tabsRow?.contains(coverWrapper)).toBe(false);
    // `.detail-tabs` is the masthead band's next sibling, not its descendant.
    expect(coverWrapper?.closest('.masthead-band')?.nextElementSibling).toBe(tabsRow);
  });
});

describe('EntityMetadataRow', () => {
  it('keeps one inline row and preserves every property in its overflow popover', async () => {
    render(
      <EntityMetadataRow ariaLabel="Project properties">
        <EntityMetadataItem priority={0}>
          <button type="button">Status</button>
        </EntityMetadataItem>
        <EntityMetadataItem priority={1}>
          <button type="button">Health</button>
        </EntityMetadataItem>
      </EntityMetadataRow>,
    );

    const row = screen.getByRole('group', { name: 'Project properties' });
    expect(row).toHaveClass('flex-nowrap');
    expect(row.querySelector('[data-entity-metadata-inline]')).toHaveClass('flex-nowrap');

    fireEvent.click(screen.getByRole('button', { name: 'More Project properties' }));
    const overflow = await screen.findByRole('group', {
      name: 'More Project properties',
    });
    expect(within(overflow).getByRole('button', { name: 'Status' })).toBeVisible();
    expect(within(overflow).getByRole('button', { name: 'Health' })).toBeVisible();
  });
});

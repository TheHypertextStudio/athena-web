import '@testing-library/jest-dom/vitest';

import { assertDefined } from '@docket/test-utils';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EntityDetailLayout,
  EntityMetadataItem,
  EntityMetadataRow,
  fitEntityMetadataPriority,
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
    expect(header).not.toHaveAttribute('draggable');
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

  it('renders a static print brief outside the interactive masthead and active tab panel', () => {
    const { container } = render(
      <EntityDetailLayout
        icon={<button type="button">Edit icon</button>}
        title="Launch"
        subtitle="Ship the public beta"
        actions={<button type="button">Publish</button>}
        tabs={<div role="tablist">tabs</div>}
        printSummary={<section data-testid="print-brief">Printable launch brief</section>}
      >
        <div role="tabpanel">Interactive overview</div>
      </EntityDetailLayout>,
    );

    const printBrief = screen.getByTestId('print-brief');
    expect(printBrief.closest('.detail-print-summary')).not.toBeNull();
    expect(printBrief.closest('.detail-body')).not.toBeNull();
    expect(printBrief.closest('header')).toBeNull();
    expect(container.querySelector('.detail-header')).toHaveClass('detail-print-hidden');
  });
});

describe('EntityMetadataRow', () => {
  let resize: ResizeObserverCallback;

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const priority = this.getAttribute('data-entity-metadata-priority');
      const width = priority === null ? 0 : 80;
      return {
        x: 0,
        y: 0,
        top: 0,
        right: width,
        bottom: 28,
        left: 0,
        width,
        height: 28,
        toJSON: () => ({}),
      };
    });
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        readonly callback: ResizeObserverCallback;

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }

        observe(target: Element): void {
          if (!target.hasAttribute('data-entity-metadata-item')) resize = this.callback;
        }
        unobserve(): void {
          return undefined;
        }
        disconnect(): void {
          return undefined;
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function resizeRow(width: number): void {
    act(() => {
      resize([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    });
  }

  it('partitions visible and overflow properties without duplicating either set', async () => {
    render(
      <EntityMetadataRow ariaLabel="Project properties">
        <EntityMetadataItem priority={0}>
          <button type="button">Status</button>
        </EntityMetadataItem>
        <EntityMetadataItem priority={1}>
          <button type="button">Health</button>
        </EntityMetadataItem>
        <EntityMetadataItem priority={2}>
          <button type="button">Target date</button>
        </EntityMetadataItem>
        <EntityMetadataItem priority={3}>
          <button type="button">Lead</button>
        </EntityMetadataItem>
      </EntityMetadataRow>,
    );

    resizeRow(260);

    const row = screen.getByRole('group', { name: 'Project properties' });
    expect(row).toHaveClass('flex-nowrap');
    expect(row).toHaveAttribute('data-control-size', 'sm');
    expect(row.querySelector('[data-entity-metadata-inline]')).toHaveClass('flex-nowrap');
    const inline = within(
      assertDefined(row.querySelector<HTMLElement>('[data-entity-metadata-inline]')),
    );
    expect(inline.getByRole('button', { name: 'Status' })).toBeVisible();
    expect(inline.getByRole('button', { name: 'Health' })).toBeVisible();
    expect(inline.queryByRole('button', { name: 'Target date' })).not.toBeInTheDocument();
    expect(inline.queryByRole('button', { name: 'Lead' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'More Project properties' }));
    const overflow = await screen.findByRole('group', {
      name: 'More Project properties',
    });
    expect(within(overflow).queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
    expect(within(overflow).queryByRole('button', { name: 'Health' })).not.toBeInTheDocument();
    expect(within(overflow).getByRole('button', { name: 'Target date' })).toBeVisible();
    expect(within(overflow).getByRole('button', { name: 'Lead' })).toBeVisible();
  });

  it('uses measured control widths instead of hiding properties at fixed page breakpoints', () => {
    expect(
      fitEntityMetadataPriority({
        availableWidth: 1_000,
        itemWidths: [
          { priority: 0, width: 92 },
          { priority: 1, width: 94 },
          { priority: 2, width: 118 },
          { priority: 3, width: 136 },
          { priority: 4, width: 80 },
          { priority: 5, width: 84 },
          { priority: 6, width: 96 },
          { priority: 7, width: 150 },
        ],
        gap: 6,
        overflowWidth: 28,
      }),
    ).toBe(7);
  });

  it('removes the overflow trigger when every declared property fits', () => {
    render(
      <EntityMetadataRow ariaLabel="Program properties">
        <EntityMetadataItem priority={0}>
          <button type="button">Status</button>
        </EntityMetadataItem>
        <EntityMetadataItem priority={1}>
          <button type="button">Owner</button>
        </EntityMetadataItem>
      </EntityMetadataRow>,
    );

    resizeRow(700);

    expect(
      screen.queryByRole('button', { name: 'More Program properties' }),
    ).not.toBeInTheDocument();
  });

  it('keeps supplemental properties in overflow even when the row has room', async () => {
    render(
      <EntityMetadataRow ariaLabel="Initiative properties">
        <EntityMetadataItem priority={0}>
          <button type="button">Status</button>
        </EntityMetadataItem>
        <EntityMetadataItem priority={1} overflowOnly>
          <button type="button">Set parent</button>
        </EntityMetadataItem>
      </EntityMetadataRow>,
    );

    resizeRow(700);

    const inline = screen
      .getByRole('group', { name: 'Initiative properties' })
      .querySelector<HTMLElement>('[data-entity-metadata-inline]');
    expect(within(assertDefined(inline)).queryByRole('button', { name: 'Set parent' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'More Initiative properties' }));
    const overflow = await screen.findByRole('group', { name: 'More Initiative properties' });
    expect(within(overflow).getByRole('button', { name: 'Set parent' })).toBeVisible();
  });
});

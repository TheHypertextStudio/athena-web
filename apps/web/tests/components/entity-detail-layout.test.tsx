import '@testing-library/jest-dom/vitest';

import { assertDefined } from '@docket/test-utils';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { type JSX, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ENTITY_DETAIL_ASIDE_MIN_WIDTH,
  EntityDetailLayout,
  EntityMetadataItem,
  EntityMetadataRow,
  fitEntityMetadataPriority,
  useEntityDetailAside,
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

    const primary = header?.querySelector<HTMLElement>('.detail-primary');
    expect(primary).not.toBeNull();
    const actions = within(assertDefined(primary)).getByRole('group', { name: 'Entity actions' });
    expect(within(actions).getByRole('button', { name: 'Publish' })).toBeVisible();
    expect(primary?.querySelector('.detail-identity')).not.toBeNull();
    expect(within(assertDefined(header)).getByRole('heading', { name: 'Launch' })).toBeVisible();
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

describe('EntityDetailLayout aside', () => {
  let resize: ResizeObserverCallback | null = null;
  let paneWidth = 1200;

  beforeEach(() => {
    paneWidth = 1200;
    resize = null;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = this.hasAttribute('data-detail-panel-scroll') ? paneWidth : 0;
      return {
        x: 0,
        y: 0,
        top: 0,
        right: width,
        bottom: 0,
        left: 0,
        width,
        height: 0,
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

        // Only the observer on the scroll container is the aside's; the header has its own.
        observe(target: Element): void {
          if (target.hasAttribute('data-detail-panel-scroll')) resize = this.callback;
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

  /** A slot that reports what the layout says about its aside. */
  function DockedProbe(): JSX.Element {
    const { docked } = useEntityDetailAside();
    return <output data-testid="docked">{String(docked)}</output>;
  }

  function renderLayout(withAside = true): void {
    render(
      <EntityDetailLayout
        icon={<span>icon</span>}
        title="Launch"
        tabs={<div>tabs</div>}
        metadata={<DockedProbe />}
        {...(withAside ? { aside: <div>secondary properties</div> } : {})}
      >
        <div data-testid="panel">body</div>
      </EntityDetailLayout>,
    );
  }

  it('docks the aside beside the body on a wide pane and tells its slots', () => {
    renderLayout();

    const aside = screen.getByRole('complementary', { name: 'Details' });
    expect(aside).toHaveTextContent('secondary properties');
    expect(aside).toHaveClass('sticky');
    expect(aside.parentElement?.contains(screen.getByTestId('panel'))).toBe(true);
    expect(screen.getByTestId('docked')).toHaveTextContent('true');
  });

  it('renders no aside below the threshold, and tells its slots so', () => {
    paneWidth = 895;
    renderLayout();

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.queryByText('secondary properties')).not.toBeInTheDocument();
    expect(screen.getByTestId('docked')).toHaveTextContent('false');
    // The body sits in the same wrapper it has when docked, in a plain single-column block.
    const columns = assertDefined(screen.getByTestId('panel').parentElement?.parentElement);
    expect(columns).not.toHaveClass('grid');
    expect(columns.parentElement).toHaveClass('detail-body');
  });

  it('keeps the panel mounted as the pane crosses the threshold', () => {
    const lifecycle = { mounted: 0, unmounted: 0 };
    function Panel(): JSX.Element {
      useEffect(() => {
        lifecycle.mounted += 1;
        return () => {
          lifecycle.unmounted += 1;
        };
      }, []);
      return <div data-testid="panel">body</div>;
    }
    render(
      <EntityDetailLayout
        icon={<span>icon</span>}
        title="Launch"
        tabs={<div>tabs</div>}
        aside={<div>secondary properties</div>}
      >
        <Panel />
      </EntityDetailLayout>,
    );
    const panel = screen.getByTestId('panel');
    expect(screen.getByRole('complementary')).toBeInTheDocument();

    act(() => {
      resize?.([{ contentRect: { width: 700 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    act(() => {
      resize?.([{ contentRect: { width: 1000 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(screen.getByRole('complementary')).toBeInTheDocument();

    expect(screen.getByTestId('panel')).toBe(panel);
    expect(lifecycle).toEqual({ mounted: 1, unmounted: 0 });
  });

  it('docks at exactly the threshold and undocks when the pane narrows', () => {
    paneWidth = ENTITY_DETAIL_ASIDE_MIN_WIDTH;
    renderLayout();
    expect(screen.getByRole('complementary')).toBeInTheDocument();

    act(() => {
      resize?.([{ contentRect: { width: 700 } } as ResizeObserverEntry], {} as ResizeObserver);
    });

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByTestId('docked')).toHaveTextContent('false');

    act(() => {
      resize?.([{ contentRect: { width: 1000 } } as ResizeObserverEntry], {} as ResizeObserver);
    });

    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('lays out exactly as before for a page that passes no aside', () => {
    renderLayout(false);

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByTestId('docked')).toHaveTextContent('false');
    expect(screen.getByTestId('panel').parentElement).toHaveClass('detail-body');
  });

  it('keeps the aside out of print', () => {
    renderLayout();

    expect(screen.getByRole('complementary')).toHaveClass('no-print');
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

  it('uses intrinsic content width when a picker overflows its measured wrapper', () => {
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute('data-entity-metadata-priority') === '2' ? 200 : 0;
    });
    render(
      <EntityMetadataRow ariaLabel="Task properties">
        <EntityMetadataItem priority={0}>
          <button type="button">Status</button>
        </EntityMetadataItem>
        <EntityMetadataItem priority={1}>
          <button type="button">Priority</button>
        </EntityMetadataItem>
        <EntityMetadataItem priority={2}>
          <button type="button">Repeat</button>
        </EntityMetadataItem>
      </EntityMetadataRow>,
    );

    resizeRow(350);

    const row = screen.getByRole('group', { name: 'Task properties' });
    const inline = within(
      assertDefined(row.querySelector<HTMLElement>('[data-entity-metadata-inline]')),
    );
    expect(inline.getByRole('button', { name: 'Status' })).toBeVisible();
    expect(inline.getByRole('button', { name: 'Priority' })).toBeVisible();
    expect(inline.queryByRole('button', { name: 'Repeat' })).not.toBeInTheDocument();
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

  it('reserves the coarse-pointer width when the overflow control is required', () => {
    expect(
      fitEntityMetadataPriority({
        availableWidth: 130,
        itemWidths: [
          { priority: 0, width: 50 },
          { priority: 1, width: 30 },
          { priority: 2, width: 50 },
        ],
        gap: 6,
        overflowWidth: 40,
      }),
    ).toBe(0);
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

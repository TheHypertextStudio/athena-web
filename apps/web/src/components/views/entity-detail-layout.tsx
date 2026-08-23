/**
 * `views` — the one canonical entity-detail shell that project / initiative / program detail pages
 * compose.
 *
 * @remarks
 * Every strategic-work detail page used to hand-roll its own masthead: some put the status chip
 * inline with the title, some hid properties behind a popover, some floated them in a right rail,
 * and the title size drifted between surfaces. {@link EntityDetailLayout} fixes the *arrangement*
 * once — the icon sits above the title + subtitle pair, and the title fills the available width
 * instead of being clipped to a fixed measure — a metadata slot for the full inline property row,
 * then the tab bar with a separator beneath it and the active panel — so a page only supplies
 * content through slots. The canonical title token (`text-headline-medium font-medium`) is owned
 * here so no page can diverge from it.
 */
import { useOwnPageScroll } from '@docket/ui/components';
import { Ellipsis } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  ControlGroup,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@docket/ui/primitives';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ObjectSurface } from '@/components/objects/object-surface';
import type { ObjectRef } from '@/lib/actions/object';

import { useDetailHeaderCollapse } from './entity-detail-collapse';

/** Props for {@link EntityDetailLayout}. */
export interface EntityDetailLayoutProps {
  /**
   * A full-bleed banner across the very top of the page, behind everything else.
   *
   * @remarks
   * Edge to edge on purpose. A cover inset inside the content padding is just a picture *in* the
   * page; a cover that spans the top is the page's header, which is the only version worth having.
   * The masthead is pulled up so the icon straddles its lower edge, exactly as a team card does, so
   * identity and cover read as one object rather than a caption under a photograph.
   */
  cover?: ReactNode;
  /** The breadcrumb (e.g. the Initiative breadcrumb), rendered above the identity row. */
  eyebrow?: ReactNode;
  /** The entity icon rendered above the title (an editable picker or a static glyph, ~40px). */
  icon: ReactNode;
  /** The title content (e.g. an inline-editable title); the layout owns the canonical token. */
  title: ReactNode;
  /** The one-line summary rendered directly under the identity pair. */
  subtitle?: ReactNode;
  /** The inline metadata row — typically an {@link EntityMetadataRow} of property pickers. */
  metadata?: ReactNode;
  /** Masthead actions (e.g. publish and ⋯), aligned with the icon/title identity row. */
  actions?: ReactNode;
  /** The tab bar (a `Tabs` element). A {@link Separator} is rendered directly beneath it. */
  tabs: ReactNode;
  /** The active tab panel's content. */
  children: ReactNode;
  /** Extra container classes (e.g. a page print scope). */
  className?: string;
  /** Canonical object identity for drag and the shared right-click action surface. */
  object?: ObjectRef;
}

/**
 * The standard entity-detail arrangement.
 *
 * @remarks
 * Renders (top to bottom): an optional eyebrow, a masthead whose primary row holds the identity and
 * actions, the collapsible subtitle/metadata block, the tab bar, and the active panel. The identity
 * owns the remaining width and truncates only at the compact endpoint, so actions never create a
 * second header row. Status/health and every other property live in the metadata slot.
 *
 * @param props - The {@link EntityDetailLayoutProps}.
 * @returns the composed detail page.
 */
export function EntityDetailLayout({
  cover,
  eyebrow,
  icon,
  title,
  subtitle,
  metadata,
  actions,
  tabs,
  children,
  className,
  object,
}: EntityDetailLayoutProps): JSX.Element {
  // Every detail page owns its scrolling, backdrop or not. Making it conditional would mean two
  // layouts again — one that scrolls itself and one the shell scrolls — which is the duplication
  // this component exists to remove. It is also required for a backdrop: the shell's `<main>`
  // reserves a permanent scrollbar gutter while it scrolls, and no child of a gutter-reserving box
  // can reach the pane's edge. Owning the scroll additionally gives the header something to pin to
  // and a timeline to collapse against, which every detail page benefits from equally.
  useOwnPageScroll();
  const scrollRef = useDetailHeaderCollapse({ hasCover: Boolean(cover) });

  const header = (
    <header className="detail-header page-bleed page-grid bg-surface sticky top-0 isolate z-10 gap-y-0">
      {/* The masthead band: the cover, eyebrow, and identity live inside this one wrapper, and
          nothing else does. `.detail-tabs` is this wrapper's sibling, not its descendant, so the
          cover's box structurally ends at the wrapper's bottom edge — there is no lower boundary
          for it to cross, not a z-index or an opaque backing standing in for one. `page-bleed` +
          `page-grid` bleed the wrapper itself edge to edge and then re-open the measure track for
          `eyebrow`/`detail-masthead`, mirroring how `header` does the same thing one level up. */}
      <div className="masthead-band page-bleed page-grid relative isolate gap-y-0">
        {/* The backdrop is a layer of this band, not a section above it. `isolate` (on the band,
            not the header) traps it in the band's own stacking context, so it cannot paint over
            anything outside the band — including `detail-tabs`, which sits outside it entirely.
            It has no height of its own: it is whatever the band is, so collapsing the header
            collapses the artwork with it.

            `page-bleed`: without it this div is still a `.page-grid` child like any other, so the
            blanket `.page-grid > *` rule silently placed it on the gutter-inset `measure` track —
            `inset-0` was flush with that track, not with the band, so the cover sat inside a
            margin on both sides no matter how full-bleed the band itself was. `rounded-t-xl`
            matches `<main>`'s own corner radius exactly, so the now-genuinely-flush cover
            terminates at the panel's real top corners on purpose instead of getting clipped to
            them by accident. */}
        {cover ? (
          <div className="page-bleed absolute inset-0 -z-10 overflow-hidden rounded-t-xl">
            {cover}
          </div>
        ) : null}

        {/* `.masthead-content` carries the indent that used to sit on `.detail-header` itself
            (`padding-block-start`). It has to live here, as a sibling of the cover rather than an
            ancestor of it — the cover is `inset-0` against `.masthead-band`, so any padding on
            *that* element would push the cover down with it and reopen the exact gap this whole
            restructuring exists to close. */}
        <div className="masthead-content">
          {eyebrow ? <div className="mb-3 min-w-0">{eyebrow}</div> : null}

          {cover ? <div aria-hidden="true" className="detail-backdrop-space" /> : null}

          <div className="detail-masthead">
            <div className="detail-primary">
              <div className="detail-identity">
                <div className="detail-glyph">{icon}</div>
                <h1 className="detail-title text-on-surface text-headline-medium min-w-0 font-medium">
                  {title}
                </h1>
              </div>
              {actions ? (
                <div className="detail-actions flex shrink-0 items-center gap-1">{actions}</div>
              ) : null}
            </div>

            <div className="detail-secondary">
              <div className="flex min-w-0 flex-col gap-3">
                {subtitle ? (
                  <div className="text-on-surface-variant text-body-large min-w-0">{subtitle}</div>
                ) : null}
                {metadata}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="detail-tabs">{tabs}</div>
    </header>
  );

  return (
    <div
      ref={scrollRef}
      data-detail-panel-scroll=""
      data-detail-cover={cover ? 'present' : 'absent'}
      className={cn(
        // Sections are rows of this grid, so the rhythm between them is declared once here rather
        // than by each section spacing itself against its neighbours.
        'page-grid h-full min-h-0 w-full gap-y-4 overflow-y-auto pb-24 lg:pb-6 @2xl:gap-y-5',
        className,
      )}
    >
      {/* Bleeds the full pane so the backdrop can reach both edges, and re-measures its own
          children through the nested grid, so nothing inside has to know it sits in a bleeding
          section. */}
      {object ? (
        <ObjectSurface object={object} dragDisabled surfaceId="entity-detail">
          {header}
        </ObjectSurface>
      ) : (
        header
      )}

      {/* This nested grid preserves the page measure while guaranteeing enough stable block-size
          for the scroll-linked header to reach its compact endpoint on short panels. */}
      <div className="detail-body page-bleed page-grid gap-y-4 @2xl:gap-y-5">{children}</div>
    </div>
  );
}

/**
 * The shared class for a metadata property chip: a low-chrome pill trigger sized to the inline row.
 *
 * @remarks
 * Pass to each picker's `triggerClassName` (with `triggerVariant="ghost"`) so every property in the
 * metadata row reads as the same calm, tappable chip.
 */
export const ENTITY_METADATA_CHIP_CLASS =
  'bg-surface-container-low hover:bg-surface-container-high min-w-0 max-w-full shrink';

/** Ordered visibility tier for one property in the inline metadata row. */
export type EntityMetadataPriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One measured metadata control used to calculate progressive inline disclosure. */
export interface EntityMetadataItemWidth {
  readonly priority: EntityMetadataPriority;
  readonly width: number;
}

/** Inputs for {@link fitEntityMetadataPriority}. */
export interface FitEntityMetadataPriorityOptions {
  readonly availableWidth: number;
  readonly itemWidths: readonly EntityMetadataItemWidth[];
  readonly gap: number;
  readonly overflowWidth: number;
}

/** Return the highest consecutive priority whose measured controls fit the row. */
export function fitEntityMetadataPriority({
  availableWidth,
  itemWidths,
  gap,
  overflowWidth,
}: FitEntityMetadataPriorityOptions): EntityMetadataPriority {
  if (itemWidths.length === 0) return 0;
  const priorities = [...new Set(itemWidths.map(({ priority }) => priority))].sort(
    (left, right) => left - right,
  );
  const declaredPriority = priorities.at(-1) ?? 0;
  const fullWidth = itemWidths.reduce(
    (total, item, index) => total + item.width + (index === 0 ? 0 : gap),
    0,
  );
  if (fullWidth <= availableWidth) return declaredPriority;

  const inlineWidth = Math.max(0, availableWidth - overflowWidth - gap);
  let usedWidth = 0;
  let usedItems = 0;
  let visiblePriority: EntityMetadataPriority = 0;
  for (const priority of priorities) {
    const items = itemWidths.filter((item) => item.priority === priority);
    const groupWidth = items.reduce(
      (total, item, index) => total + item.width + (index === 0 ? 0 : gap),
      0,
    );
    const nextWidth = usedWidth + (usedItems === 0 ? 0 : gap) + groupWidth;
    if (priority !== 0 && nextWidth > inlineWidth) break;
    usedWidth = nextWidth;
    usedItems += items.length;
    visiblePriority = priority;
  }
  return visiblePriority;
}

interface EntityMetadataLaneContext {
  readonly lane: 'inline' | 'overflow';
  readonly visiblePriority: EntityMetadataPriority;
  readonly declareItem?: (priority: EntityMetadataPriority, element: HTMLElement) => () => void;
}

const MetadataLaneContext = createContext<EntityMetadataLaneContext | null>(null);

/** Props for {@link EntityMetadataItem}. */
export interface EntityMetadataItemProps {
  /** Lower priorities remain inline at narrower widths; priority zero is always visible. */
  priority: EntityMetadataPriority;
  /** Optional width policy for property types that must remain intrinsically readable. */
  className?: string;
  /** One property picker or compact read-only value. */
  children: ReactNode;
}

/**
 * Annotate one property for progressive inline disclosure while keeping it in overflow.
 *
 * @param props - The property control and its inline priority.
 * @returns A width-capped metadata item understood by {@link EntityMetadataRow}.
 */
export function EntityMetadataItem({
  priority,
  className,
  children,
}: EntityMetadataItemProps): JSX.Element | null {
  const lane = useContext(MetadataLaneContext);
  const itemRef = useRef<HTMLDivElement>(null);
  const declareItem = lane?.lane === 'inline' ? lane.declareItem : undefined;

  useLayoutEffect(() => {
    const element = itemRef.current;
    if (!declareItem || !element) return;
    return declareItem(priority, element);
  }, [declareItem, priority]);

  const hiddenInline = lane?.lane === 'inline' && priority > lane.visiblePriority;
  if (lane?.lane === 'overflow' && priority <= lane.visiblePriority) return null;

  return (
    <div
      ref={itemRef}
      hidden={hiddenInline}
      data-entity-metadata-item=""
      data-entity-metadata-priority={priority}
      className={cn('max-w-64 min-w-0 shrink-0 items-center [&>*]:min-w-0', className)}
    >
      {children}
    </div>
  );
}

/** Props for {@link EntityMetadataRow}. */
export interface EntityMetadataRowProps {
  /** Accessible label for the property group (e.g. "Project properties"). */
  ariaLabel: string;
  /** The property chips (pickers) to lay out inline. */
  children: ReactNode;
}

/**
 * A single-line property row with a stable overflow surface.
 *
 * @remarks
 * Each property is rendered inline at its declared priority and rendered again inside the popover.
 * The popover copy is mounted only while open, so picker state never competes between two live
 * controls. This mirrors the task-header rule: narrow widths remove controls from the row, never
 * from the product.
 *
 * @param props - The {@link EntityMetadataRowProps}.
 * @returns a labelled group wrapping its property chips.
 */
export function EntityMetadataRow({ ariaLabel, children }: EntityMetadataRowProps): JSX.Element {
  const inlineRef = useRef<HTMLDivElement>(null);
  const availableWidth = useRef(0);
  const itemMeasurements = useRef(
    new Map<HTMLElement, { priority: EntityMetadataPriority; width: number }>(),
  );
  const [visiblePriority, setVisiblePriority] = useState<EntityMetadataPriority>(7);
  const [declaredPriority, setDeclaredPriority] = useState<EntityMetadataPriority>(0);

  const recomputeVisibility = useCallback(() => {
    const measurements = [...itemMeasurements.current.values()];
    const nextDeclared = measurements.reduce<EntityMetadataPriority>(
      (highest, item) => Math.max(highest, item.priority) as EntityMetadataPriority,
      0,
    );
    setDeclaredPriority(nextDeclared);
    if (availableWidth.current <= 0) {
      setVisiblePriority(nextDeclared);
      return;
    }
    setVisiblePriority(
      fitEntityMetadataPriority({
        availableWidth: availableWidth.current,
        itemWidths: measurements,
        // The row inherits the shared `sm` control step: 6px gap and a 28px icon control.
        gap: 6,
        overflowWidth: 28,
      }),
    );
  }, []);

  const declareItem = useCallback(
    (priority: EntityMetadataPriority, element: HTMLElement) => {
      const measure = (): void => {
        const width = element.getBoundingClientRect().width;
        if (width <= 0) return;
        itemMeasurements.current.set(element, { priority, width });
        recomputeVisibility();
      };
      measure();
      const observer =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => {
              measure();
            });
      observer?.observe(element);

      return () => {
        observer?.disconnect();
        itemMeasurements.current.delete(element);
        recomputeVisibility();
      };
    },
    [recomputeVisibility],
  );

  useEffect(() => {
    const row = inlineRef.current?.parentElement;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      availableWidth.current = entry.contentRect.width;
      recomputeVisibility();
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [recomputeVisibility]);

  const inlineLane = useMemo<EntityMetadataLaneContext>(
    () => ({ lane: 'inline', visiblePriority, declareItem }),
    [declareItem, visiblePriority],
  );
  const overflowLane = useMemo<EntityMetadataLaneContext>(
    () => ({ lane: 'overflow', visiblePriority }),
    [visiblePriority],
  );
  const hasOverflow = declaredPriority > visiblePriority;

  return (
    <ControlGroup
      role="group"
      aria-label={ariaLabel}
      controlSize="sm"
      className="entity-metadata-row min-w-0 flex-nowrap"
    >
      <div ref={inlineRef} className="min-w-0 flex-1 overflow-hidden">
        <ControlGroup data-entity-metadata-inline="" className="flex-nowrap">
          <MetadataLaneContext.Provider value={inlineLane}>{children}</MetadataLaneContext.Provider>
        </ControlGroup>
      </div>
      {hasOverflow ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              iconOnly
              className="shrink-0"
              aria-label={`More ${ariaLabel}`}
            >
              <Ellipsis aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)] p-2">
            <ControlGroup
              role="group"
              aria-label={`More ${ariaLabel}`}
              controlSize="sm"
              orientation="vertical"
              data-entity-metadata-overflow=""
              className="min-w-0 items-stretch"
            >
              <MetadataLaneContext.Provider value={overflowLane}>
                {children}
              </MetadataLaneContext.Provider>
            </ControlGroup>
          </PopoverContent>
        </Popover>
      ) : null}
    </ControlGroup>
  );
}

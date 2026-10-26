import {
  Button,
  ControlGroup,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
} from '@docket/ui/primitives';
import { Ellipsis, TuneRounded } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  createContext,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  MetadataPlacementContext,
  type OverflowRevealer,
  useMetadataItemPlacement,
  useOverflowDisclosure,
} from './entity-detail-context';
import { useElementWidth } from './use-element-width';

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

interface EntityMetadataLaneContext extends OverflowRevealer {
  readonly lane: 'inline' | 'overflow';
  readonly visiblePriority: EntityMetadataPriority;
  readonly declareItem?: (
    priority: EntityMetadataPriority,
    element: HTMLElement,
    overflowOnly: boolean,
  ) => () => void;
}

const MetadataLaneContext = createContext<EntityMetadataLaneContext | null>(null);

/** Props for {@link EntityMetadataItem}. */
export interface EntityMetadataItemProps {
  /** Lower priorities remain inline at narrower widths; priority zero is always visible. */
  priority: EntityMetadataPriority;
  /** Keep supplemental information in overflow even when the inline row has room. */
  overflowOnly?: boolean;
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
  overflowOnly = false,
  className,
  children,
}: EntityMetadataItemProps): JSX.Element | null {
  const lane = useContext(MetadataLaneContext);
  const itemRef = useRef<HTMLDivElement>(null);
  const declareItem = lane?.lane === 'inline' ? lane.declareItem : undefined;

  useLayoutEffect(() => {
    const element = itemRef.current;
    if (!declareItem || !element) return;
    return declareItem(priority, element, overflowOnly);
  }, [declareItem, overflowOnly, priority]);

  const hiddenInline = lane?.lane === 'inline' && (overflowOnly || priority > lane.visiblePriority);
  const placement = useMetadataItemPlacement(hiddenInline, lane);
  if (lane?.lane === 'overflow' && !overflowOnly && priority <= lane.visiblePriority) return null;

  return (
    <div
      ref={itemRef}
      hidden={hiddenInline}
      data-entity-metadata-item=""
      data-entity-metadata-priority={priority}
      className={cn('max-w-64 min-w-0 shrink-0 items-center [&>*]:min-w-0', className)}
    >
      <MetadataPlacementContext.Provider value={placement}>
        {children}
      </MetadataPlacementContext.Provider>
    </div>
  );
}

/** Props for {@link EntityMetadataRow}. */
export interface EntityMetadataRowProps {
  /** Accessible label for the property group (e.g. "Project properties"). */
  ariaLabel: string;
  /** Wrap primary properties instead of moving them into adaptive overflow. */
  layout?: 'adaptive' | 'wrap';
  /** Visible disclosure label; omitted for the existing icon-only adaptive control. */
  overflowLabel?: string;
  /** Additional row styling for the surface that owns these controls. */
  className?: string | undefined;
  /** The property chips (pickers) to lay out inline. */
  children: ReactNode;
}

/** One declared item: its tier, its measured width, and whether it stays out of the inline row. */
interface MetadataMeasurement {
  priority: EntityMetadataPriority;
  width: number;
  overflowOnly: boolean;
}

/**
 * Measure the declared items and decide how many tiers fit the row.
 *
 * @returns the visible tier, whether anything overflows, the item registration callback, and the
 *   setter through which the row reports its available width.
 */
function useMetadataFit() {
  const availableWidth = useRef(0);
  const itemMeasurements = useRef(new Map<HTMLElement, MetadataMeasurement>());
  const [visiblePriority, setVisiblePriority] = useState<EntityMetadataPriority>(7);
  const [declaredPriority, setDeclaredPriority] = useState<EntityMetadataPriority>(0);
  const [hasSupplemental, setHasSupplemental] = useState(false);

  const recomputeVisibility = useCallback(() => {
    const measurements = [...itemMeasurements.current.values()];
    const inlineMeasurements = measurements.filter((item) => !item.overflowOnly);
    const nextDeclared = inlineMeasurements.reduce<EntityMetadataPriority>(
      (highest, item) => Math.max(highest, item.priority) as EntityMetadataPriority,
      0,
    );
    setDeclaredPriority(nextDeclared);
    setHasSupplemental(measurements.some((item) => item.overflowOnly));
    if (availableWidth.current <= 0) {
      setVisiblePriority(nextDeclared);
      return;
    }
    setVisiblePriority(
      fitEntityMetadataPriority({
        availableWidth: availableWidth.current,
        itemWidths: inlineMeasurements,
        // Reserve the shared icon control's 40px coarse-pointer floor. The extra 12px on fine
        // pointers keeps the fit conservative and prevents a pointer-mode change from clipping a
        // property before ResizeObserver reports another row width.
        gap: 6,
        overflowWidth: 40,
      }),
    );
  }, []);

  const declareItem = useCallback(
    (priority: EntityMetadataPriority, element: HTMLElement, overflowOnly: boolean) => {
      const measure = (): void => {
        // A picker can keep its own intrinsic width while its wrapper is clipped by the inline
        // lane. Measure both boxes so the fitter never treats clipped content as free space.
        const width = Math.max(element.getBoundingClientRect().width, element.scrollWidth);
        if (width <= 0 && !overflowOnly) return;
        itemMeasurements.current.set(element, { priority, width, overflowOnly });
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

  const setAvailableWidth = useCallback(
    (width: number): void => {
      availableWidth.current = width;
      recomputeVisibility();
    },
    [recomputeVisibility],
  );

  return {
    visiblePriority,
    hasOverflow: hasSupplemental || declaredPriority > visiblePriority,
    hasSupplemental,
    declareItem,
    setAvailableWidth,
  };
}

/** Measure disclosure lanes while preserving the active overflow and focus revealer. */
function useMetadataLanes(layout: 'adaptive' | 'wrap') {
  const inlineRef = useRef<HTMLDivElement>(null);
  const fit = useMetadataFit();
  const { declareItem, setAvailableWidth } = fit;
  const visiblePriority = layout === 'wrap' ? 7 : fit.visiblePriority;
  const hasOverflow = layout === 'wrap' ? fit.hasSupplemental : fit.hasOverflow;

  // The row's own width, read before the first paint: without it `availableWidth` stays at its
  // initial `0` and `visiblePriority` at its "show everything" default, so every pill renders inline
  // and the row's `overflow-hidden` clips whichever ones don't fit instead of demoting them into
  // the overflow popover.
  //
  // Only a positive width is forwarded. A `0` means the row has no layout to measure (detached, or a
  // test environment with no layout engine), and recomputing against that non-answer would collapse
  // the row to its priority-zero items instead of leaving it at the "show everything" default.
  const rowWidth = useElementWidth(inlineRef, true, 'parent');
  useLayoutEffect(() => {
    if (rowWidth > 0) setAvailableWidth(rowWidth);
  }, [rowWidth, setAvailableWidth]);

  const overflow = useOverflowDisclosure();
  const revealOverflow = overflow.reveal;
  const inlineLane = useMemo<EntityMetadataLaneContext>(
    () => ({ lane: 'inline', visiblePriority, declareItem, revealOverflow }),
    [declareItem, revealOverflow, visiblePriority],
  );
  const overflowLane = useMemo<EntityMetadataLaneContext>(
    () => ({ lane: 'overflow', visiblePriority }),
    [visiblePriority],
  );

  return { inlineRef, hasOverflow, overflow, inlineLane, overflowLane };
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
export function EntityMetadataRow({
  ariaLabel,
  layout = 'adaptive',
  overflowLabel,
  className,
  children,
}: EntityMetadataRowProps): JSX.Element {
  const { inlineRef, hasOverflow, overflow, inlineLane, overflowLane } = useMetadataLanes(layout);

  return (
    <ControlGroup
      role="group"
      aria-label={ariaLabel}
      controlSize="sm"
      className={cn(
        'entity-metadata-row min-w-0',
        layout === 'wrap' ? 'flex-wrap items-start' : 'flex-nowrap',
        className,
      )}
    >
      <div
        ref={inlineRef}
        className={cn('min-w-0', layout === 'wrap' ? 'contents' : 'flex-1 overflow-hidden')}
      >
        <ControlGroup
          data-entity-metadata-inline=""
          className={layout === 'wrap' ? 'contents' : 'flex-nowrap'}
        >
          <MetadataLaneContext.Provider value={inlineLane}>{children}</MetadataLaneContext.Provider>
        </ControlGroup>
      </div>
      {hasOverflow ? (
        <Popover open={overflow.open} onOpenChange={overflow.setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              iconOnly={!overflowLabel}
              className="shrink-0"
              aria-label={overflowLabel ?? `More ${ariaLabel}`}
            >
              {overflowLabel ? <TuneRounded aria-hidden /> : <Ellipsis aria-hidden />}
              {overflowLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent presentation="panel" width="xl" align="end">
            <PopoverBody>
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
            </PopoverBody>
          </PopoverContent>
        </Popover>
      ) : null}
    </ControlGroup>
  );
}

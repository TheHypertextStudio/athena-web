'use client';

/**
 * `@docket/ui` — a measured, non-wrapping control row.
 *
 * @remarks
 * A toolbar cannot hide controls by overflowing its own width. This component measures the
 * concrete controls that a caller supplies, keeps required and higher-priority controls inline,
 * and places the rest in one named menu. It therefore preserves reachability without a horizontal
 * scroller or a second, hand-built compact layout at every route.
 */
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  type ControlSize,
} from '../../primitives';
import { MoreHorizontal } from '../../icons';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** One control with inline and overflow presentations. */
export interface ResponsiveControlItem {
  /** Stable key for width caching and visibility. */
  readonly id: string;
  /** Lower values have a higher inline priority. */
  readonly priority: number;
  /** The full control rendered when this item fits inline. */
  readonly inline: ReactNode;
  /** The equivalent action rendered in the overflow menu. */
  readonly overflow: ReactNode;
  /** Keeps this control inline whenever the group has any available width. */
  readonly alwaysVisible?: boolean | undefined;
}

/** Props for {@link ResponsiveControlGroup}. */
export interface ResponsiveControlGroupProps {
  /** Accessible name for the inline control row. */
  readonly label: string;
  /** Ordered controls. Their declared order stays visible order. */
  readonly items: readonly ResponsiveControlItem[];
  /** Accessible name for the overflow trigger. */
  readonly overflowLabel: string;
  /** The shared control-size scale for the overflow trigger. */
  readonly controlSize?: ControlSize | undefined;
}

/** Measured layout bindings shared by control rows with specialized inline semantics. */
export interface ResponsiveControlLayout {
  /** Attach this to the element whose inline size constrains the control row. */
  readonly containerRef: RefObject<HTMLDivElement | null>;
  /** Attach this to an off-flow overflow trigger with the same geometry as the visible trigger. */
  readonly overflowMeasurementRef: RefObject<HTMLSpanElement | null>;
  /** Attach this to each inline control wrapper. */
  readonly setItemRef: (id: string, node: HTMLSpanElement | null) => void;
  /** The item ids that fit inline in declared display order. */
  readonly inlineIds: ReadonlySet<string>;
}

const GAP_PX = 8;
const OVERFLOW_FALLBACK_WIDTH_PX = 40;

function equalIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Measure a prioritized control collection without giving the caller a horizontal scroll escape.
 *
 * @param items - The controls to measure and prioritize.
 * @returns refs and visible ids for one responsive control row.
 */
export function useResponsiveControlLayout(
  items: readonly ResponsiveControlItem[],
): ResponsiveControlLayout {
  const containerRef = useRef<HTMLDivElement>(null);
  const overflowMeasurementRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef(new Map<string, HTMLSpanElement>());
  const widthsRef = useRef(new Map<string, number>());
  const [inlineIds, setInlineIds] = useState(() => items.map((item) => item.id));

  const setItemRef = useCallback((id: string, node: HTMLSpanElement | null): void => {
    if (node) itemRefs.current.set(id, node);
    else itemRefs.current.delete(id);
  }, []);

  const measure = useCallback((): void => {
    const container = containerRef.current;
    if (!container) return;

    for (const item of items) {
      const width = itemRefs.current.get(item.id)?.getBoundingClientRect().width ?? 0;
      if (width > 0) widthsRef.current.set(item.id, width);
    }
    const available = container.clientWidth;
    if (available <= 0) return;

    const ordered = [...items].sort((left, right) => left.priority - right.priority);
    const alwaysVisible = ordered.filter((item) => item.alwaysVisible);
    const optional = ordered.filter((item) => !item.alwaysVisible);
    const measuredOverflowWidth =
      overflowMeasurementRef.current?.getBoundingClientRect().width ?? 0;
    const overflowWidth =
      measuredOverflowWidth > 0 ? measuredOverflowWidth : OVERFLOW_FALLBACK_WIDTH_PX;
    const widthFor = (
      selection: readonly ResponsiveControlItem[],
      includesOverflow: boolean,
    ): number =>
      selection.reduce((total, item) => total + (widthsRef.current.get(item.id) ?? 0), 0) +
      Math.max(0, selection.length - 1 + (includesOverflow ? 1 : 0)) * GAP_PX +
      (includesOverflow ? overflowWidth : 0);

    if (widthFor(items, false) <= available) {
      const next = items.map((item) => item.id);
      setInlineIds((current) => (equalIds(current, next) ? current : next));
      return;
    }

    const selected = [...alwaysVisible];
    for (const item of optional) {
      if (widthFor([...selected, item], true) > available) break;
      selected.push(item);
    }
    const chosen = new Set(selected.map((item) => item.id));
    const next = items.filter((item) => chosen.has(item.id)).map((item) => item.id);
    setInlineIds((current) => (equalIds(current, next) ? current : next));
  }, [items]);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [measure]);

  return {
    containerRef,
    overflowMeasurementRef,
    setItemRef,
    inlineIds: new Set(inlineIds),
  };
}

/**
 * A single-line control group that moves lower-priority controls into a named menu when needed.
 *
 * @param props - Control content and priority declarations.
 * @returns a responsive toolbar region with no horizontal scroll owner.
 */
export function ResponsiveControlGroup({
  label,
  items,
  overflowLabel,
  controlSize = 'md',
}: ResponsiveControlGroupProps): React.JSX.Element {
  const layout = useResponsiveControlLayout(items);
  const inlineSet = layout.inlineIds;
  const overflowItems = items.filter((item) => !inlineSet.has(item.id));

  return (
    <div
      ref={layout.containerRef}
      data-testid="responsive-control-group"
      aria-label={label}
      className="relative flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden"
    >
      {items.map((item) => (
        <span
          key={item.id}
          ref={(node) => {
            layout.setItemRef(item.id, node);
          }}
          data-responsive-item={item.id}
          hidden={!inlineSet.has(item.id)}
          className="shrink-0"
        >
          {item.inline}
        </span>
      ))}
      {overflowItems.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              controlSize={controlSize}
              aria-label={overflowLabel}
              className="shrink-0"
            >
              <MoreHorizontal aria-hidden="true" />
              <span className="sr-only">{overflowLabel}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" width="lg" aria-label={overflowLabel}>
            {overflowItems.map((item) => (
              <div key={item.id}>{item.overflow}</div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <span
        ref={layout.overflowMeasurementRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute"
      >
        <Button type="button" variant="ghost" controlSize={controlSize}>
          <MoreHorizontal aria-hidden="true" />
          <span className="sr-only">{overflowLabel}</span>
        </Button>
      </span>
    </div>
  );
}
